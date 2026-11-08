-- Migration 028: mobile bug fixes
--
-- 1. is_onetime: chore_types has never distinguished "a reusable definition
--    that generates recurring events/runs" from "a single ad-hoc task that
--    happens to use has_timer/has_schedule plumbing". The mobile Manage
--    screen bucketed anything with has_schedule || has_counter || has_timer
--    into "recurring", so a one-off timer task (has_timer = true, created
--    via create_onetime_timer_task) never left that list, and a one-off
--    standard task could show up duplicated across both lists depending on
--    which query ran first. is_onetime is the single source of truth going
--    forward.
--
-- 2. complete_chore_run now archives a one-time timer chore_type once its
--    single run finishes, so it stops lingering in Active/Recurring forever.
--
-- 3. complete_chore_event / complete_onetime_task raised "This turn is
--    assigned to someone else" for ANY event with no matching assignee row
--    for the caller -- including events with NO assignees at all (genuinely
--    unassigned). Completing an unassigned event now claims it for the
--    caller instead of erroring.
--
-- 4. delay_chore_event cascaded every future pending event of a chore type
--    forward by the same p_days, including chores on a weekly
--    advanced_schedule (specific days of the week). That's wrong for a
--    weekly schedule: delaying one occurrence should move only that
--    occurrence to the next date that matches one of its scheduled
--    weekdays, and must not drag the other pinned days along with it.
--    Interval-based chores (no advanced_schedule) keep the old cascading
--    behavior, which is correct for them.

-- 1. is_onetime column + backfill
alter table chore_types add column if not exists is_onetime boolean;

update chore_types
   set is_onetime = not (coalesce(has_schedule, false) or coalesce(has_counter, false))
 where is_onetime is null;

alter table chore_types alter column is_onetime set default false;
alter table chore_types alter column is_onetime set not null;

-- 2. create_onetime_task: mark is_onetime = true
drop function if exists create_onetime_task(uuid, text, text, uuid[], date, boolean, int, boolean, time, int, boolean);

create or replace function create_onetime_task(
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
  p_counts_for_leaderboard boolean default true
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_event_id uuid;
  v_uid uuid;
  v_max_coins int;
  v_actual_approval boolean;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  perform check_coin_assignment_allowed(p_group_id, p_assignee_ids, p_coin_reward);

  v_actual_approval := coalesce(p_requires_approval, p_requires_photo);

  insert into chore_types(
    group_id, name, icon, has_schedule, requires_photo, created_by, coin_reward,
    requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard,
    is_onetime
  )
    values (
      p_group_id, p_name, p_icon, false, p_requires_photo, auth.uid(), p_coin_reward,
      v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
      coalesce(p_counts_for_leaderboard, true), true
    )
    returning id into v_chore_type_id;

  insert into chore_events(chore_type_id, group_id, date, status, created_by)
    values (v_chore_type_id, p_group_id, p_due_date, 'pending', auth.uid())
    returning id into v_event_id;

  foreach v_uid in array p_assignee_ids loop
    insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
  end loop;

  return v_chore_type_id;
end;
$$;

-- 3. create_onetime_timer_task: mark is_onetime = true
drop function if exists create_onetime_timer_task(uuid, text, text, uuid[], date, boolean, int, boolean, time, int, boolean, int);

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
    requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard,
    is_onetime
  )
    values (
      p_group_id, p_name, p_icon, false, true, p_requires_photo, auth.uid(), p_coin_reward,
      v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
      coalesce(p_counts_for_leaderboard, true), true
    )
    returning id into v_chore_type_id;

  insert into chore_runs(chore_type_id, group_id, trigger_reason, status, started_by, started_at, cycle_minutes, cycle_ends_at)
    values (v_chore_type_id, p_group_id, 'onetime_timer', 'running', auth.uid(), now(),
            p_cycle_minutes, now() + (p_cycle_minutes || ' minutes')::interval)
    returning id into v_run_id;

  foreach v_uid in array p_assignee_ids loop
    insert into chore_run_assignees(chore_run_id, user_id) values (v_run_id, v_uid);
  end loop;

  select display_name into v_name from memberships where group_id = p_group_id and user_id = auth.uid();
  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = p_group_id and user_id = any(p_assignee_ids);

  insert into activity_log(group_id, text, type)
    values (p_group_id, coalesce(v_name,'Someone') || ' started a timer for ' || p_name || ' (' || p_cycle_minutes || ' min).  ' ||
      coalesce(v_names, 'no one') || ' will be notified when it''s ready.', 'timer');

  return v_chore_type_id;
end;
$$;

-- 4. complete_chore_run: archive a one-time timer chore once its single
--    run finishes, so it doesn't linger in Active Chores forever.
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

  if v_ct.is_onetime and v_ct.has_timer then
    update chore_types set archived = true where id = v_ct.id;
  end if;

  select display_name into v_name from memberships where group_id = v_run.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_run.group_id, coalesce(v_name,'Someone') || ' finished ' || v_ct.name || '.', 'done');
end;
$$;

