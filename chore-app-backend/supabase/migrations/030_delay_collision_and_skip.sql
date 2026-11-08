-- Migration 030: delay collisions on weekly schedules, and a "didn't do
-- it" action.
--
-- 1. delay_chore_event (weekly/advanced_schedule branch, from 028) moves
--    only the delayed occurrence to the next date matching one of the
--    chore's scheduled weekdays -- correct on its own, but it never
--    checked whether another pending occurrence of the same chore_type
--    was already sitting on that date. When it was, you'd end up with
--    two pending occurrences on the same day (the "028 bug" symptom you
--    were seeing again, just from a different code path than the actual
--    028 fix touched).
--
--    Now, when the delayed occurrence's new date collides with another
--    pending occurrence: the delayed turn takes over that date, and every
--    pending occurrence from that date onward shifts to take the date of
--    the *next* one in line -- the last one in the chain gets a freshly
--    computed date, continuing the weekday pattern past wherever the
--    chain used to end. Nobody's assignment changes, only which date
--    their turn falls on. Example from your A/B/C walkthrough: A delays
--    all the way onto B's Thursday -> A now owns Thursday, B moves to
--    what was C's Friday, C moves to the next scheduled weekday after
--    Friday (e.g. the following Monday).
--
--    Interval-based chores (no advanced_schedule) are unchanged -- they
--    already cascade every future occurrence forward, so this collision
--    can't happen for them.
--
-- 2. skip_chore_event: lets someone say "I didn't do this" instead of
--    completing it. The turn disappears from the pending list (status =
--    'skipped'), nobody gets coins or a leaderboard point for it, and --
--    because chore_events are pre-generated ~30 days out -- the next
--    scheduled turn is already sitting there waiting, so nothing else
--    needs to shift.

create or replace function delay_chore_event(p_event_id uuid, p_days int)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_new_date date;
  v_attempts int;
  v_collision boolean;
  v_chain_ids uuid[];
  v_chain_dates date[];
  v_extend_date date;
  v_extend_attempts int;
  v_chain_len int;
  i int;
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
    -- is itself one of the chore's scheduled weekdays.
    v_new_date := v_event.date;
    v_attempts := 0;
    loop
      v_new_date := v_new_date + 1;
      v_attempts := v_attempts + 1;
      if v_ct.advanced_schedule ? extract(isodow from v_new_date)::text or v_attempts > 14 then
        exit;
      end if;
    end loop;

    select exists(
      select 1 from chore_events
       where chore_type_id = v_ct.id and status = 'pending' and id <> p_event_id and date = v_new_date
    ) into v_collision;

    if not v_collision then
      update chore_events
         set date = v_new_date,
             consecutive_delays_count = coalesce(consecutive_delays_count, 0) + 1
       where id = p_event_id;
    else
      -- The delayed turn's new date is already taken by another pending
      -- occurrence. Rather than show two of the same chore on that day,
      -- shift that whole chain (everything pending from v_new_date
      -- onward) one slot later, and extend the schedule by one more
      -- occurrence to cover whoever falls off the end.
      select array_agg(id order by date), array_agg(date order by date)
        into v_chain_ids, v_chain_dates
        from chore_events
       where chore_type_id = v_ct.id and status = 'pending' and id <> p_event_id and date >= v_new_date;

      v_chain_len := array_length(v_chain_ids, 1);

      v_extend_date := v_chain_dates[v_chain_len];
      v_extend_attempts := 0;
      loop
        v_extend_date := v_extend_date + 1;
        v_extend_attempts := v_extend_attempts + 1;
        if v_ct.advanced_schedule ? extract(isodow from v_extend_date)::text or v_extend_attempts > 14 then
          exit;
        end if;
      end loop;

      for i in 1..v_chain_len loop
        update chore_events
           set date = case when i = v_chain_len then v_extend_date else v_chain_dates[i + 1] end
         where id = v_chain_ids[i];
      end loop;

      update chore_events
         set date = v_new_date,
             consecutive_delays_count = coalesce(consecutive_delays_count, 0) + 1
       where id = p_event_id;
    end if;
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

  select display_name into v_person_name
    from memberships where group_id = v_event.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_event.group_id,
            coalesce(v_person_name, 'Someone') || ' didn''t get to "' || coalesce(v_ct.name, 'a chore') || '" -- skipped, no reward.',
            'skipped');
end;
$$;
