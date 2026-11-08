-- Migration 009: Group Language Setting for Notifications

-- 1. Add notification_language to groups
alter table groups add column if not exists notification_language text default 'en';

-- 2. Update create_group to accept p_notification_language
create or replace function create_group(
  p_name text, 
  p_display_name text,
  p_notification_language text default 'en'
)
returns uuid
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_code text;
begin
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into groups(name, invite_code, created_by, notification_language) 
    values (p_name, v_code, auth.uid(), p_notification_language)
    returning id into v_group_id;
  insert into memberships(group_id, user_id, display_name, role)
    values (v_group_id, auth.uid(), p_display_name, 'owner');
  return v_group_id;
end;
$$;

-- 3. Update update_household_settings to accept p_notification_language
create or replace function update_household_settings(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_allow_anyone_to_edit_chores boolean,
  p_nudge_policy text default 'restricted',
  p_notification_language text default 'en'
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
      notification_language = p_notification_language
  where id = p_group_id;
end;
$$;
