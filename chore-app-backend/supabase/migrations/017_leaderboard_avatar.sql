-- The leaderboard/board screens want to show each member's avatar next to
-- their name (same as the roster and chore-assignment pickers already do),
-- but get_leaderboard never returned avatar_url, so the frontend had
-- nothing to render even after the UI was wired up.

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
      where ce.group_id = p_group_id
        and ce.status = 'done'
        and date(ce.done_at) >= p_since
        and date(ce.done_at) <= p_until
      group by cec.user_id
    ) c on c.user_id = m.user_id
    where m.group_id = p_group_id
    order by points desc, display_name asc;
end;
$$;
