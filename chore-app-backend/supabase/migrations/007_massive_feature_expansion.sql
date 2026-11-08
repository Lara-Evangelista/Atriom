-- Massive Feature Expansion: Timezones, Permissions, Advanced Schedules, Delays, Shared Completions

-- 1. Group & Membership Settings
alter table groups
  add column if not exists timezone text default 'UTC',
  add column if not exists allow_anyone_to_edit_chores boolean default true;

alter table memberships
  add column if not exists notification_hour int default 9,
  add column if not exists notification_preferences jsonb default '{"daily_chores": true, "timers": true, "supermarket": true}'::jsonb,
  add column if not exists pronouns text default 'they/them';

-- 2. Chore Customization
alter table chore_types
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists advanced_schedule jsonb, -- e.g. {"1": "15:00", "3": "14:00"} where 1=Mon
  add column if not exists is_delayable boolean default true,
  add column if not exists max_consecutive_delays int default 3,
  add column if not exists is_rotational boolean default true;

-- 3. Delays Tracking
alter table chore_events
  add column if not exists consecutive_delays_count int default 0;

-- 4. Shared Completions Table
create table if not exists chore_event_completions (
  event_id uuid not null references chore_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);

-- Enable RLS on completions
alter table chore_event_completions enable row level security;
drop policy if exists "members access completions" on chore_event_completions;
create policy "members access completions" on chore_event_completions for all
  using (exists(select 1 from chore_events ce where ce.id = event_id and is_group_member(ce.group_id)))
  with check (exists(select 1 from chore_events ce where ce.id = event_id and is_group_member(ce.group_id)));

-- 5. Delay Chore RPC
create or replace function delay_chore_event(p_event_id uuid, p_days int)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then raise exception 'Event not found or already done'; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;
  
  select * into v_ct from chore_types where id = v_event.chore_type_id;
  
  if not coalesce(v_ct.is_delayable, true) then raise exception 'This chore cannot be delayed'; end if;
  if v_ct.max_consecutive_delays is not null and coalesce(v_event.consecutive_delays_count, 0) >= v_ct.max_consecutive_delays then
    raise exception 'Maximum delays reached';
  end if;

  -- Update this specific event
  update chore_events 
  set date = date + (p_days || ' days')::interval,
      consecutive_delays_count = coalesce(consecutive_delays_count, 0) + 1
  where id = p_event_id;

  -- Push all future pending events for this chore type forward by p_days
  update chore_events
  set date = date + (p_days || ' days')::interval
  where chore_type_id = v_event.chore_type_id 
    and status = 'pending' 
    and id != p_event_id 
    and date >= v_event.date; -- push things that were scheduled after the ORIGINAL date of this event

  -- Push the last_event_date forward so future schedule generation stays in sync
  update chore_types
  set last_event_date = last_event_date + (p_days || ' days')::interval
  where id = v_event.chore_type_id;
end;
$$;

-- 6. Shared Completion RPC Update
create or replace function complete_chore_event(
  p_event_id uuid,
  p_photo_url text default null,
  p_credited_user_ids uuid[] default null
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This chore requires a photo to mark it done';
  end if;

  -- Default to the person clicking the button if no array passed
  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  update chore_events 
  set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
  where id = p_event_id;

  -- Credit all selected users
  insert into chore_event_completions (event_id, user_id)
  select p_event_id, unnest(p_credited_user_ids)
  on conflict do nothing;
end;
$$;

-- 7. Update Leaderboard to count from completions table OR fallback to done_by
create or replace function get_leaderboard(
  p_group_id uuid,
  p_since date default (current_date - 6),
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
      select cec.user_id, count(*) as points
      from chore_event_completions cec
      join chore_events ce on ce.id = cec.event_id
      where ce.group_id = p_group_id
        and ce.status = 'done'
        and date(ce.done_at) >= p_since
        and date(ce.done_at) <= p_until
      group by cec.user_id
    ) c on c.user_id = m.user_id
    where m.group_id = p_group_id
    order by points desc, display_name asc;
end;
$$;

-- 8. Advanced Scheduling & Ultimate Flexibility (ensure_chore_events)
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
  v_attempts int;
  i int;
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
    
    if coalesce(v_ct.is_rotational, true) then
      v_uid := v_people[v_idx + 1];
      insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status)
        values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending')
        returning id into v_event_id;
      insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    else
      -- Non-rotational: assign EVERYONE to the same event
      insert into chore_events(chore_type_id, group_id, date, status)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending')
        returning id into v_event_id;
      for i in 1..v_count loop
        insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_people[i]) on conflict do nothing;
      end loop;
    end if;
    
    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end if;

  while v_date < p_through_date loop
    if v_ct.advanced_schedule is not null then
      v_attempts := 0;
      loop
        v_date := v_date + 1;
        v_attempts := v_attempts + 1;
        if v_ct.advanced_schedule ? extract(isodow from v_date)::text or v_attempts > 7 then
          exit;
        end if;
      end loop;
    else
      v_date := v_date + coalesce(v_ct.schedule_interval_days, 1);
    end if;

    if coalesce(v_ct.is_rotational, true) then
      v_idx := (v_idx + 1) % v_count;
      v_uid := v_people[v_idx + 1];
      insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status)
        values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending')
        returning id into v_event_id;
      insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    else
      insert into chore_events(chore_type_id, group_id, date, status)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending')
        returning id into v_event_id;
      for i in 1..v_count loop
        insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_people[i]) on conflict do nothing;
      end loop;
    end if;

    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end loop;
