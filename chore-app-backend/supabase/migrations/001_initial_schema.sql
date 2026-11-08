-- Chore App schema (v2: accounts, groups, generic composable chore types)
-- Run this whole file in the Supabase SQL editor.
--
-- This assumes Supabase Auth is enabled (it is, by default) — real accounts
-- live in auth.users, and everything here is scoped per-group via
-- row level security, so groups never see each other's data.

create extension if not exists pgcrypto;

-- ============================================================
-- GROUPS & MEMBERSHIP
-- ============================================================

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member', -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- Display names must be unique within a group, but the same person can use
-- a different name in a different group.
create unique index if not exists memberships_unique_name_per_group
  on memberships (group_id, lower(display_name));

-- Helper used throughout RLS. security definer so it can read memberships
-- without recursing into memberships' own RLS policy.
create or replace function is_group_member(gid uuid)
returns boolean
language sql stable security definer
as $$
  select exists(select 1 from memberships m where m.group_id = gid and m.user_id = auth.uid());
$$;

alter table groups enable row level security;
alter table memberships enable row level security;

drop policy if exists "members can view their groups" on groups;
create policy "members can view their groups" on groups for select using (is_group_member(id));

drop policy if exists "members can view roster" on memberships;
create policy "members can view roster" on memberships for select using (is_group_member(group_id));

drop policy if exists "members can update own row" on memberships;
create policy "members can update own row" on memberships for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No direct insert policy on groups/memberships: creation and joining only
-- happen through create_group / join_group below, which run as
-- security definer and enforce the invite-code + unique-name rules.

create or replace function create_group(p_name text, p_display_name text)
returns uuid
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_code text;
begin
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into groups(name, invite_code, created_by) values (p_name, v_code, auth.uid())
    returning id into v_group_id;
  insert into memberships(group_id, user_id, display_name, role)
    values (v_group_id, auth.uid(), p_display_name, 'owner');
  return v_group_id;
end;
$$;

create or replace function join_group(p_invite_code text, p_display_name text)
returns uuid
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_name_taken boolean;
begin
  select id into v_group_id from groups where invite_code = upper(p_invite_code);
  if v_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  select exists(
    select 1 from memberships where group_id = v_group_id and lower(display_name) = lower(p_display_name)
  ) into v_name_taken;
  if v_name_taken then
    raise exception 'That name is already taken in this group';
  end if;

  insert into memberships(group_id, user_id, display_name, role)
    values (v_group_id, auth.uid(), p_display_name, 'member')
    on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

create or replace function set_display_name(p_group_id uuid, p_new_name text)
returns void
language plpgsql security definer
as $$
declare
  v_taken boolean;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of this group';
  end if;
  select exists(
    select 1 from memberships
    where group_id = p_group_id and lower(display_name) = lower(p_new_name) and user_id <> auth.uid()
  ) into v_taken;
  if v_taken then
    raise exception 'That name is already taken in this group';
  end if;
  update memberships set display_name = p_new_name where group_id = p_group_id and user_id = auth.uid();
end;
$$;

create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql security definer
as $$
begin
  delete from memberships where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- ============================================================
-- RESOURCES (countable supplies, e.g. mats, detergent pods, toothpaste)
-- ============================================================

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  unit text, -- e.g. "mats", "pods" — display only
  qty numeric not null default 0,
  notified_zero boolean not null default false,
  created_at timestamptz not null default now()
);

alter table resources enable row level security;
drop policy if exists "members access resources" on resources;
create policy "members access resources" on resources for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- ============================================================
-- CHORE TYPES (the composable, reusable definition)
-- ============================================================

create table if not exists chore_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  icon text, -- optional emoji
  archived boolean not null default false,

  -- capability: rotating scheduled turns
  has_schedule boolean not null default false,
  schedule_interval_days int,
  last_rotation_index int,
  last_event_date date,

  -- capability: consumes tracked resources on completion (see chore_type_resources)
  has_resources boolean not null default false,

  -- capability: count-up trigger (e.g. "clean when dish count hits 8")
  has_counter boolean not null default false,
  counter_threshold int,
  counter_current int not null default 0,

  -- capability: timer / cycle (e.g. dishwasher, washer, dryer)
  has_timer boolean not null default false,

  -- if true, completing this chore (scheduled turn or one-time task)
  -- requires a photo_url to be provided — otherwise a photo is optional
  requires_photo boolean not null default false,

  created_at timestamptz not null default now()
);

