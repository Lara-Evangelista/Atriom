-- People in several households had no way to see what's due today (or
-- coming up) across ALL of their households at once — they had to switch
-- into each one individually. These functions are scoped by auth.uid()
-- via chore_event_assignees, not by a single p_group_id, so they naturally
-- span every household the caller belongs to.

drop function if exists get_my_chores(date, date);

create or replace function get_my_chores(
  p_since date default null,
  p_until date default null
)
returns table (
  event_id uuid,
  group_id uuid,
  group_name text,
  group_icon text,
  chore_type_id uuid,
  name text,
  icon text,
  date date,
  status text,
  requires_photo boolean,
  is_delayable boolean,
  max_consecutive_delays int,
  consecutive_delays_count int
)
language plpgsql stable security definer
as $$
begin
  return query
    select distinct
      ce.id, ce.group_id, g.name, g.icon, ct.id, ct.name, ct.icon, ce.date, ce.status,
      ct.requires_photo, ct.is_delayable, ct.max_consecutive_delays, ce.consecutive_delays_count
    from chore_event_assignees cea
    join chore_events ce on ce.id = cea.event_id
    join chore_types ct on ct.id = ce.chore_type_id
    join groups g on g.id = ce.group_id
    where cea.user_id = auth.uid()
      and ce.status = 'pending'
      and (p_since is null or ce.date >= p_since)
      and (p_until is null or ce.date <= p_until)
    order by ce.date asc;
end;
$$;

drop function if exists get_my_calendar_month(int, int);

create or replace function get_my_calendar_month(p_year int, p_month int)
returns jsonb
language plpgsql stable security definer
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end date := (v_start + interval '1 month')::date;
  v_result jsonb;
begin
  select jsonb_object_agg(day, items) into v_result
  from (
    select to_char(ce.date, 'YYYY-MM-DD') as day,
      jsonb_agg(jsonb_build_object(
        'id', ce.id,
        'group_id', ce.group_id,
        'group_name', g.name,
        'group_icon', g.icon,
        'name', ct.name,
        'icon', ct.icon,
        'status', ce.status,
        'requires_photo', ct.requires_photo,
        'is_delayable', ct.is_delayable,
        'max_consecutive_delays', ct.max_consecutive_delays,
        'consecutive_delays_count', ce.consecutive_delays_count,
        'assigned_user_id', ce.assigned_user_id
      ) order by ct.name) as items
    from chore_event_assignees cea
    join chore_events ce on ce.id = cea.event_id
    join chore_types ct on ct.id = ce.chore_type_id
    join groups g on g.id = ce.group_id
    where cea.user_id = auth.uid()
      and ce.date >= v_start and ce.date < v_end
    group by ce.date
  ) grouped;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;