-- 5. complete_chore_event: claim a genuinely unassigned event instead of
--    raising a misleading "assigned to someone else" error.
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
  v_ct    chore_types%rowtype;
  v_uid   uuid;
  v_needs_approval boolean;
  v_person_name text;
  v_has_assignees boolean;
  r       record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select exists(select 1 from chore_event_assignees where chore_event_id = v_event.id) into v_has_assignees;

  if v_has_assignees then
    if not exists (
      select 1 from chore_event_assignees where chore_event_id = v_event.id and user_id = auth.uid()
    ) then
      raise exception 'This turn is assigned to someone else';
    end if;
  else
    -- Genuinely unassigned: completing it claims it for the caller.
    insert into chore_event_assignees(chore_event_id, user_id) values (v_event.id, auth.uid())
      on conflict do nothing;
  end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This chore requires a photo to mark it done';
  end if;

  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  v_needs_approval := coalesce(v_ct.requires_approval, false);

  update chore_events
     set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url,
         assigned_user_id = coalesce(assigned_user_id, auth.uid())
   where id = p_event_id;

  insert into chore_event_completions (event_id, user_id, approval_status)
  select p_event_id, unnest(p_credited_user_ids),
    case when v_needs_approval then 'pending' else 'approved' end
  on conflict do nothing;

  if not v_needs_approval then
    foreach v_uid in array p_credited_user_ids loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  end if;

  for r in
    select resource_id, qty_per_completion
      from chore_type_resources
     where chore_type_id = v_ct.id
  loop
    update resources
       set qty = greatest(0, qty - r.qty_per_completion)
     where id = r.resource_id;
    perform check_resource_alert(r.resource_id);
  end loop;

  update chore_types
     set has_resources = exists(select 1 from chore_type_resources where chore_type_id = v_ct.id)
   where id = v_ct.id;

  select display_name into v_person_name
    from memberships
   where group_id = v_event.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_event.group_id,
            coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".',
            'done');
end;
$$;

-- 6. complete_onetime_task: same unassigned-claim fix.
create or replace function complete_onetime_task(
  p_event_id uuid,
  p_photo_url text default null,
  p_credited_user_ids uuid[] default null
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct    chore_types%rowtype;
  v_uid   uuid;
  v_needs_approval boolean;
  v_person_name text;
  v_has_assignees boolean;
  r       record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select exists(select 1 from chore_event_assignees where chore_event_id = p_event_id) into v_has_assignees;

  if v_has_assignees then
    if not exists (select 1 from chore_event_assignees where chore_event_id = p_event_id and user_id = auth.uid()) then
      raise exception 'You are not one of the people this task was assigned to';
    end if;
  else
    insert into chore_event_assignees(chore_event_id, user_id) values (p_event_id, auth.uid())
      on conflict do nothing;
  end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.has_schedule then
    raise exception 'This is a recurring task -- use complete_chore_event instead';
  end if;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This task requires a photo to mark it done';
  end if;

  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  v_needs_approval := coalesce(v_ct.requires_approval, false);

  update chore_events set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
    where id = p_event_id;

  insert into chore_event_completions (event_id, user_id, approval_status)
  select p_event_id, unnest(p_credited_user_ids),
    case when v_needs_approval then 'pending' else 'approved' end
  on conflict do nothing;

  if not v_needs_approval then
    foreach v_uid in array p_credited_user_ids loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  end if;

  for r in
    select resource_id, qty_per_completion
      from chore_type_resources
     where chore_type_id = v_ct.id
  loop
    update resources
       set qty = greatest(0, qty - r.qty_per_completion)
     where id = r.resource_id;
    perform check_resource_alert(r.resource_id);
  end loop;

  update chore_types
     set has_resources = exists(select 1 from chore_type_resources where chore_type_id = v_ct.id)
   where id = v_ct.id;

  select display_name into v_person_name from memberships where group_id = v_event.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".', 'done');
end;
$$;

-- 7. delay_chore_event: a chore on a weekly advanced_schedule should only
--    move the delayed occurrence -- to the next date that matches one of
--    its own scheduled weekdays -- and must not drag other pending,
--    already-pinned occurrences along with it. Interval-based chores (no
--    advanced_schedule) keep the old "push everything forward" behavior.
create or replace function delay_chore_event(p_event_id uuid, p_days int)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_new_date date;
  v_attempts int;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then raise exception 'Event not found or already done'; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;

  if not coalesce(v_ct.is_delayable, true) then raise exception 'This chore cannot be delayed'; end if;
  if v_ct.max_consecutive_delays is not null and coalesce(v_event.consecutive_delays_count, 0) >= v_ct.max_consecutive_delays then
    raise exception 'Maximum delays reached';
  end if;

  if v_ct.advanced_schedule is not null then
    -- Weekly schedule: only this occurrence moves, to the next date that
    -- is itself one of the chore's scheduled weekdays. Other pending
    -- occurrences (their own pinned days) are left exactly where they are.
    v_new_date := v_event.date;
    v_attempts := 0;
    loop
      v_new_date := v_new_date + 1;
      v_attempts := v_attempts + 1;
      if v_ct.advanced_schedule ? extract(isodow from v_new_date)::text or v_attempts > 14 then
        exit;
      end if;
    end loop;

    update chore_events
       set date = v_new_date,
           consecutive_delays_count = coalesce(consecutive_delays_count, 0) + 1
     where id = p_event_id;
  else
    -- Interval-based chore: keep prior cascading behavior.
    update chore_events
    set date = date + (p_days || ' days')::interval,
        consecutive_delays_count = coalesce(consecutive_delays_count, 0) + 1
    where id = p_event_id;

    update chore_events
    set date = date + (p_days || ' days')::interval
    where chore_type_id = v_event.chore_type_id
      and status = 'pending'
      and id != p_event_id
      and date >= v_event.date;

    update chore_types
    set last_event_date = last_event_date + (p_days || ' days')::interval
    where id = v_event.chore_type_id;
  end if;
end;
$$;
