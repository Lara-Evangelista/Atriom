-- Migration 026: fix "could not choose the best candidate function" on
-- create_group again.
--
-- 011_fix_ambiguous_overloads.sql already fixed this once, by dropping the
-- old 2-arg create_group(text, text) and keeping only 009's 3-arg version
-- (p_name, p_display_name, p_notification_language default 'en').
--
-- 016_membership_sort_order.sql then recreated a brand-new 2-arg
-- create_group(p_name, p_display_name) to add sort_order support, without
-- dropping or merging with 009's version. Since 009's third parameter has a
-- default, it's callable with just 2 args too, so both clients (web and
-- mobile) calling create_group(p_name, p_display_name) became ambiguous
-- again between the two overloads.
--
-- This drops both stale overloads and replaces them with a single
-- canonical create_group that keeps both features: notification_language
-- (009) and sort_order (016).

drop function if exists create_group(text, text);
drop function if exists create_group(text, text, text);

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
  insert into memberships(group_id, user_id, display_name, role, sort_order)
    values (v_group_id, auth.uid(), p_display_name, 'owner', next_membership_sort_order(auth.uid()));
  return v_group_id;
end;
$$;
