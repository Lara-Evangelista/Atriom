-- Migration 029: fix editing a scheduled chore not updating the calendar,
-- and add a column the client has been writing/reading that never existed.
--
-- 1. update_chore_schedule (as redefined in 021) updates chore_types and
--    swaps chore_type_rotation, but never touches existing chore_events.
--    The version in 001 used to delete future pending events and reset
--    last_rotation_index/last_event_date so ensure_chore_events() would
--    rebuild the calendar under the new interval/roster/advanced_schedule
--    -- that part was lost when 021 rewrote the function to add the new
--    params. Restoring it (interval change, roster change, weekly-days
--    change, is_rotational flip -- anything that affects future turns)
--    now regenerates the calendar immediately.
--
--    We also anchor the regeneration to current_date instead of the
--    chore's original start_date: if we only reset last_event_date to
--    null, ensure_chore_events's cold-start path falls back to
--    coalesce(start_date, current_date), and start_date is frequently a
--    date from whenever the chore was first created -- which could be
--    long in the past, causing regeneration to insert a stale back-dated
--    event instead of picking up from today.
--
-- 2. default_timer_minutes: CreateScreen.tsx has been writing this column
--    on chore_types (both insert and update, for has_timer chores), and
--    TodayScreen.tsx selects it on every load. The column was never
--    added to the schema, so every one of those calls has been failing
--    at the database level -- including the unconditional select in
--    TodayScreen's load(), which fails the whole `chore_types` fetch and
--    surfaces as "Could not load chores." every time. Adding the column
--    doesn't change any behavior beyond letting these already-shipped
--    reads/writes succeed.

alter table chore_types
  add column if not exists default_timer_minutes int;

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
  if v_person_count = 0 then
    raise exception 'Must provide at least one user id';
  end if;

  -- Clamp coin_reward to group max if provided
  if p_coin_reward is not null then
    select max_coin_reward into v_max_coins from groups where id = v_ct.group_id;
    if p_coin_reward > coalesce(v_max_coins, 10) then
      p_coin_reward := coalesce(v_max_coins, 10);
    end if;
  end if;

  -- Whatever the coin_reward will end up being (new value, or unchanged
  -- existing value) needs to pass the policy check against the new roster.
  v_effective_coin_reward := coalesce(p_coin_reward, v_ct.coin_reward);
  perform check_coin_assignment_allowed(v_ct.group_id, p_user_ids, v_effective_coin_reward);

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
    is_delayable           = coalesce(p_is_delayable, is_delayable),
    max_consecutive_delays = coalesce(p_max_consecutive_delays, max_consecutive_delays),
    coin_reward            = coalesce(p_coin_reward, coin_reward),
    requires_approval      = coalesce(p_requires_approval, requires_approval),
    due_time               = coalesce(p_due_time, due_time),
    overdue_nudge_interval_minutes = coalesce(p_overdue_nudge_interval_minutes, overdue_nudge_interval_minutes),
    counts_for_leaderboard = coalesce(p_counts_for_leaderboard, counts_for_leaderboard),
    -- Regenerate from today, not from whatever start_date was picked
    -- back when the chore was first created.
    start_date             = current_date,
    last_rotation_index    = null,
    last_event_date        = null
  where id = p_chore_type_id;

  perform ensure_chore_events(p_chore_type_id, current_date + 30);
end;
$$;
