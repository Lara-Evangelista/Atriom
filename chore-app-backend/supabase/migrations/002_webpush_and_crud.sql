-- Migration 002: Web Push + full chore CRUD
-- Run this in the Supabase SQL editor after schema.sql.
--
-- Two independent changes bundled together:
--
-- 1. PUSH: swaps the Expo-only push_tokens table for push_subscriptions,
--    which stores standard Web Push subscriptions (endpoint + keys) that
--    any browser (desktop or Android Chrome) can generate. See the
--    updated notify/daily-check edge functions, which now speak the Web
--    Push protocol instead of Expo's.
--
-- 2. CRUD: every chore type (scheduled, one-time, counter, timer) can now
--    have its name/icon renamed, its resource usage edited, and be
--    deleted (soft: archived + future pending occurrences removed,
--    history kept). One-time tasks can have their assignees/due date
--    edited or be deleted outright.

-- ============================================================
-- WEB PUSH SUBSCRIPTIONS
-- ============================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on push_subscriptions;
create policy "own push subscriptions" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Upsert-by-endpoint: a browser calls this once per subscription. If the
-- same endpoint somehow re-registers under a different account (e.g.
-- shared/reset device), it moves to the new owner rather than erroring.
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer
as $$
begin
  insert into push_subscriptions(user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function remove_push_subscription(p_endpoint text)
returns void
language plpgsql security definer
as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- Expo push tokens are no longer used by any edge function — replaced by
-- push_subscriptions above.
drop table if exists push_tokens;

alter publication supabase_realtime add table push_subscriptions;

-- ============================================================
-- CHORE CRUD: rename/re-icon any chore type
-- ============================================================

create or replace function update_chore_details(p_chore_type_id uuid, p_name text, p_icon text)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not found then raise exception 'Chore not found'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Name cannot be empty'; end if;

  update chore_types set name = trim(p_name), icon = p_icon where id = p_chore_type_id;

  if v_ct.name <> trim(p_name) then
    insert into activity_log(group_id, text, type)
      values (v_ct.group_id, '"' || v_ct.name || '" was renamed to "' || trim(p_name) || '".', 'chore_updated');
  end if;
end;
$$;

-- ============================================================
-- CHORE CRUD: delete (archive) any chore type
-- ============================================================
--
-- Soft delete: marks archived so it drops out of Create/Today/schedule
-- generation, removes not-yet-done future occurrences (they were built
-- around a setup that no longer exists — e.g. the guinea pigs are gone,
-- so "clean the cage" turns that haven't happened yet make no sense),
-- but leaves completed history and leaderboard points untouched.

create or replace function archive_chore_type(p_chore_type_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_name text;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not found then return; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  update chore_types set archived = true where id = p_chore_type_id;

  delete from chore_events
    where chore_type_id = p_chore_type_id and status = 'pending' and date >= current_date;
  delete from chore_runs
    where chore_type_id = p_chore_type_id and status in ('pending', 'running');

  select display_name into v_name from memberships
    where group_id = v_ct.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_ct.group_id, coalesce(v_name, 'Someone') || ' deleted "' || v_ct.name || '".', 'chore_deleted');
end;
$$;

-- In case a chore gets deleted by mistake.
create or replace function unarchive_chore_type(p_chore_type_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not found then return; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  update chore_types set archived = false where id = p_chore_type_id;

  if v_ct.has_schedule then
    perform ensure_chore_events(p_chore_type_id, current_date + 30);
  end if;
end;
$$;

-- ============================================================
-- CHORE CRUD: counter threshold
-- ============================================================

create or replace function update_counter_threshold(p_chore_type_id uuid, p_threshold int)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_counter = true;
  if not found then raise exception 'Not a counter chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;
  if p_threshold is null or p_threshold < 1 then raise exception 'Threshold must be at least 1'; end if;

  update chore_types set counter_threshold = p_threshold where id = p_chore_type_id;
end;
$$;

-- ============================================================
-- CHORE CRUD: which resources a chore type uses, and how much
-- ============================================================
--
-- Full replace, same pattern as update_chore_schedule's roster swap:
-- pass the complete new set of (resource_id, qty) pairs and it replaces
-- whatever was there. Pass empty arrays to stop tracking resource usage
-- entirely for this chore.

create or replace function update_chore_resources(
  p_chore_type_id uuid,
  p_resource_ids uuid[],
  p_qtys numeric[]
)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_count int;
  v_bad_count int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not found then raise exception 'Chore not found'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  v_count := coalesce(array_length(p_resource_ids, 1), 0);
  if v_count <> coalesce(array_length(p_qtys, 1), 0) then
    raise exception 'resource_ids and qtys must be the same length';
  end if;

  select count(*) into v_bad_count
    from unnest(p_resource_ids) rid
    where not exists (select 1 from resources r where r.id = rid and r.group_id = v_ct.group_id);
  if v_bad_count > 0 then
    raise exception 'One or more resources do not belong to this group';
  end if;

  delete from chore_type_resources where chore_type_id = p_chore_type_id;
  if v_count > 0 then
    insert into chore_type_resources(chore_type_id, resource_id, qty_per_completion)
      select p_chore_type_id, rid.val, qty.val
      from unnest(p_resource_ids) with ordinality as rid(val, ord)
      join unnest(p_qtys) with ordinality as qty(val, ord) using (ord);
  end if;

  update chore_types set has_resources = (v_count > 0) where id = p_chore_type_id;
end;
$$;

-- ============================================================
-- CHORE CRUD: edit or delete a one-time task
-- ============================================================

create or replace function update_onetime_task(
  p_event_id uuid,
  p_assignee_ids uuid[],
  p_due_date date default null -- null = leave as-is
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_bad_count int;
  v_person_count int;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then raise exception 'Task not found or already done'; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.has_schedule then
    raise exception 'This is a recurring rotation — use update_chore_schedule instead';
  end if;

  v_person_count := coalesce(array_length(p_assignee_ids, 1), 0);
  if v_person_count = 0 then raise exception 'Pick at least one person'; end if;

  select count(*) into v_bad_count
    from unnest(p_assignee_ids) uid
    where not exists (select 1 from memberships m where m.group_id = v_event.group_id and m.user_id = uid);
  if v_bad_count > 0 then
    raise exception 'One or more selected people are not members of this group';
  end if;

  update chore_events
    set assigned_user_id = case when v_person_count = 1 then p_assignee_ids[1] else null end,
        date = coalesce(p_due_date, date)
    where id = p_event_id;

  delete from chore_event_assignees where chore_event_id = p_event_id;
  insert into chore_event_assignees(chore_event_id, user_id)
    select p_event_id, uid from unnest(p_assignee_ids) uid;
end;
$$;

create or replace function delete_onetime_task(p_event_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
begin
  select * into v_event from chore_events where id = p_event_id;
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  -- Also archive the backing chore_type — one-time tasks own a
  -- dedicated, never-reused chore_type (see _create_onetime_task_core),
  -- so cleaning that up too avoids orphaned rows and keeps it out of any
  -- chore-type listing.
  update chore_types set archived = true where id = v_event.chore_type_id;
  delete from chore_events where id = p_event_id;
end;
$$;
