-- 1. Add start_date to chore_types
alter table chore_types add column start_date date default null;

-- 2. Update ensure_chore_events to respect start_date
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
  if v_count = 0 then return; end if;

  v_idx := coalesce(v_ct.last_rotation_index, 0);
  v_date := v_ct.last_event_date;

  -- Cold start: generate first event
  if v_date is null then
    -- Use start_date if provided, otherwise default to today
    v_date := coalesce(v_ct.start_date, current_date);
    
    if coalesce(v_ct.is_rotational, true) then
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

    if coalesce(v_ct.is_rotational, true) then
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


-- 3. Update create_chore_type_scheduled to accept start_date
drop function if exists create_chore_type_scheduled(uuid, text, text, int, uuid[], boolean, jsonb, boolean, boolean, int, int, boolean, time, int, boolean);

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
  if v_person_count = 0 then
    raise exception 'Must provide at least one user id';
  end if;

  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  perform check_coin_assignment_allowed(p_group_id, p_user_ids, p_coin_reward);

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


-- 4. RPC for One-Time Timers
create or replace function create_onetime_timer_task(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_assignee_ids uuid[],
  p_due_date date default current_date,
  p_requires_photo boolean default false,
  p_coin_reward int default 1,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null,
  p_counts_for_leaderboard boolean default true,
  p_cycle_minutes int default 60
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_run_id uuid;
  v_uid uuid;
  v_max_coins int;
  v_actual_approval boolean;
  v_names text;
  v_name text;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  perform check_coin_assignment_allowed(p_group_id, p_assignee_ids, p_coin_reward);

  v_actual_approval := coalesce(p_requires_approval, p_requires_photo);

  insert into chore_types(
    group_id, name, icon, has_schedule, has_timer, requires_photo, created_by, coin_reward,
    requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard
  )
    values (
      p_group_id, p_name, p_icon, false, true, p_requires_photo, auth.uid(), p_coin_reward,
      v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
      coalesce(p_counts_for_leaderboard, true)
    )
    returning id into v_chore_type_id;

  -- Create the running timer
  insert into chore_runs(chore_type_id, group_id, trigger_reason, status, started_by, started_at, cycle_minutes, cycle_ends_at)
    values (v_chore_type_id, p_group_id, 'onetime_timer', 'running', auth.uid(), now(),
            p_cycle_minutes, now() + (p_cycle_minutes || ' minutes')::interval)
    returning id into v_run_id;

  foreach v_uid in array p_assignee_ids loop
    insert into chore_run_assignees(chore_run_id, user_id) values (v_run_id, v_uid);
  end loop;

  -- Add to activity log so it shows up in "History" just like a normal timer start
  select display_name into v_name from memberships where group_id = p_group_id and user_id = auth.uid();
  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = p_group_id and user_id = any(p_assignee_ids);
  
  insert into activity_log(group_id, text, type)
    values (p_group_id, coalesce(v_name,'Someone') || ' started a timer for ' || p_name || ' (' || p_cycle_minutes || ' min) — ' ||
      coalesce(v_names, 'no one') || ' will be notified when it''s ready.', 'timer');

  return v_chore_type_id;
end;
$$;