alter table chore_types enable row level security;
drop policy if exists "members access chore_types" on chore_types;
create policy "members access chore_types" on chore_types for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- Ordered rotation roster for has_schedule chore types.
create table if not exists chore_type_rotation (
  chore_type_id uuid not null references chore_types(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sort_order int not null,
  primary key (chore_type_id, user_id)
);

alter table chore_type_rotation enable row level security;
drop policy if exists "members access rotation" on chore_type_rotation;
create policy "members access rotation" on chore_type_rotation for all
  using (exists(select 1 from chore_types ct where ct.id = chore_type_id and is_group_member(ct.group_id)))
  with check (exists(select 1 from chore_types ct where ct.id = chore_type_id and is_group_member(ct.group_id)));

-- Which resources (and how much of each) a chore type consumes per completion.
create table if not exists chore_type_resources (
  chore_type_id uuid not null references chore_types(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  qty_per_completion numeric not null default 1,
  primary key (chore_type_id, resource_id)
);

alter table chore_type_resources enable row level security;
drop policy if exists "members access chore_type_resources" on chore_type_resources;
create policy "members access chore_type_resources" on chore_type_resources for all
  using (exists(select 1 from chore_types ct where ct.id = chore_type_id and is_group_member(ct.group_id)))
  with check (exists(select 1 from chore_types ct where ct.id = chore_type_id and is_group_member(ct.group_id)));

-- ============================================================
-- CHORE EVENTS (scheduled turns, for has_schedule chore types)
-- ============================================================

create table if not exists chore_events (
  id uuid primary key default gen_random_uuid(),
  chore_type_id uuid not null references chore_types(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  date date not null,
  rotation_user_id uuid references auth.users(id),
  assigned_user_id uuid references auth.users(id),
  status text not null default 'pending', -- pending | done
  notified_turn boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users(id),
  photo_url text, -- storage path in the chore-photos bucket, set on completion
  created_at timestamptz not null default now()
);

alter table chore_events enable row level security;
drop policy if exists "members access chore_events" on chore_events;
create policy "members access chore_events" on chore_events for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- For one-time tasks with more than one eligible person (e.g. "unload the
-- dishwasher" offered to whoever was assigned when the timer was started):
-- assigned_user_id above stays null/ambiguous and this table lists who's
-- allowed to claim it. For a normal scheduled turn there's exactly one row
-- here too, mirroring assigned_user_id, so "am I allowed to complete this"
-- is always just one check regardless of task type.
create table if not exists chore_event_assignees (
  chore_event_id uuid not null references chore_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (chore_event_id, user_id)
);

alter table chore_event_assignees enable row level security;
drop policy if exists "members access chore_event_assignees" on chore_event_assignees;
create policy "members access chore_event_assignees" on chore_event_assignees for all
  using (exists(select 1 from chore_events ce where ce.id = chore_event_id and is_group_member(ce.group_id)))
  with check (exists(select 1 from chore_events ce where ce.id = chore_event_id and is_group_member(ce.group_id)));

-- ============================================================
-- CHORE RUNS (ad hoc instances: counter-triggered or timer cycles)
-- ============================================================

create table if not exists chore_runs (
  id uuid primary key default gen_random_uuid(),
  chore_type_id uuid not null references chore_types(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  trigger_reason text not null, -- 'counter_threshold' | 'timer_cycle' | 'manual'
  status text not null default 'pending', -- pending | running | done
  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  cycle_minutes int,
  cycle_ends_at timestamptz,
  notified_cycle_end boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users(id)
);

alter table chore_runs enable row level security;
drop policy if exists "members access chore_runs" on chore_runs;
create policy "members access chore_runs" on chore_runs for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- Who was "on" a timer when it was started (e.g. whoever set the
-- dishwasher running) — this is who the follow-up "unload it" task gets
-- assigned to, and who gets notified, once the cycle finishes.
create table if not exists chore_run_assignees (
  chore_run_id uuid not null references chore_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (chore_run_id, user_id)
);

alter table chore_run_assignees enable row level security;
drop policy if exists "members access chore_run_assignees" on chore_run_assignees;
create policy "members access chore_run_assignees" on chore_run_assignees for all
  using (exists(select 1 from chore_runs cr where cr.id = chore_run_id and is_group_member(cr.group_id)))
  with check (exists(select 1 from chore_runs cr where cr.id = chore_run_id and is_group_member(cr.group_id)));

-- ============================================================
-- TRADES (swap two scheduled chore_events between people)
-- ============================================================

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  from_event_id uuid references chore_events(id),
  to_event_id uuid references chore_events(id),
  from_user_id uuid references auth.users(id),
  to_user_id uuid references auth.users(id),
  status text not null default 'pending', -- pending | accepted | declined
  created_at timestamptz not null default now()
);

alter table trades enable row level security;
drop policy if exists "members access trades" on trades;
create policy "members access trades" on trades for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- ============================================================
-- STOCK ITEMS ("we ran out of ___" tab)
-- ============================================================

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  resource_id uuid references resources(id), -- set when auto-flagged from a tracked resource
  status text not null default 'out', -- out | resolved
  flagged_by uuid references auth.users(id),
  flagged_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz
);

alter table stock_items enable row level security;
drop policy if exists "members access stock_items" on stock_items;
create policy "members access stock_items" on stock_items for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

-- ============================================================
-- ACTIVITY LOG (per-group history feed)
-- ============================================================

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  text text not null,
  type text not null default 'info',
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;
drop policy if exists "members access activity_log" on activity_log;
create policy "members access activity_log" on activity_log for select
  using (is_group_member(group_id));
-- inserts to activity_log only happen via the security-definer functions below

-- ============================================================
-- PUSH TOKENS (per account, not per group)
-- ============================================================

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table push_tokens enable row level security;
drop policy if exists "own tokens" on push_tokens;
create policy "own tokens" on push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table
  groups, memberships, resources, chore_types, chore_type_rotation, chore_type_resources,
  chore_events, chore_event_assignees, chore_runs, chore_run_assignees, trades, stock_items, activity_log;

-- ============================================================
-- FUNCTIONS: schedule generation
-- ============================================================

create or replace function ensure_chore_events(p_chore_type_id uuid, p_through_date date)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_people uuid[];
  v_count int;
  v_idx int;
  v_date date;
  v_uid uuid;
  v_event_id uuid;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_schedule = true and archived = false;
  if not found then return; end if;

  select array_agg(user_id order by sort_order) into v_people
    from chore_type_rotation where chore_type_id = p_chore_type_id;
  v_count := coalesce(array_length(v_people, 1), 0);
  if v_count = 0 then return; end if;

  v_idx := v_ct.last_rotation_index;
  v_date := v_ct.last_event_date;

  if v_date is null then
    v_idx := 0;
    v_date := current_date;
    v_uid := v_people[v_idx + 1];
    insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status)
      values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending')
      returning id into v_event_id;
    insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end if;

  while v_date < p_through_date loop
    v_idx := (v_idx + 1) % v_count;
    v_date := v_date + v_ct.schedule_interval_days;
    v_uid := v_people[v_idx + 1];
    insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status)
      values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending')
      returning id into v_event_id;
    insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end loop;
end;
$$;

-- Convenience wrapper: extend every scheduled chore type in a group at once.
create or replace function ensure_all_events(p_group_id uuid, p_through_date date)
returns void
language plpgsql security definer
as $$
declare r record;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  for r in select id from chore_types where group_id = p_group_id and has_schedule = true and archived = false loop
    perform ensure_chore_events(r.id, p_through_date);
  end loop;
end;
$$;

-- ============================================================
-- FUNCTIONS: creating & editing scheduled/rotating chores
-- ============================================================
--
-- These two RPCs are the entry point the client app should use when the
-- user creates a task and picks "assign to a person" vs "rotate between
-- people". Both are really the same thing under the hood: a schedule with
-- an ordered roster in chore_type_rotation. A single-person roster IS
-- "assign to a person" (that person comes up every interval). A
-- multi-person roster (a chosen subgroup, or every member of the group)
-- IS the rotation. p_interval_days is however often you want it to come
-- back around: 1 = every day, 2 = every two days, 7 = weekly, etc.

create or replace function create_chore_type_scheduled(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default false
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_bad_count int;
  v_person_count int;
  v_names text;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not authorized';
  end if;
  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Interval must be at least 1 day';
  end if;
  v_person_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Pick at least one person';
  end if;

  -- Every id passed in must actually be a member of this group — stops a
  -- caller from assigning to someone outside the group by mistake.
  select count(*) into v_bad_count
    from unnest(p_user_ids) uid
    where not exists (
      select 1 from memberships m where m.group_id = p_group_id and m.user_id = uid
    );
  if v_bad_count > 0 then
    raise exception 'One or more selected people are not members of this group';
  end if;

  insert into chore_types(group_id, name, icon, has_schedule, schedule_interval_days, requires_photo)
    values (p_group_id, p_name, p_icon, true, p_interval_days, coalesce(p_requires_photo, false))
    returning id into v_chore_type_id;

  insert into chore_type_rotation(chore_type_id, user_id, sort_order)
    select v_chore_type_id, uid, row_number() over ()
    from unnest(p_user_ids) uid;

  -- Generate the first ~30 days of turns right away so the app has
  -- something to show immediately.
  perform ensure_chore_events(v_chore_type_id, current_date + 30);

  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = p_group_id and user_id = any(p_user_ids);

  insert into activity_log(group_id, text, type)
    values (p_group_id,
      case when v_person_count = 1
        then p_name || ' was assigned to ' || coalesce(v_names, 'someone') || '.'
        else p_name || ' will rotate every ' || p_interval_days || ' day(s) between: ' || coalesce(v_names, 'the group') || '.'
      end,
      'chore_created');

  return v_chore_type_id;
end;
$$;

create or replace function update_chore_schedule(
  p_chore_type_id uuid,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default null -- null = leave as-is
)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_bad_count int;
  v_person_count int;
  v_names text;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_schedule = true;
  if not found then raise exception 'Not a scheduled chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Interval must be at least 1 day';
  end if;
  v_person_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Pick at least one person';
  end if;

  select count(*) into v_bad_count
    from unnest(p_user_ids) uid
    where not exists (
      select 1 from memberships m where m.group_id = v_ct.group_id and m.user_id = uid
    );
  if v_bad_count > 0 then
    raise exception 'One or more selected people are not members of this group';
  end if;

  -- Drop not-yet-done future turns — they were built around the old
  -- roster/interval — but leave history (done ones) alone.
  delete from chore_events
    where chore_type_id = p_chore_type_id and status = 'pending' and date >= current_date;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  insert into chore_type_rotation(chore_type_id, user_id, sort_order)
    select p_chore_type_id, uid, row_number() over ()
    from unnest(p_user_ids) uid;

  update chore_types
    set schedule_interval_days = p_interval_days,
        requires_photo = coalesce(p_requires_photo, requires_photo),
        last_rotation_index = null,
        last_event_date = null
    where id = p_chore_type_id;

  perform ensure_chore_events(p_chore_type_id, current_date + 30);

  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = v_ct.group_id and user_id = any(p_user_ids);

  insert into activity_log(group_id, text, type)
    values (v_ct.group_id,
      case when v_person_count = 1
        then v_ct.name || ' reassigned to ' || coalesce(v_names, 'someone') || '.'
        else v_ct.name || ' rotation updated: every ' || p_interval_days || ' day(s) between ' || coalesce(v_names, 'the group') || '.'
      end,
      'chore_updated');
end;
$$;

-- ============================================================
-- FUNCTIONS: resources & stock
-- ============================================================

create or replace function check_resource_alert(p_resource_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_res resources%rowtype;
begin
  select * into v_res from resources where id = p_resource_id;
  if not found then return; end if;

  if v_res.qty <= 0 then
    if not exists(select 1 from stock_items where resource_id = p_resource_id and status = 'out') then
      insert into stock_items(group_id, name, resource_id, status, flagged_by)
        values (v_res.group_id, v_res.name, p_resource_id, 'out', auth.uid());
      insert into activity_log(group_id, text, type)
        values (v_res.group_id, v_res.name || ' just ran out.', 'stock_out');
    end if;
  else
    update stock_items set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
      where resource_id = p_resource_id and status = 'out';
  end if;
end;
$$;

create or replace function set_resource_qty(p_resource_id uuid, p_qty numeric)
returns void
language plpgsql security definer
as $$
declare v_res resources%rowtype;
begin
  select * into v_res from resources where id = p_resource_id;
  if not found then return; end if;
  if not is_group_member(v_res.group_id) then raise exception 'Not authorized'; end if;
  update resources set qty = greatest(0, p_qty) where id = p_resource_id;
  perform check_resource_alert(p_resource_id);
end;
$$;

create or replace function flag_out_of_stock(p_group_id uuid, p_name text)
returns uuid
language plpgsql security definer
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  select display_name into v_name from memberships where group_id = p_group_id and user_id = auth.uid();
  insert into stock_items(group_id, name, status, flagged_by) values (p_group_id, p_name, 'out', auth.uid())
    returning id into v_id;
  insert into activity_log(group_id, text, type)
    values (p_group_id, coalesce(v_name, 'Someone') || ' flagged "' || p_name || '" as out.', 'stock_out');
  return v_id;
end;
$$;

create or replace function resolve_stock_item(p_item_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_item stock_items%rowtype;
  v_name text;
begin
  select * into v_item from stock_items where id = p_item_id;
  if not found then return; end if;
  if not is_group_member(v_item.group_id) then raise exception 'Not authorized'; end if;
  select display_name into v_name from memberships where group_id = v_item.group_id and user_id = auth.uid();
  update stock_items set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_item_id;
  insert into activity_log(group_id, text, type)
    values (v_item.group_id, coalesce(v_name, 'Someone') || ' marked "' || v_item.name || '" as restocked.', 'stock_resolved');
end;
$$;

-- ============================================================
-- FUNCTIONS: completing scheduled chore_events
-- ============================================================

create or replace function complete_chore_event(p_event_id uuid, p_photo_url text default null)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_person_name text;
  r record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This chore requires a photo to mark it done';
  end if;

  update chore_events set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
    where id = p_event_id;

  if v_ct.has_resources then
    for r in select resource_id, qty_per_completion from chore_type_resources where chore_type_id = v_ct.id loop
      update resources set qty = greatest(0, qty - r.qty_per_completion) where id = r.resource_id;
      perform check_resource_alert(r.resource_id);
    end loop;
  end if;

  select display_name into v_person_name from memberships
    where group_id = v_event.group_id and user_id = v_event.assigned_user_id;

  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".', 'done');
end;
$$;

create or replace function delay_chore_event(p_event_id uuid, p_days int)
returns void
language plpgsql security definer
as $$
declare
  v_target chore_events%rowtype;
  v_ct_name text;
  v_person_name text;
begin
  select * into v_target from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_target.group_id) then raise exception 'Not authorized'; end if;

  update chore_events set date = date + p_days
    where chore_type_id = v_target.chore_type_id and status = 'pending' and date >= v_target.date;

  select name into v_ct_name from chore_types where id = v_target.chore_type_id;
  select display_name into v_person_name from memberships
    where group_id = v_target.group_id and user_id = v_target.assigned_user_id;

  insert into activity_log(group_id, text, type)
    values (v_target.group_id,
      'Delayed ' || p_days || ' day(s): ' || v_ct_name || ' (' || coalesce(v_person_name,'someone') || E'\'s turn) and later turns shifted.',
      'delay');
end;
$$;

-- ============================================================
-- FUNCTIONS: trades
-- ============================================================

create or replace function request_trade(p_from_event_id uuid, p_to_event_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_from chore_events%rowtype;
  v_to chore_events%rowtype;
  v_trade_id uuid;
  v_from_name text;
  v_to_name text;
begin
  select * into v_from from chore_events where id = p_from_event_id;
  select * into v_to from chore_events where id = p_to_event_id;
  if v_from.id is null or v_to.id is null or v_from.group_id <> v_to.group_id then
    return null;
  end if;
  if not is_group_member(v_from.group_id) then raise exception 'Not authorized'; end if;
  if v_from.chore_type_id <> v_to.chore_type_id then
    raise exception 'Can only trade turns within the same rotation';
  end if;
  if v_from.status <> 'pending' or v_to.status <> 'pending' then
    raise exception 'Can only trade turns that have not happened yet';
  end if;

  insert into trades(group_id, from_event_id, to_event_id, from_user_id, to_user_id, status)
    values (v_from.group_id, p_from_event_id, p_to_event_id, v_from.assigned_user_id, v_to.assigned_user_id, 'pending')
    returning id into v_trade_id;

  select display_name into v_from_name from memberships where group_id = v_from.group_id and user_id = v_from.assigned_user_id;
  select display_name into v_to_name from memberships where group_id = v_to.group_id and user_id = v_to.assigned_user_id;

  insert into activity_log(group_id, text, type)
    values (v_from.group_id, coalesce(v_from_name,'Someone') || ' proposed a swap with ' || coalesce(v_to_name,'someone') || '.', 'trade');

  return v_trade_id;
end;
$$;

create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
returns void
language plpgsql security definer
as $$
declare
  v_trade trades%rowtype;
  v_from_name text;
  v_to_name text;
begin
  select * into v_trade from trades where id = p_trade_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_trade.group_id) then raise exception 'Not authorized'; end if;

  update trades set status = case when p_accept then 'accepted' else 'declined' end where id = p_trade_id;

  if p_accept then
    update chore_events set assigned_user_id = v_trade.to_user_id where id = v_trade.from_event_id;
    update chore_events set assigned_user_id = v_trade.from_user_id where id = v_trade.to_event_id;
  end if;

  select display_name into v_from_name from memberships where group_id = v_trade.group_id and user_id = v_trade.from_user_id;
  select display_name into v_to_name from memberships where group_id = v_trade.group_id and user_id = v_trade.to_user_id;

  insert into activity_log(group_id, text, type)
    values (v_trade.group_id,
      'Trade ' || (case when p_accept then 'accepted' else 'declined' end) || ': ' ||
      coalesce(v_from_name,'?') || ' \u2194 ' || coalesce(v_to_name,'?') || '.',
      'trade');
end;
$$;

-- ============================================================
-- FUNCTIONS: counters (count-up trigger chores)
-- ============================================================

create or replace function increment_counter(p_chore_type_id uuid, p_amount int default 1)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_new_count int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_counter = true;
  if not found then return; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  update chore_types set counter_current = counter_current + p_amount
    where id = p_chore_type_id
    returning counter_current into v_new_count;

  if v_new_count >= v_ct.counter_threshold then
    insert into chore_runs(chore_type_id, group_id, trigger_reason, status)
      values (p_chore_type_id, v_ct.group_id, 'counter_threshold', 'pending');
    update chore_types set counter_current = 0 where id = p_chore_type_id;
    insert into activity_log(group_id, text, type)
      values (v_ct.group_id, v_ct.name || ' hit its limit \u2014 time to do it.', 'counter');
  end if;
end;
$$;

-- ============================================================
-- FUNCTIONS: timers (cycle chores — dishwasher, washer, dryer)
-- ============================================================

create or replace function start_timer(p_chore_type_id uuid, p_cycle_minutes int, p_assignee_ids uuid[] default null)
returns uuid
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_id uuid;
  v_name text;
  v_assignees uuid[];
  v_bad_count int;
  v_names text;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_timer = true;
  if not found then raise exception 'Not a timer chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  -- Whoever starts it is always on the hook too, even if they also pick
  -- others — "one, some, or all, always including the person who set it".
  v_assignees := coalesce(p_assignee_ids, array[]::uuid[]);
  if not (auth.uid() = any(v_assignees)) then
    v_assignees := v_assignees || auth.uid();
  end if;

  select count(*) into v_bad_count
    from unnest(v_assignees) uid
    where not exists (select 1 from memberships m where m.group_id = v_ct.group_id and m.user_id = uid);
  if v_bad_count > 0 then
    raise exception 'One or more selected people are not members of this group';
  end if;

  insert into chore_runs(chore_type_id, group_id, trigger_reason, status, started_by, started_at, cycle_minutes, cycle_ends_at)
    values (p_chore_type_id, v_ct.group_id, 'timer_cycle', 'running', auth.uid(), now(),
            p_cycle_minutes, now() + (p_cycle_minutes || ' minutes')::interval)
    returning id into v_id;

  insert into chore_run_assignees(chore_run_id, user_id)
    select v_id, uid from unnest(v_assignees) uid;

  select display_name into v_name from memberships where group_id = v_ct.group_id and user_id = auth.uid();
  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = v_ct.group_id and user_id = any(v_assignees);
  insert into activity_log(group_id, text, type)
    values (v_ct.group_id, coalesce(v_name,'Someone') || ' started ' || v_ct.name || ' (' || p_cycle_minutes || ' min) — ' ||
      coalesce(v_names, 'no one') || ' will be notified when it''s ready.', 'timer');

  return v_id;
end;
$$;

-- ============================================================
-- FUNCTIONS: one-time tasks (not periodical — assigned once, then gone)
-- ============================================================
--
-- For a task like "call the landlord", "take the couch to donate", or
-- "unload the dishwasher" (spun up automatically once a timer cycle
-- finishes — see create_onetime_task_system below): no rotation, no
-- interval, just once. It can go to one specific person, or to a handful
-- of people where whoever gets to it first is the one who did it — that's
-- what chore_event_assignees is for. Distinct from a "timer" chore type
-- (has_timer), which is the *reusable, repeatable* cycle itself (the wash
-- actually running); a one-time task is the human follow-up action.
--
-- Completed one-time tasks are NOT deleted (an earlier version of this did
-- that) — they're kept as status='done' so they show up in leaderboard
-- points and per-person history. The app should just filter its "active
-- tasks" list to status='pending'; a separate history/profile view reads
-- the 'done' ones.

create or replace function _create_onetime_task_core(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_assignee_ids uuid[],
  p_due_date date,
  p_requires_photo boolean
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_event_id uuid;
  v_bad_count int;
  v_person_count int;
  v_names text;
begin
  v_person_count := coalesce(array_length(p_assignee_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Pick at least one person';
  end if;

  select count(*) into v_bad_count
    from unnest(p_assignee_ids) uid
    where not exists (select 1 from memberships m where m.group_id = p_group_id and m.user_id = uid);
  if v_bad_count > 0 then
    raise exception 'One or more selected people are not members of this group';
  end if;

  -- has_schedule stays false: nothing will ever regenerate another
  -- occurrence of this chore_type.
  insert into chore_types(group_id, name, icon, has_schedule, requires_photo)
    values (p_group_id, p_name, p_icon, false, coalesce(p_requires_photo, false))
    returning id into v_chore_type_id;

  insert into chore_events(chore_type_id, group_id, date, assigned_user_id, status)
    values (v_chore_type_id, p_group_id, p_due_date,
      case when v_person_count = 1 then p_assignee_ids[1] else null end,
      'pending')
    returning id into v_event_id;

  insert into chore_event_assignees(chore_event_id, user_id)
    select v_event_id, uid from unnest(p_assignee_ids) uid;

  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = p_group_id and user_id = any(p_assignee_ids);

  insert into activity_log(group_id, text, type)
    values (p_group_id,
      case when v_person_count = 1
        then coalesce(v_names, 'Someone') || ' was given a one-time task: ' || p_name || '.'
        else p_name || ' was offered to ' || coalesce(v_names, 'a few people') || ' — first to do it gets it.'
      end,
      'chore_created');

  return v_event_id;
end;
$$;

create or replace function create_onetime_task(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_assignee_ids uuid[],
  p_due_date date default current_date,
  p_requires_photo boolean default false
)
returns uuid
language plpgsql security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  return _create_onetime_task_core(p_group_id, p_name, p_icon, p_assignee_ids, p_due_date, p_requires_photo);
end;
$$;

-- Same thing, but with no is_group_member(auth.uid()) gate — because when
-- daily-check spins up "unload the dishwasher" after a timer finishes,
-- it's calling this with the service-role key, and there's no logged-in
-- person for auth.uid() to resolve to. Locked down below via REVOKE/GRANT
-- so only the service role (i.e. your own trusted edge functions) can
-- call it — a normal user hitting this over the API would otherwise be
-- able to create tasks in groups they don't belong to.
create or replace function create_onetime_task_system(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_assignee_ids uuid[],
  p_due_date date default current_date,
  p_requires_photo boolean default false
)
returns uuid
language plpgsql security definer
as $$
begin
  return _create_onetime_task_core(p_group_id, p_name, p_icon, p_assignee_ids, p_due_date, p_requires_photo);
end;
$$;

revoke execute on function create_onetime_task_system(uuid, text, text, uuid[], date, boolean) from public, anon, authenticated;
grant execute on function create_onetime_task_system(uuid, text, text, uuid[], date, boolean) to service_role;

create or replace function complete_onetime_task(p_event_id uuid, p_photo_url text default null)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_name text;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  -- Only someone actually offered this task can complete it (matters for
  -- the multi-assignee case — first eligible person to tap "done" wins it).
  if not exists (select 1 from chore_event_assignees where chore_event_id = p_event_id and user_id = auth.uid()) then
    raise exception 'You are not one of the people this task was assigned to';
  end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.has_schedule then
    raise exception 'This is a recurring task — use complete_chore_event instead';
  end if;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This task requires a photo to mark it done';
  end if;

  update chore_events set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
    where id = p_event_id;

  select display_name into v_name from memberships where group_id = v_event.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_name, 'Someone') || ' completed "' || v_ct.name || '".', 'done');
end;
$$;

-- ============================================================
-- CALENDAR EXPORT (subscribe-by-URL feed for Google/Apple/Outlook Calendar)
-- ============================================================
--
-- Real two-way Google Calendar sync needs OAuth (a consent screen, storing
-- refresh tokens per user, and a background job pushing every create/
-- update/delete) which is a lot of moving parts for what's usually wanted
-- here. An ICS "subscribe by URL" feed gets 90% of the value with none of
-- that: each member gets a private, unguessable link; they add it to
-- Google Calendar (or Apple/Outlook) as a subscribed calendar, and their
-- turns just show up alongside everything else. The trade-off is that
-- calendar apps only refresh subscribed URLs every few hours (Google is
-- typically ~8-24h), so it won't be instant.

create table if not exists calendar_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

-- Deliberately its own table, not a column on memberships: memberships is
-- readable by the whole group (so people can see the roster), but a
-- calendar token is a bearer secret and must only ever be visible to the
-- person it belongs to.
alter table calendar_tokens enable row level security;
drop policy if exists "own calendar tokens" on calendar_tokens;
create policy "own calendar tokens" on calendar_tokens for select
  using (user_id = auth.uid());
-- No insert/update/delete policy — tokens are only issued or rotated
-- through the security-definer functions below.

create or replace function get_or_create_calendar_token(p_group_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_token uuid;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  select token into v_token from calendar_tokens where user_id = auth.uid() and group_id = p_group_id;
  if v_token is null then
    insert into calendar_tokens(user_id, group_id) values (auth.uid(), p_group_id)
      returning token into v_token;
  end if;
  return v_token;
end;
$$;

-- Call this if a token ever leaks (e.g. someone shared their calendar
-- link by mistake) — old subscriptions using the previous link stop
-- working and the app should show the new one.
create or replace function rotate_calendar_token(p_group_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_token uuid;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  update calendar_tokens set token = gen_random_uuid()
    where user_id = auth.uid() and group_id = p_group_id
    returning token into v_token;
  if v_token is null then
    insert into calendar_tokens(user_id, group_id) values (auth.uid(), p_group_id)
      returning token into v_token;
  end if;
  return v_token;
end;
$$;

create or replace function complete_chore_run(p_run_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_run chore_runs%rowtype;
  v_ct chore_types%rowtype;
  v_name text;
  r record;
begin
  select * into v_run from chore_runs where id = p_run_id and status in ('pending','running');
  if not found then return; end if;
  if not is_group_member(v_run.group_id) then raise exception 'Not authorized'; end if;

  update chore_runs set status = 'done', done_at = now(), done_by = auth.uid() where id = p_run_id;

  select * into v_ct from chore_types where id = v_run.chore_type_id;

  if v_ct.has_resources then
    for r in select resource_id, qty_per_completion from chore_type_resources where chore_type_id = v_ct.id loop
      update resources set qty = greatest(0, qty - r.qty_per_completion) where id = r.resource_id;
      perform check_resource_alert(r.resource_id);
    end loop;
  end if;

  select display_name into v_name from memberships where group_id = v_run.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_run.group_id, coalesce(v_name,'Someone') || ' finished ' || v_ct.name || '.', 'done');
end;
$$;

-- ============================================================
-- FUNCTIONS: leaderboard & per-person history
-- ============================================================
--
-- Points are not a stored/mutable ledger — they're just a count of
-- completed work, computed on read. That keeps them always consistent
-- with the activity log and impossible to drift out of sync. A
-- completion only counts if done_by is set to a real person: the
-- system-triggered auto-close of a finished timer cycle (see
-- create_onetime_task_system and daily-check) leaves done_by null on
-- purpose, so the cycle finishing on its own doesn't hand anyone a point
-- — only the person who actually does the follow-up task does.

create or replace function get_leaderboard(
  p_group_id uuid,
  p_since date default (current_date - 6), -- default: trailing 7 days ("this week")
  p_until date default current_date
)
returns table (
  user_id uuid,
  display_name text,
  points bigint
)
language plpgsql stable security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  return query
    select m.user_id, m.display_name, coalesce(c.points, 0)::bigint as points
    from memberships m
    left join (
      select done_by, count(*) as points
      from (
        select done_by, done_at from chore_events
        where group_id = p_group_id and status = 'done' and done_by is not null
          and done_at::date between p_since and p_until
        union all
        select done_by, done_at from chore_runs
        where group_id = p_group_id and status = 'done' and done_by is not null
          and done_at::date between p_since and p_until
      ) completions
      group by done_by
    ) c on c.done_by = m.user_id
    where m.group_id = p_group_id
    order by points desc, m.display_name asc;
end;
$$;

-- Everything one person has completed in a group — feeds a profile view:
-- tap your own name to see your history, tap someone else's to see theirs.
create or replace function get_member_history(p_group_id uuid, p_user_id uuid)
returns table (
  kind text, -- 'chore' (a scheduled turn or one-time task) | 'cycle' (a timer run)
  name text,
  icon text,
  done_at timestamptz,
  photo_url text
)
language plpgsql stable security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  return query
    select 'chore'::text, ct.name, ct.icon, ce.done_at, ce.photo_url
    from chore_events ce
    join chore_types ct on ct.id = ce.chore_type_id
    where ce.group_id = p_group_id and ce.done_by = p_user_id and ce.status = 'done'
    union all
    select 'cycle'::text, ct.name, ct.icon, cr.done_at, null::text
    from chore_runs cr
    join chore_types ct on ct.id = cr.chore_type_id
    where cr.group_id = p_group_id and cr.done_by = p_user_id and cr.status = 'done'
    order by done_at desc;
end;
$$;

-- ============================================================
-- FUNCTIONS: calendar widget data
-- ============================================================
--
-- One call per month instead of the client stitching together several
-- queries. Returns a JSON object keyed by "YYYY-MM-DD", each holding the
-- list of tasks due that day — exactly the shape a month-grid widget wants.
create or replace function get_calendar_month(p_group_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql stable security definer
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end date := (v_start + interval '1 month')::date;
  v_result jsonb;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  select jsonb_object_agg(day, items) into v_result
  from (
    select to_char(ce.date, 'YYYY-MM-DD') as day,
      jsonb_agg(jsonb_build_object(
        'id', ce.id,
        'name', ct.name,
        'icon', ct.icon,
        'status', ce.status,
        'requires_photo', ct.requires_photo,
        'assigned_user_id', ce.assigned_user_id,
        'display_name', mem.display_name
      ) order by ct.name) as items
    from chore_events ce
    join chore_types ct on ct.id = ce.chore_type_id
    left join memberships mem on mem.group_id = ce.group_id and mem.user_id = ce.assigned_user_id
    where ce.group_id = p_group_id and ce.date >= v_start and ce.date < v_end
    group by ce.date
  ) grouped;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- ============================================================
-- STORAGE: chore-photos bucket (optional proof-of-completion photos)
-- ============================================================
--
-- Private bucket. Path convention the app must follow when uploading:
--   {group_id}/{chore_event_id}-{timestamp}.jpg
-- The policies below check the group_id in the path against
-- is_group_member, so only people in that group can upload into or read
-- from that group's folder. Store the returned storage *path* (not a
-- public URL) in chore_events.photo_url, and render it client-side via
-- supabase.storage.from('chore-photos').createSignedUrl(path, 3600) —
-- signed URLs expire, so a leaked link doesn't stay valid forever.

insert into storage.buckets (id, name, public)
values ('chore-photos', 'chore-photos', false)
on conflict (id) do nothing;

drop policy if exists "group members can read chore photos" on storage.objects;
create policy "group members can read chore photos" on storage.objects for select
  using (
    bucket_id = 'chore-photos'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "group members can upload chore photos" on storage.objects;
create policy "group members can upload chore photos" on storage.objects for insert
  with check (
    bucket_id = 'chore-photos'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );
