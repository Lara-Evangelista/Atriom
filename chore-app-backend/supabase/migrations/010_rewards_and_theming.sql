-- Migration 010: Rewards, Coins, Approvals, and Advanced Theming

-- ============================================================
-- 1. Schema Changes: Coins & Cosmetics on memberships
-- ============================================================
alter table memberships add column if not exists coin_balance int default 0;
alter table memberships add column if not exists unlocked_cosmetics jsonb default '[]'::jsonb;
alter table memberships add column if not exists active_cosmetics jsonb default '{}'::jsonb;

-- ============================================================
-- 2. Schema Changes: Chore Types (coin rewards, approvals, overdue)
-- ============================================================
alter table chore_types add column if not exists coin_reward int default 1;
alter table chore_types add column if not exists requires_approval boolean default false;
alter table chore_types add column if not exists due_time time default null;
alter table chore_types add column if not exists overdue_nudge_interval_minutes int default null;

-- ============================================================
-- 3. Schema Changes: Groups (max coin reward, rewards toggle)
-- ============================================================
alter table groups add column if not exists max_coin_reward int default 10;
alter table groups add column if not exists rewards_enabled boolean default false;

-- ============================================================
-- 4. Approval tracking on completions
-- ============================================================
alter table chore_event_completions add column if not exists approval_status text default 'approved';
-- Values: 'pending', 'approved', 'rejected'
-- Default is 'approved' for backward compat (existing chores don't need approval)

-- ============================================================
-- 5. New Table: rewards (the store items)
-- ============================================================
create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  name text not null,
  description text default '',
  cost int not null default 10,
  icon text default '🎁',
  color_theme text default 'teal',
  perk_type text default 'custom',
  -- perk_type values: custom, skip_turn, force_trade,
  --   unlock_theme, unlock_palette, unlock_font, unlock_effect,
  --   unlock_color_picker, unlock_palette_slot
  perk_data jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  archived boolean default false
);

alter table rewards enable row level security;

create policy "Members can view rewards in their groups"
  on rewards for select using (
    exists (select 1 from memberships where group_id = rewards.group_id and user_id = auth.uid())
  );

