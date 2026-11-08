-- Migration 015: fix the "ownerless group" bug and clean up abandoned groups.
--
-- Bug: leave_group() only ever deleted the caller's membership row. It never
-- checked whether that left the group with zero owners/admins, and it never
-- cleaned up a group that had become empty. Concretely:
--   1. Solo user creates a group -> becomes 'owner'.
--   2. They leave -> membership row deleted, but the group row (and its
--      invite code) stays around forever with zero members.
--   3. They rejoin via the same invite code -> join_group() always inserts
--      new members as role='member' -> now the group has exactly one
--      member and NO owner/admin, so nobody can pass is_group_admin() and
--      settings become permanently unreachable.
--
-- Fix:
--   - When someone leaves, if they were the last owner/admin and other
--     members remain, promote all remaining members to 'admin' (so a
--     solo remaining member becomes admin automatically, matching the
--     single-owner case).
--   - When someone leaves and no members remain at all, delete the group.
--     Related rows (memberships, chores, resources, etc.) all reference
--     groups(id) on delete cascade, so this cleans up everything for an
--     abandoned household without a separate sweep job.
--   - Add group_member_count() so the frontend can warn "leaving will
--     delete this group" before the last person confirms.

create or replace function group_member_count(p_group_id uuid)
returns int
language sql security definer stable
as $$
  select count(*)::int from memberships where group_id = p_group_id;
$$;

create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_was_admin boolean;
  v_remaining int;
begin
  select role in ('owner', 'admin') into v_was_admin
  from memberships
  where group_id = p_group_id and user_id = auth.uid();

  delete from memberships where group_id = p_group_id and user_id = auth.uid();

  select count(*) into v_remaining from memberships where group_id = p_group_id;

  if v_remaining = 0 then
    -- Nobody left in the household at all: nothing worth keeping around.
    -- Cascades to memberships (already empty), chores, resources, events,
    -- rewards, etc.
    delete from groups where id = p_group_id;
    return;
  end if;

  if v_was_admin then
    -- The group's last owner/admin just left. If nobody else with
    -- owner/admin rights remains, promote everyone who's left so the
    -- household is never stuck ownerless. (If a solo person remains,
    -- this makes them admin automatically.)
    if not exists (
      select 1 from memberships
      where group_id = p_group_id and role in ('owner', 'admin')
    ) then
      update memberships
      set role = 'admin'
      where group_id = p_group_id;
    end if;
  end if;
end;
$$;
