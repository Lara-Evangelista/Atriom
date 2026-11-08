-- Migration 020: Coin permission controls
--
-- Two new admin-controlled household settings:
--   1. restrict_coins_to_admins  (default true)  — when on, only owners/admins
--      may set a coin_reward > 0 on a chore (creation or edit). Non-admins can
--      still create chores, just without coins.
--   2. allow_self_assigned_coins (default false) — when off, a person cannot
--      put a coin reward on a chore that is assigned only to themselves.
--      For a rotational chore this means the rotation must include at least
--      one other person besides the creator to carry a coin reward. This
--      does not block others from putting you in a rotation/assignee list
--      with coins — it only blocks *self*-assignment with coins attached.
--
-- Both are enforced server-side (source of truth) in the functions that set
-- coin_reward: create_chore_type_scheduled, update_chore_schedule, and
-- create_onetime_task.

-- ============================================================
-- 1. Schema: new group settings
-- ============================================================
alter table groups add column if not exists restrict_coins_to_admins boolean default true;
alter table groups add column if not exists allow_self_assigned_coins boolean default false;

-- ============================================================
-- 2. Helper: validate a proposed coin_reward against group policy
-- ============================================================
-- p_user_ids: the full set of people this chore/rotation is (or would be)
-- assigned to. Raises an exception if the assignment is not allowed.
create or replace function check_coin_assignment_allowed(
  p_group_id uuid,
  p_user_ids uuid[],
  p_coin_reward int
)
returns void
language plpgsql security definer
as $$
declare
  v_restrict_admins boolean;
  v_allow_self boolean;
  v_person_count int;
begin
  if p_coin_reward is null or p_coin_reward <= 0 then
    return;
  end if;

  select restrict_coins_to_admins, allow_self_assigned_coins
    into v_restrict_admins, v_allow_self
    from groups where id = p_group_id;

  if coalesce(v_restrict_admins, true) and not is_group_admin(p_group_id) then
    raise exception 'Only admins can set coin rewards on chores';
  end if;

  if not coalesce(v_allow_self, false) then
    v_person_count := coalesce(array_length(p_user_ids, 1), 0);
    if auth.uid() = any(p_user_ids) and v_person_count < 2 then
      raise exception 'You can''t put a coin reward on a chore assigned only to yourself. Add at least one other person to the rotation/assignment to set a coin amount.';
    end if;
  end if;
end;
$$;

-- ============================================================
-- 3. Update update_household_settings to accept the two new toggles
-- ============================================================
create or replace function update_household_settings(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_allow_anyone_to_edit_chores boolean,
  p_nudge_policy text default 'restricted',
  p_notification_language text default 'en',
  p_rewards_enabled boolean default false,
  p_max_coin_reward int default 10,
  p_restrict_coins_to_admins boolean default true,
  p_allow_self_assigned_coins boolean default false
)
returns void
language plpgsql security definer
as $$
begin
  if not is_group_admin(p_group_id) then
    raise exception 'Only admins and the owner can change household settings';
  end if;

  if p_nudge_policy not in ('off', 'everyone', 'restricted') then
    raise exception 'Invalid nudge_policy. Must be off, everyone, or restricted.';
  end if;

  update groups
  set name = p_name,
      icon = p_icon,
      allow_anyone_to_edit_chores = p_allow_anyone_to_edit_chores,
      nudge_policy = p_nudge_policy,
      notification_language = p_notification_language,
      rewards_enabled = p_rewards_enabled,
      max_coin_reward = p_max_coin_reward,
      restrict_coins_to_admins = p_restrict_coins_to_admins,
      allow_self_assigned_coins = p_allow_self_assigned_coins
  where id = p_group_id;
end;
$$;

-- ============================================================
-- 4. Update create_chore_type_scheduled to enforce coin policy
-- ============================================================
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
  p_overdue_nudge_interval_minutes int default null
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

  -- Clamp coin_reward to group max
  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  perform check_coin_assignment_allowed(p_group_id, p_user_ids, p_coin_reward);

  -- Default approval logic: if requires_photo, default approval to true
  v_actual_approval := coalesce(p_requires_approval, p_requires_photo);

  insert into chore_types (
    group_id, name, icon, has_schedule, schedule_interval_days, requires_photo, created_by,
    advanced_schedule, is_rotational, is_delayable, max_consecutive_delays,
    coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes
  ) values (
    p_group_id, p_name, p_icon, true, p_interval_days, p_requires_photo, auth.uid(),
    p_advanced_schedule, p_is_rotational, p_is_delayable, p_max_consecutive_delays,
    p_coin_reward, v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes
  ) returning id into v_chore_type_id;

  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (v_chore_type_id, p_user_ids[i], i);
  end loop;

  perform ensure_chore_events(v_chore_type_id, current_date + 30);
  return v_chore_type_id;
end;
$$;

-- ============================================================
-- 5. Update update_chore_schedule to enforce coin policy
-- ============================================================
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
  p_overdue_nudge_interval_minutes int default null
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
    overdue_nudge_interval_minutes = coalesce(p_overdue_nudge_interval_minutes, overdue_nudge_interval_minutes)
  where id = p_chore_type_id;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (p_chore_type_id, p_user_ids[i], i);
  end loop;
end;
$$;

-- ============================================================
-- 6. Update create_onetime_task to enforce coin policy
-- ============================================================
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
  p_overdue_nudge_interval_minutes int default null
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

  insert into chore_types(group_id, name, icon, has_schedule, requires_photo, created_by, coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes)
    values (p_group_id, p_name, p_icon, false, p_requires_photo, auth.uid(), p_coin_reward, v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes)
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
