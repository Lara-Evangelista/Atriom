-- Migration 021: Per-chore leaderboard opt-out + group-wide cosmetics unlock
--
-- Builds on top of 020_coin_permission_controls.sql. Two independent,
-- unrelated features bundled in one migration:
--
-- 1. Some chores/tasks (e.g. "Read", a personal habit someone tracks with
--    this app but doesn't want inflating the household leaderboard) should
--    be completable without handing out a leaderboard point. This adds a
--    per-chore-type toggle, `counts_for_leaderboard`, defaulting to true so
--    every existing chore keeps behaving exactly as it does today. Coins
--    are untouched — a chore can still pay coin_reward on completion even
--    if it's excluded from the leaderboard count; the two are separate
--    currencies (leaderboard points are a computed "how much did you do"
--    count, coins are a spendable balance governed by 020's policy rules).
--
-- 2. Admins can now flip `cosmetics_unlocked_for_all` on a group so every
--    member has every built-in theme/effect available for free, without
--    touching their coin balance. This is for households that want the
--    coin economy to be purely about real-world rewards (or don't want a
--    coin economy at all), while still letting everyone reskin the app.
--    Households that *do* want themes to be a coin-gated incentive just
--    leave this off — nothing changes for them.
--
-- This migration also closes a gap left by 020: its new
-- update_household_settings(10 args) was created with `create or replace`
-- but without first dropping the old update_household_settings(8 args)
-- from 010_rewards_and_theming.sql. Postgres treats a different arg count
-- as a distinct overload rather than a replacement, so both were left
-- live side by side — the same ambiguous-overload trap that
-- 011_fix_ambiguous_overloads.sql had to clean up once already. We drop
-- both old signatures below before establishing the single canonical one.

-- ============================================================
-- 1. Schema: per-chore leaderboard toggle
-- ============================================================
alter table chore_types add column if not exists counts_for_leaderboard boolean not null default true;

-- ============================================================
-- 2. Schema: group-wide "unlock all cosmetics" toggle
-- ============================================================
alter table groups add column if not exists cosmetics_unlocked_for_all boolean not null default false;

-- ============================================================
-- 3. get_leaderboard: exclude completions of opted-out chores
-- ============================================================
drop function if exists get_leaderboard(uuid, date, date);

create or replace function get_leaderboard(
  p_group_id uuid,
  p_since date default (current_date - 6),
  p_until date default current_date
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  points bigint
)
language plpgsql stable security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  return query
    select m.user_id, m.display_name, m.avatar_url, coalesce(c.points, 0)::bigint as points
    from memberships m
    left join (
      select cec.user_id, count(*) as points
      from chore_event_completions cec
      join chore_events ce on ce.id = cec.event_id
      join chore_types ct on ct.id = ce.chore_type_id
      where ce.group_id = p_group_id
        and ce.status = 'done'
        and coalesce(ct.counts_for_leaderboard, true)
        and date(ce.done_at) >= p_since
        and date(ce.done_at) <= p_until
      group by cec.user_id
    ) c on c.user_id = m.user_id
    where m.group_id = p_group_id
    order by points desc, display_name asc;
end;
$$;

-- ============================================================
-- 4. create_chore_type_scheduled: accept the toggle at creation time
--    (coin-policy enforcement from 020 preserved unchanged)
-- ============================================================
drop function if exists create_chore_type_scheduled(uuid, text, text, int, uuid[], boolean, jsonb, boolean, boolean, int, int, boolean, time, int);

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
  p_counts_for_leaderboard boolean default true
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
    coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes,
    counts_for_leaderboard
  ) values (
    p_group_id, p_name, p_icon, true, p_interval_days, p_requires_photo, auth.uid(),
    p_advanced_schedule, p_is_rotational, p_is_delayable, p_max_consecutive_delays,
    p_coin_reward, v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
    coalesce(p_counts_for_leaderboard, true)
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
-- 5. update_chore_schedule: accept the toggle when editing
--    (coin-policy enforcement from 020 preserved unchanged)
-- ============================================================
drop function if exists update_chore_schedule(uuid, int, uuid[], boolean, jsonb, boolean, boolean, int, int, boolean, time, int);

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
    counts_for_leaderboard = coalesce(p_counts_for_leaderboard, counts_for_leaderboard)
  where id = p_chore_type_id;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (p_chore_type_id, p_user_ids[i], i);
  end loop;
end;
$$;

-- ============================================================
-- 6. create_onetime_task: accept the toggle at creation time
--    (coin-policy enforcement from 020 preserved unchanged)
-- ============================================================
drop function if exists create_onetime_task(uuid, text, text, uuid[], date, boolean, int, boolean, time, int);

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
    requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard
  )
    values (
      p_group_id, p_name, p_icon, false, p_requires_photo, auth.uid(), p_coin_reward,
      v_actual_approval, p_due_time, p_overdue_nudge_interval_minutes,
      coalesce(p_counts_for_leaderboard, true)
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

-- ============================================================
-- 7. update_onetime_task: accept the toggle when editing
--    (no coin policy involved here — coin_reward isn't editable via
--    this function today, so nothing to enforce)
-- ============================================================
drop function if exists update_onetime_task(uuid, uuid[], date);

create or replace function update_onetime_task(
  p_event_id uuid,
  p_assignee_ids uuid[],
  p_due_date date default null, -- null = leave as-is
  p_counts_for_leaderboard boolean default null -- null = leave as-is
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
    select p_event_id, unnest(p_assignee_ids);

  update chore_types
    set counts_for_leaderboard = coalesce(p_counts_for_leaderboard, counts_for_leaderboard)
    where id = v_event.chore_type_id;
end;
$$;

-- ============================================================
-- 8. update_household_settings: admins can unlock cosmetics for everyone
--
--    Also fixes the overload left behind by 020_coin_permission_controls.sql:
--    that migration's create-or-replace introduced a *second*,
--    10-argument version of this function without dropping the original
--    8-argument one from 010_rewards_and_theming.sql, leaving both live.
--    We drop both below so there is exactly one, canonical signature.
-- ============================================================
drop function if exists update_household_settings(uuid, text, text, boolean, text, text, boolean, int);
drop function if exists update_household_settings(uuid, text, text, boolean, text, text, boolean, int, boolean, boolean);

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
  p_allow_self_assigned_coins boolean default false,
  p_cosmetics_unlocked_for_all boolean default false
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
      allow_self_assigned_coins = p_allow_self_assigned_coins,
      cosmetics_unlocked_for_all = p_cosmetics_unlocked_for_all
  where id = p_group_id;
end;
$$;
