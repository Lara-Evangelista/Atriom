-- Migration 008: Nudges, Vacations, and Admin Roles

-- ============================================================
-- 1. Memberships: Vacation Mode
-- ============================================================
alter table memberships add column if not exists is_paused boolean default false;

-- ============================================================
-- 2. Admin Role
--    roles are now: 'owner', 'admin', 'member'
--    owner  = full control (created the group)
--    admin  = can change household settings, manage members
--    member = regular user
-- ============================================================
-- No schema change needed — 'role' is already text.
-- We just treat 'admin' as a valid value alongside 'owner' and 'member'.

-- ============================================================
-- 3. Groups: Nudge Policy
--    'off'        = no one can nudge
--    'everyone'   = any group member can nudge any assignee
--    'restricted' = only creator of task / co-rotation members can nudge
-- ============================================================
alter table groups add column if not exists nudge_policy text default 'restricted';

-- ============================================================
-- 4. Chore Tracking: Creator (for permission checks)
-- ============================================================
-- created_by already exists on chore_types from migration 007.
-- Add it to chore_events for one-time tasks.
alter table chore_events add column if not exists created_by uuid references auth.users(id);

-- ============================================================
-- 5. Assignees: Nudge cooldown tracking
-- ============================================================
alter table chore_event_assignees add column if not exists last_nudged_at timestamptz;

-- ============================================================
-- 6. Helper: Check if user is admin or owner
-- ============================================================
create or replace function is_group_admin(p_group_id uuid)
returns boolean
language plpgsql security definer stable
as $$
begin
  return exists (
    select 1 from memberships
    where group_id = p_group_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
end;
$$;

-- ============================================================
-- 7. RPC: Set member role (only owner/admin can call)
-- ============================================================
create or replace function set_member_role(
  p_group_id uuid,
  p_target_user_id uuid,
  p_new_role text
)
returns void
language plpgsql security definer
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  select role into v_caller_role from memberships
    where group_id = p_group_id and user_id = auth.uid();
  select role into v_target_role from memberships
    where group_id = p_group_id and user_id = p_target_user_id;

  if v_caller_role is null then raise exception 'Not a member'; end if;
  if v_target_role is null then raise exception 'Target not found'; end if;

  -- Only owner can promote to admin or demote admins
  if v_caller_role != 'owner' then
    raise exception 'Only the owner can change roles';
  end if;

  -- Cannot change the owner's own role
  if p_target_user_id = auth.uid() then
    raise exception 'Cannot change your own role';
  end if;

  -- Can only set to 'admin' or 'member' (not 'owner')
  if p_new_role not in ('admin', 'member') then
    raise exception 'Invalid role. Must be admin or member.';
  end if;

  update memberships set role = p_new_role
    where group_id = p_group_id and user_id = p_target_user_id;
end;
$$;

-- ============================================================
-- 8. Update household settings to support nudge_policy + admin check
-- ============================================================
create or replace function update_household_settings(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_allow_anyone_to_edit_chores boolean,
  p_nudge_policy text default 'restricted'
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
      nudge_policy = p_nudge_policy
  where id = p_group_id;
end;
$$;

-- ============================================================
-- 9. Update personal settings to include vacation mode
-- ============================================================
create or replace function update_personal_settings(
  p_group_id uuid,
  p_display_name text,
  p_avatar_url text,
  p_notification_hour int,
  p_notification_preferences jsonb,
  p_pronouns text,
  p_is_paused boolean default false
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
      pronouns = p_pronouns,
      is_paused = p_is_paused
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- ============================================================
-- 10. Nudge RPC
--     Validates permissions based on group nudge_policy, then
--     enforces the 5-minute cooldown.
-- ============================================================
create or replace function nudge_assignee(
  p_event_id uuid,
  p_nudgee_id uuid
)
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_chore_type_id uuid;
  v_created_by uuid;
  v_nudge_policy text;
  v_am_co_rotation boolean;
  v_last_nudged_at timestamptz;
begin
  -- Get event info
  select group_id, chore_type_id, created_by into v_group_id, v_chore_type_id, v_created_by
  from chore_events where id = p_event_id;

  if not is_group_member(v_group_id) then
    raise exception 'Not authorized';
  end if;

  -- Cannot nudge yourself
  if p_nudgee_id = auth.uid() then
    raise exception 'You cannot nudge yourself';
  end if;

  -- Check group nudge policy
  select nudge_policy into v_nudge_policy from groups where id = v_group_id;
  v_nudge_policy := coalesce(v_nudge_policy, 'restricted');

  if v_nudge_policy = 'off' then
    raise exception 'Nudges are disabled for this household';
  end if;

  if v_nudge_policy = 'restricted' then
    -- Check if caller created the task
    if v_created_by is not null and v_created_by = auth.uid() then
      -- OK: creator can always nudge
      null;
    else
      -- Check if caller is a co-rotation member on this chore type
      select exists(
        select 1 from chore_type_rotation
        where chore_type_id = v_chore_type_id and user_id = auth.uid()
      ) into v_am_co_rotation;

      if not v_am_co_rotation then
        raise exception 'Only the creator or people in the rotation can nudge for this task';
      end if;
    end if;
  end if;
  -- If 'everyone', skip permission checks

  -- Check 5-minute cooldown
  select last_nudged_at into v_last_nudged_at
  from chore_event_assignees
  where chore_event_id = p_event_id and user_id = p_nudgee_id;

  if v_last_nudged_at is not null and v_last_nudged_at > now() - interval '5 minutes' then
    raise exception 'You can only nudge once every 5 minutes. Try again shortly.';
  end if;

  -- Update cooldown timestamp
  update chore_event_assignees
  set last_nudged_at = now()
  where chore_event_id = p_event_id and user_id = p_nudgee_id;
end;
$$;

-- ============================================================
-- 11. Update create_onetime_task to track created_by
-- ============================================================
create or replace function create_onetime_task(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_assignee_ids uuid[],
  p_due_date date default current_date,
  p_requires_photo boolean default false
)
returns uuid
language plpgsql security definer
as $$
declare
  v_chore_type_id uuid;
  v_event_id uuid;
  v_uid uuid;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;

  insert into chore_types(group_id, name, icon, has_schedule, requires_photo, created_by)
    values (p_group_id, p_name, p_icon, false, p_requires_photo, auth.uid())
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
-- 12. Update ensure_chore_events to skip paused users (vacation mode)
-- ============================================================
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
    v_date := current_date;
    
    if coalesce(v_ct.is_rotational, true) then
      -- Find first non-paused person (with fallback if everyone is paused)
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
      -- Non-rotational: assign everyone (skip paused)
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
      -- Advance rotation, skipping paused users
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