end;
$$;

-- 9. Settings RPCs
create or replace function update_personal_settings(
  p_group_id uuid,
  p_display_name text,
  p_avatar_url text,
  p_notification_hour int,
  p_notification_preferences jsonb,
  p_pronouns text
)
returns void
language plpgsql security definer
as $$
begin
  update memberships 
  set display_name = p_display_name, 
      avatar_url = p_avatar_url,
      notification_hour = p_notification_hour,
      notification_preferences = p_notification_preferences,
      pronouns = p_pronouns
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

create or replace function update_household_settings(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_allow_anyone_to_edit_chores boolean
)
returns void
language plpgsql security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  update groups 
  set name = p_name, 
      icon = p_icon,
      allow_anyone_to_edit_chores = p_allow_anyone_to_edit_chores
  where id = p_group_id;
end;
$$;

-- 10. Update create_chore_type_scheduled
create or replace function create_chore_type_scheduled(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default false,
  p_advanced_schedule jsonb default null,
  p_is_rotational boolean default true,
  p_is_delayable boolean default true,
  p_max_consecutive_delays int default 3
)
returns uuid
language plpgsql security definer
as $body$
declare
  v_chore_type_id uuid;
  v_person_count int;
  i int;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not authorized';
  end if;
  
  v_person_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Must provide at least one user id';
  end if;

  insert into chore_types (
    group_id, name, icon, has_schedule, schedule_interval_days, requires_photo, created_by,
    advanced_schedule, is_rotational, is_delayable, max_consecutive_delays
  ) values (
    p_group_id, p_name, p_icon, true, p_interval_days, p_requires_photo, auth.uid(),
    p_advanced_schedule, p_is_rotational, p_is_delayable, p_max_consecutive_delays
  ) returning id into v_chore_type_id;

  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (v_chore_type_id, p_user_ids[i], i);
  end loop;

  perform ensure_chore_events(v_chore_type_id, current_date + 30);
  return v_chore_type_id;
end;
$body$;

-- 11. Update update_chore_schedule
create or replace function update_chore_schedule(
  p_chore_type_id uuid,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default null,
  p_advanced_schedule jsonb default null,
  p_is_rotational boolean default null,
  p_is_delayable boolean default null,
  p_max_consecutive_delays int default null
)
returns void
language plpgsql security definer
as $body$
declare
  v_ct chore_types%rowtype;
  v_person_count int;
  i int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_schedule = true;
  if not found then raise exception 'Not a scheduled chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Interval must be at least 1 day';
  end if;

  v_person_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Must provide at least one user id';
  end if;

  update chore_types set 
    schedule_interval_days = p_interval_days,
    requires_photo = coalesce(p_requires_photo, requires_photo),
    advanced_schedule = coalesce(p_advanced_schedule, advanced_schedule),
    is_rotational = coalesce(p_is_rotational, is_rotational),
    is_delayable = coalesce(p_is_delayable, is_delayable),
    max_consecutive_delays = coalesce(p_max_consecutive_delays, max_consecutive_delays)
  where id = p_chore_type_id;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (p_chore_type_id, p_user_ids[i], i);
  end loop;
end;
$body$;
