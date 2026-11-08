-- Migration 033: allow scheduled chores (rotational or shared) to be left
-- unassigned -- "open to anyone" -- the same way one-time tasks already can.
--
-- Three things blocked this before:
--
-- 1. create_chore_type_scheduled and update_chore_schedule both raised
--    'Must provide at least one user id' whenever p_user_ids was empty.
--    That's a pure client-facing guard rail -- nothing downstream actually
--    needed a non-empty roster.
--
-- 2. ensure_chore_events bailed out immediately ("if v_count = 0 then
--    return; end if") whenever a chore type had zero people in
--    chore_type_rotation, so even if the two functions above had allowed
--    it through, no calendar events would ever be generated for an
--    unassigned scheduled chore.
--
-- 3. complete_chore_event / complete_onetime_task already handle a
--    "genuinely unassigned" event correctly (completing it claims it for
--    whoever taps it, per the fix in 028) -- so the completion side needs
--    no changes. This migration only has to make sure unassigned events
--    get created and regenerated in the first place.
--
-- For an unassigned chore, generated events simply carry no
-- rotation_user_id/assigned_user_id and get no chore_event_assignees rows.
-- That's the same shape complete_chore_event already treats as "open for
-- anyone."

drop function if exists ensure_chore_events(uuid, date);

create or replace function ensure_chore_events(
  p_chore_type_id uuid,
  p_through_date date
)
returns void language plpgsql security definer as $$
declare
  v_ct record;
  v_people uuid[];
  v_count int;
  v_idx int;
  v_date date;
  v_uid uuid;
  v_event_id uuid;
  v_attempts int;
  v_is_paused boolean;
  i int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not v_ct.has_schedule or v_ct.archived then return; end if;

  select array_agg(user_id order by sort_order) into v_people
    from chore_type_rotation where chore_type_id = p_chore_type_id;
  v_count := coalesce(array_length(v_people, 1), 0);

  v_idx := coalesce(v_ct.last_rotation_index, 0);
  v_date := v_ct.last_event_date;

  -- Cold start: generate first event
  if v_date is null then
    v_date := coalesce(v_ct.start_date, current_date);

    if v_count = 0 then
      -- Unassigned: nobody to pick, just open an event with no assignee.
      insert into chore_events(chore_type_id, group_id, date, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending', v_ct.created_by)
        returning id into v_event_id;
    elsif coalesce(v_ct.is_rotational, true) then
      v_attempts := 0;
      loop
        v_uid := v_people[v_idx + 1];
        select coalesce(is_paused, false) into v_is_paused
          from memberships where user_id = v_uid and group_id = v_ct.group_id;
        v_attempts := v_attempts + 1;
        if not v_is_paused or v_attempts > v_count then exit; end if;
        v_idx := (v_idx + 1) % v_count;
      end loop;

      insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending', v_ct.created_by)
        returning id into v_event_id;
      insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    else
      insert into chore_events(chore_type_id, group_id, date, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending', v_ct.created_by)
        returning id into v_event_id;
      for i in 1..v_count loop
        select coalesce(is_paused, false) into v_is_paused
          from memberships where user_id = v_people[i] and group_id = v_ct.group_id;
        if not v_is_paused then
          insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_people[i]) on conflict do nothing;
        end if;
      end loop;
    end if;

    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end if;

  -- Generate future events
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

    if v_count = 0 then
      insert into chore_events(chore_type_id, group_id, date, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending', v_ct.created_by)
        returning id into v_event_id;
    elsif coalesce(v_ct.is_rotational, true) then
      v_attempts := 0;
      loop
        v_idx := (v_idx + 1) % v_count;
        v_uid := v_people[v_idx + 1];
        select coalesce(is_paused, false) into v_is_paused
          from memberships where user_id = v_uid and group_id = v_ct.group_id;
        v_attempts := v_attempts + 1;
        if not v_is_paused or v_attempts > v_count then exit; end if;
      end loop;

      insert into chore_events(chore_type_id, group_id, date, rotation_user_id, assigned_user_id, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, v_uid, v_uid, 'pending', v_ct.created_by)
        returning id into v_event_id;
      insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    else
      insert into chore_events(chore_type_id, group_id, date, status, created_by)
        values (p_chore_type_id, v_ct.group_id, v_date, 'pending', v_ct.created_by)
        returning id into v_event_id;
      for i in 1..v_count loop
        select coalesce(is_paused, false) into v_is_paused
          from memberships where user_id = v_people[i] and group_id = v_ct.group_id;
        if not v_is_paused then
          insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_people[i]) on conflict do nothing;
        end if;
      end loop;
    end if;

    update chore_types set last_rotation_index = v_idx, last_event_date = v_date where id = p_chore_type_id;
  end loop;
end;
$$;


-- create_chore_type_scheduled: drop the "at least one person" guard.
-- An empty p_user_ids just means the for-loop below inserts zero
-- chore_type_rotation rows, which is exactly what "unassigned" means.
drop function if exists create_chore_type_scheduled(uuid, text, text, int, uuid[], boolean, jsonb, boolean, boolean, int, int, boolean, time, int, boolean, date);

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
  p_max_consecutive_delays int default 3,
  p_coin_reward int default 1,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null,
  p_counts_for_leaderboard boolean default true,
  p_start_date date default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_person_count int;
  v_max_coins int;
  v_actual_approval boolean;
  i int;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not authorized';
  end if;

  v_person_count := coalesce(array_length(p_user_ids, 1), 0);

  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  -- Nobody assigned yet -- no roster to check the self-assignment coin
  -- policy against, and no one to credit until someone claims a turn.
  if v_person_count > 0 then
    perform check_coin_assignment_allowed(p_group_id, p_user_ids, p_coin_reward);
  end if;

  v_actual_approval := coalesce(p_requires_approval, p_requires_photo);

  insert into chore_types (
    group_id, name, icon, has_schedule, schedule_interval_days, requires_photo, created_by,
    advanced_schedule, is_rotational, is_delayable, max_consecutive_delays,
    coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes,
    counts_for_leaderboard, start_date
  ) values (
    p_group_id, p_name, p_icon, true, p_interval_days, p_requires_photo, auth.uid(),
    p_advanced_schedule, p_is_rotational, p_is_delayable, p_max_consecutive_delays,
    p_coin_reward, v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
    coalesce(p_counts_for_leaderboard, true), p_start_date
  ) returning id into v_chore_type_id;

  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (v_chore_type_id, p_user_ids[i], i);
  end loop;

  -- Ensure events through 30 days ahead of either today or the start date
  perform ensure_chore_events(v_chore_type_id, greatest(current_date, coalesce(p_start_date, current_date)) + 30);
  return v_chore_type_id;
end;
$$;


-- update_chore_schedule: same guard removed. Saving an edit with nobody
-- picked switches the chore to unassigned and regenerates the calendar
-- (via the existing delete-future-pending-events + ensure_chore_events
-- path from 029) with open, unclaimed events going forward.
create or replace function update_chore_schedule(
  p_chore_type_id uuid,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default null,
  p_advanced_schedule jsonb default null,
  p_is_rotational boolean default null,
  p_is_delayable boolean default null,
  p_max_consecutive_delays int default null,
  p_coin_reward int default null,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null,
  p_counts_for_leaderboard boolean default null
)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_person_count int;
  v_max_coins int;
  v_effective_coin_reward int;
  i int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_schedule = true;
  if not found then raise exception 'Not a scheduled chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Interval must be at least 1 day';
  end if;

  v_person_count := coalesce(array_length(p_user_ids, 1), 0);

  -- Clamp coin_reward to group max if provided
  if p_coin_reward is not null then
    select max_coin_reward into v_max_coins from groups where id = v_ct.group_id;
    if p_coin_reward > coalesce(v_max_coins, 10) then
      p_coin_reward := coalesce(v_max_coins, 10);
    end if;
  end if;

  -- Whatever the coin_reward will end up being (new value, or unchanged
  -- existing value) needs to pass the policy check against the new
  -- roster -- but only if there is one to check against.
  v_effective_coin_reward := coalesce(p_coin_reward, v_ct.coin_reward);
  if v_person_count > 0 then
    perform check_coin_assignment_allowed(v_ct.group_id, p_user_ids, v_effective_coin_reward);
  end if;

  -- Drop not-yet-done future turns -- they were built around the old
  -- interval/roster/advanced_schedule -- but leave history (done ones)
  -- alone.
  delete from chore_events
    where chore_type_id = p_chore_type_id and status = 'pending' and date >= current_date;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (p_chore_type_id, p_user_ids[i], i);
  end loop;

  update chore_types set
    schedule_interval_days = p_interval_days,
    requires_photo         = coalesce(p_requires_photo, requires_photo),
    advanced_schedule      = coalesce(p_advanced_schedule, advanced_schedule),
    is_rotational          = coalesce(p_is_rotational, is_rotational),
    is_delayable            = coalesce(p_is_delayable, is_delayable),
    max_consecutive_delays = coalesce(p_max_consecutive_delays, max_consecutive_delays),
    coin_reward            = coalesce(p_coin_reward, coin_reward),
    requires_approval      = coalesce(p_requires_approval, requires_approval),
    due_time               = coalesce(p_due_time, due_time),
    overdue_nudge_interval_minutes = coalesce(p_overdue_nudge_interval_minutes, overdue_nudge_interval_minutes),
    counts_for_leaderboard = coalesce(p_counts_for_leaderboard, counts_for_leaderboard),
    start_date              = current_date,
    last_rotation_index     = null,
    last_event_date         = null
  where id = p_chore_type_id;

  perform ensure_chore_events(p_chore_type_id, current_date + 30);
end;
$$;