create policy "Admins can manage rewards"
  on rewards for all using (
    exists (select 1 from memberships where group_id = rewards.group_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- ============================================================
-- 6. New Table: reward_redemptions (purchase log)
-- ============================================================
create table if not exists reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid references rewards(id) on delete set null,
  group_id uuid references groups(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  cost int not null,
  perk_type text not null default 'custom',
  perk_data jsonb default '{}'::jsonb,
  redeemed_at timestamptz default now()
);

alter table reward_redemptions enable row level security;

create policy "Users can view their own redemptions"
  on reward_redemptions for select using (user_id = auth.uid());

create policy "Users can insert their own redemptions"
  on reward_redemptions for insert with check (user_id = auth.uid());

-- ============================================================
-- 7. New Table: chore_skips (skip tokens from rewards)
-- ============================================================
create table if not exists chore_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  chore_type_id uuid references chore_types(id) on delete cascade not null,
  group_id uuid references groups(id) on delete cascade not null,
  used boolean default false,
  created_at timestamptz default now()
);

alter table chore_skips enable row level security;

create policy "Users can view their own skips"
  on chore_skips for select using (user_id = auth.uid());

-- ============================================================
-- 8. RPC: Purchase a reward
-- ============================================================
create or replace function purchase_reward(
  p_reward_id uuid
)
returns void
language plpgsql security definer
as $$
declare
  v_reward rewards%rowtype;
  v_balance int;
  v_membership_id uuid;
begin
  select * into v_reward from rewards where id = p_reward_id and not archived;
  if not found then raise exception 'Reward not found'; end if;
  if not is_group_member(v_reward.group_id) then raise exception 'Not authorized'; end if;

  select coin_balance into v_balance from memberships
    where group_id = v_reward.group_id and user_id = auth.uid();
  if v_balance < v_reward.cost then raise exception 'Not enough coins'; end if;

  -- Deduct coins
  update memberships set coin_balance = coin_balance - v_reward.cost
    where group_id = v_reward.group_id and user_id = auth.uid();

  -- Record redemption
  insert into reward_redemptions(reward_id, group_id, user_id, cost, perk_type, perk_data)
    values (p_reward_id, v_reward.group_id, auth.uid(), v_reward.cost, v_reward.perk_type, v_reward.perk_data);

  -- Handle digital unlocks
  if v_reward.perk_type like 'unlock_%' then
    update memberships
    set unlocked_cosmetics = unlocked_cosmetics || jsonb_build_object(
      'type', v_reward.perk_type,
      'data', v_reward.perk_data,
      'name', v_reward.name
    )
    where group_id = v_reward.group_id and user_id = auth.uid();
  end if;

  -- Handle skip_turn
  if v_reward.perk_type = 'skip_turn' then
    insert into chore_skips(user_id, chore_type_id, group_id)
      values (auth.uid(), (v_reward.perk_data->>'chore_type_id')::uuid, v_reward.group_id);
  end if;
end;
$$;

-- ============================================================
-- 9. RPC: Admin create/update reward
-- ============================================================
create or replace function create_reward(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_cost int,
  p_icon text default '🎁',
  p_color_theme text default 'teal',
  p_perk_type text default 'custom',
  p_perk_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer
as $$
declare
  v_id uuid;
begin
  if not is_group_admin(p_group_id) then raise exception 'Only admins can create rewards'; end if;
  insert into rewards(group_id, name, description, cost, icon, color_theme, perk_type, perk_data, created_by)
    values (p_group_id, p_name, p_description, p_cost, p_icon, p_color_theme, p_perk_type, p_perk_data, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function delete_reward(p_reward_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from rewards where id = p_reward_id;
  if not is_group_admin(v_group_id) then raise exception 'Only admins can delete rewards'; end if;
  update rewards set archived = true where id = p_reward_id;
end;
$$;

-- ============================================================
-- 10. RPC: Approve / Reject a completed chore
-- ============================================================
create or replace function approve_chore_completion(
  p_event_id uuid,
  p_approved boolean default true
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_uid uuid;
begin
  select * into v_event from chore_events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not is_group_admin(v_event.group_id) then raise exception 'Only admins can approve chores'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;

  if p_approved then
    update chore_event_completions set approval_status = 'approved' where event_id = p_event_id;
    -- Award coins to all credited users
    for v_uid in select user_id from chore_event_completions where event_id = p_event_id loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  else
    update chore_event_completions set approval_status = 'rejected' where event_id = p_event_id;
    -- Revert the event back to pending so it can be redone
    update chore_events set status = 'pending', done_at = null, done_by = null, photo_url = null
      where id = p_event_id;
    delete from chore_event_completions where event_id = p_event_id;
  end if;
end;
$$;

-- ============================================================
-- 11. Update complete_chore_event to handle approvals and coins
-- ============================================================
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
  v_uid uuid;
  v_needs_approval boolean;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This chore requires a photo to mark it done';
  end if;

  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  -- Determine if approval is needed
  v_needs_approval := coalesce(v_ct.requires_approval, false);

  update chore_events
  set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
  where id = p_event_id;

  -- Credit all selected users with appropriate approval status
  insert into chore_event_completions (event_id, user_id, approval_status)
  select p_event_id, unnest(p_credited_user_ids),
    case when v_needs_approval then 'pending' else 'approved' end
  on conflict do nothing;

  -- If no approval needed, award coins immediately
  if not v_needs_approval then
    foreach v_uid in array p_credited_user_ids loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  end if;
end;
$$;

-- ============================================================
-- 12. Update update_household_settings to support rewards + max_coin_reward
-- ============================================================
create or replace function update_household_settings(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_allow_anyone_to_edit_chores boolean,
  p_nudge_policy text default 'restricted',
  p_notification_language text default 'en',
  p_rewards_enabled boolean default false,
  p_max_coin_reward int default 10
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
      max_coin_reward = p_max_coin_reward
  where id = p_group_id;
end;
$$;

-- ============================================================
-- 13. Update create_chore_type_scheduled to accept coin_reward + approval + overdue
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
-- 14. Update create_onetime_task to accept coin_reward + approval
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

-- ============================================================
-- 15. RPC: Update active cosmetics (equip theme/effect/colors)
-- ============================================================
create or replace function update_active_cosmetics(
  p_group_id uuid,
  p_active_cosmetics jsonb
)
returns void
language plpgsql security definer
as $$
begin
  update memberships
  set active_cosmetics = p_active_cosmetics
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- ============================================================
-- 16. RPC: Get user coin balance and cosmetics
-- ============================================================
create or replace function get_user_wallet(p_group_id uuid)
returns table (
  coin_balance int,
  unlocked_cosmetics jsonb,
  active_cosmetics jsonb
)
language plpgsql security definer stable
as $$
begin
  return query
    select m.coin_balance, m.unlocked_cosmetics, m.active_cosmetics
    from memberships m
    where m.group_id = p_group_id and m.user_id = auth.uid();
end;
$$;
