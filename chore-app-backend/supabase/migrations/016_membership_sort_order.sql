-- Migration 015: per-user ordering of households in the switcher.
--
-- Users can belong to multiple groups (create_group / join_group already
-- supported this), but there was no way to control the order they show up
-- in the household switcher. Add a `sort_order` column on memberships
-- (scoped per membership row, i.e. per user+group, so ordering "Family"
-- before "Art Class" for one member never affects any other member's
-- list) and default new memberships to the end of that user's list.
--
-- No new RPC is needed: the existing "members can update own row" policy
-- (001_initial_schema.sql) already lets a user update sort_order on their
-- own membership rows directly via the client.

alter table memberships
  add column if not exists sort_order integer not null default 0;

-- Backfill existing rows with a stable order (joined_at) per user so
-- current switcher lists aren't all zeros/unordered on upgrade.
with ranked as (
  select id, row_number() over (partition by user_id order by joined_at) - 1 as rn
  from memberships
)
update memberships m
set sort_order = ranked.rn
from ranked
where ranked.id = m.id;

-- New memberships (via create_group / join_group) should land at the end
-- of the creating/joining user's existing list, not always at 0.
create or replace function next_membership_sort_order(p_user_id uuid)
returns integer
language sql stable security definer
as $$
  select coalesce(max(sort_order) + 1, 0) from memberships where user_id = p_user_id;
$$;

create or replace function create_group(p_name text, p_display_name text)
returns uuid
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_code text;
begin
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into groups(name, invite_code, created_by) values (p_name, v_code, auth.uid())
    returning id into v_group_id;
  insert into memberships(group_id, user_id, display_name, role, sort_order)
    values (v_group_id, auth.uid(), p_display_name, 'owner', next_membership_sort_order(auth.uid()));
  return v_group_id;
end;
$$;

create or replace function join_group(p_invite_code text, p_display_name text)
returns uuid
language plpgsql security definer
as $$
declare
  v_group_id uuid;
  v_name_taken boolean;
begin
  select id into v_group_id from groups where invite_code = upper(p_invite_code);
  if v_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  select exists(
    select 1 from memberships where group_id = v_group_id and lower(display_name) = lower(p_display_name)
  ) into v_name_taken;
  if v_name_taken then
    raise exception 'That name is already taken in this group';
  end if;

  insert into memberships(group_id, user_id, display_name, role, sort_order)
    values (v_group_id, auth.uid(), p_display_name, 'member', next_membership_sort_order(auth.uid()))
    on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;
