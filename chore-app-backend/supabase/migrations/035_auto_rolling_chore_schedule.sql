-- Migration 035: Auto-rolling chore schedule + continuous 30-day forward window
--
-- Problem: Scheduled/rotational chores (e.g. cleaning the guinea pigs every 3 days)
-- were only pre-populated 30 days out at creation time. Once those 30 days passed,
-- if pg_cron wasn't running (common on free-tier Supabase), the chore stopped completely.
--
-- Fix:
-- 1. In complete_chore_event and skip_chore_event, automatically call ensure_chore_events
--    to roll the schedule forward 30 days ahead whenever a turn is completed or skipped.
--    Completing one occurrence automatically spawns the next turn at the end of the window.
-- 2. In ensure_chore_events, handle lapsed/expired chores gracefully: if a chore has
--    no pending events remaining and last_event_date is in the past, align to resume
--    from today rather than creating stale overdue events or stalling.
-- 3. In ensure_all_events, default p_through_date to (current_date + 30).

drop function if exists ensure_chore_events(uuid, date);

create or replace function ensure_chore_events(
  p_chore_type_id uuid,
  p_through_date date default (current_date + 30)
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
  v_latest_pending date;
  i int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id;
  if not v_ct.has_schedule or v_ct.archived then return; end if;

  select array_agg(user_id order by sort_order) into v_people
    from chore_type_rotation where chore_type_id = p_chore_type_id;
  v_count := coalesce(array_length(v_people, 1), 0);

  v_idx := coalesce(v_ct.last_rotation_index, 0);
  v_date := v_ct.last_event_date;

  -- Check if there are any existing pending events in the future
  select max(date) into v_latest_pending
    from chore_events
   where chore_type_id = p_chore_type_id and status = 'pending';

  if v_latest_pending is not null and v_latest_pending > coalesce(v_date, current_date - 1) then
    v_date := v_latest_pending;
  end if;

  -- Cold start: generate first event
  if v_date is null then
    v_date := coalesce(v_ct.start_date, current_date);

    if v_count = 0 then
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
  elsif v_date < current_date and v_latest_pending is null then
    -- Chore has lapsed and all past events are completed/gone; anchor so the next occurrence resumes from today
    if v_ct.advanced_schedule is not null then
      v_date := current_date - 1;
    else
      v_date := current_date - coalesce(v_ct.schedule_interval_days, 1);
    end if;
  end if;

  -- Generate future events up to p_through_date
  while v_date < coalesce(p_through_date, current_date + 30) loop
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


-- Update ensure_all_events to support default p_through_date
create or replace function ensure_all_events(
  p_group_id uuid,
  p_through_date date default (current_date + 30)
)
returns void
language plpgsql security definer
as $$
declare
  r record;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  for r in select id from chore_types where group_id = p_group_id and has_schedule = true and archived = false loop
    perform ensure_chore_events(r.id, coalesce(p_through_date, current_date + 30));
  end loop;
end;
$$;


-- Update complete_chore_event to roll the schedule forward on completion
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

  -- Ensure upcoming schedule rolls forward 30 days automatically
  if v_ct.has_schedule then
    perform ensure_chore_events(v_ct.id, greatest(current_date, v_event.date) + 30);
  end if;

  select display_name into v_person_name
    from memberships
   where group_id = v_event.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_event.group_id,
            coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".',
            'done');
end;
$$;


-- Update skip_chore_event to also roll schedule forward
create or replace function skip_chore_event(p_event_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_is_assignee boolean;
  v_person_name text;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then raise exception 'Event not found or already done'; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select exists(
    select 1 from chore_event_assignees where chore_event_id = p_event_id and user_id = auth.uid()
  ) into v_is_assignee;
  if not v_is_assignee then
    raise exception 'Only someone this turn is assigned to can mark it as not done';
  end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;

  update chore_events
     set status = 'skipped', done_at = now(), done_by = auth.uid()
   where id = p_event_id;

  -- Ensure schedule rolls forward 30 days
  if v_ct.has_schedule then
    perform ensure_chore_events(v_ct.id, greatest(current_date, v_event.date) + 30);
  end if;

  select display_name into v_person_name
    from memberships where group_id = v_event.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_person_name, 'Someone') || ' skipped "' || v_ct.name || '".', 'skip');
end;
$$;
