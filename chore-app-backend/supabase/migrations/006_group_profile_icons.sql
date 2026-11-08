-- Add icon to groups
alter table groups add column if not exists icon text;

-- Add avatar_url to memberships
alter table memberships add column if not exists avatar_url text;

-- Function to update group settings
create or replace function update_group_settings(p_group_id uuid, p_name text, p_icon text)
returns void
language plpgsql security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  update groups set name = p_name, icon = p_icon where id = p_group_id;
end;
$$;

-- Function to update membership profile
create or replace function update_membership_profile(p_group_id uuid, p_display_name text, p_avatar_url text)
returns void
language plpgsql security definer
as $$
begin
  update memberships 
  set display_name = p_display_name, avatar_url = p_avatar_url 
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;
