-- 015_group_admin_lifecycle.sql already fixes leave_group() going forward
-- (auto-promoting the sole/remaining members when the last owner/admin
-- leaves, and deleting a group once it's completely empty). But that fix
-- only runs the next time someone leaves — it does nothing for a group
-- that was ALREADY left ownerless before 015 was deployed (e.g. someone
-- created a group, left it, and rejoined back when the old, buggy
-- leave_group() was still live).
--
-- This is a one-time repair pass: find every group that currently has
-- members but no owner/admin among them, and promote everyone in it to
-- admin — exactly what leave_group() would have done at the time, so
-- nobody is left permanently locked out of their own household's settings.

do $$
declare
  v_group record;
begin
  for v_group in
    select g.id
    from groups g
    where exists (select 1 from memberships m where m.group_id = g.id)
      and not exists (
        select 1 from memberships m
        where m.group_id = g.id and m.role in ('owner', 'admin')
      )
  loop
    update memberships set role = 'admin' where group_id = v_group.id;
  end loop;
end;
$$;
