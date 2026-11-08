-- Migration 034: habit "today" should use the user's local timezone
--
-- habit_summaries.done_today and compute_habit_streak() both compared
-- habit_completions.completed_date against bare `current_date`, which is
-- the database session's date (UTC on Supabase) -- not the caller's local
-- date. toggle_habit_today(), meanwhile, inserts the completion row using
-- p_local_date, the date the client (mobile/web) computed locally. Those
-- two dates only agree for part of the day; whenever a user's local date
-- has already rolled over but the UTC date hasn't (or vice versa),
-- done_today comes back false even though a completion for "today" (the
-- user's today) genuinely exists. compute_habit_streak's "today not done
-- yet doesn't break the streak" rule masked this for the streak number --
-- a healthy prior streak keeps showing regardless -- which is why the
-- streak looked right while the checkbox/strikethrough never did.
--
-- touch_my_timezone() already stores each user's real IANA timezone in
-- user_settings on every app open. This adds a small helper that derives
-- "today" from that stored timezone, and swaps every bare `current_date`
-- in the habit read-path over to it, so the server's idea of "today"
-- matches the local date the client already sent in p_local_date.

create or replace function user_local_today(p_user_id uuid)
returns date
language sql stable
as $$
  select (now() at time zone coalesce(
    (select timezone from user_settings where user_id = p_user_id),
    'UTC'
  ))::date;
$$;

create or replace function compute_habit_streak(p_habit_id uuid)
returns int
language plpgsql stable
as $$
declare
  v_habit habits%rowtype;
  v_week_end int;
  v_streak int := 0;
  v_check_date date;
  v_week_start date;
  v_count int;
  v_first boolean := true;
  v_current_week_start date;
  v_today date;
begin
  select * into v_habit from habits where id = p_habit_id;
  if not found then return 0; end if;

  v_today := user_local_today(v_habit.user_id);

  select coalesce(week_end_day, 0) into v_week_end
  from user_settings where user_id = v_habit.user_id;
  v_week_end := coalesce(v_week_end, 0);

  if v_habit.frequency = 'daily' then
    v_check_date := v_today;
    loop
      if exists (select 1 from habit_completions where habit_id = p_habit_id and completed_date = v_check_date) then
        v_streak := v_streak + 1;
      elsif v_first then
        -- today not done yet doesn't break the streak
        null;
      else
        exit;
      end if;
      v_first := false;
      v_check_date := v_check_date - 1;
      exit when v_streak = 0 and v_check_date < v_today - 1000; -- safety valve
    end loop;
  else
    v_current_week_start := habit_week_start(v_today, v_week_end);
    v_week_start := v_current_week_start;
    loop
      select count(*) into v_count from habit_completions
      where habit_id = p_habit_id and completed_date between v_week_start and v_week_start + 6;

      if v_count >= v_habit.weekly_target then
        v_streak := v_streak + 1;
      elsif v_first then
        -- current week still in progress and not met yet: doesn't break it
        null;
      else
        exit;
      end if;
      v_first := false;
      v_week_start := v_week_start - 7;
      exit when v_week_start < v_current_week_start - interval '5 years';
    end loop;
  end if;

  return v_streak;
end;
$$;

-- Convenience view: everything the Habits tab needs per habit in one read
-- (current streak + this week's progress for weekly habits).
create or replace view habit_summaries as
select
  h.*,
  compute_habit_streak(h.id) as current_streak,
  case when h.frequency = 'weekly' then (
    select count(*)::int from habit_completions c
    where c.habit_id = h.id
      and c.completed_date between
        habit_week_start(user_local_today(h.user_id), coalesce((select week_end_day from user_settings where user_id = h.user_id), 0))
        and habit_week_start(user_local_today(h.user_id), coalesce((select week_end_day from user_settings where user_id = h.user_id), 0)) + 6
  ) else null end as this_week_count,
  exists (
    select 1 from habit_completions c where c.habit_id = h.id and c.completed_date = user_local_today(h.user_id)
  ) as done_today
from habits h
where h.user_id = auth.uid();
