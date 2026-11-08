-- Migration 024: Habit reminder push notification language
--
-- NOTE: superseded by migration 025. This patched get_due_habit_reminders()
-- (022's fixed-slot function) to also return a language, since at the time
-- that was the only function cron-habit-reminder actually called. Once 025
-- wires the edge function up to habit_notification_mode via 023's
-- get_due_scheduled_habit_reminders() / get_due_habit_urgency_nudges()
-- (which already had language support from day one), this function is no
-- longer called by anything. Left in place rather than dropped, in case
-- anything else ends up depending on the old fixed-slot-only behavior.
--
-- get_due_habit_reminders() (022) is the function cron-habit-reminder
-- actually calls, but it never returned a language, so that edge
-- function has been sending English-only push text regardless of the
-- user's household notification_language setting. Migration 023 already
-- added habit_notification_lang(user_id) for the (unused) scheduled-mode
-- helper functions — this migration just adds the same 'lang' column to
-- get_due_habit_reminders() so the edge function can pick English vs
-- Portuguese, mirroring notify / notify-nudge / notify-completion /
-- cron-weekly-digest.

-- CREATE OR REPLACE can't change a function's return row shape (only its
-- body), and 022's version returns a narrower row (no local_date, no
-- lang) than this one. Drop it first, matching 022's exact signature.
drop function if exists get_due_habit_reminders(int);

create or replace function get_due_habit_reminders(p_lookback_minutes int default 20)
returns table (
  reminder_id uuid,
  habit_id uuid,
  user_id uuid,
  habit_name text,
  habit_icon text,
  frequency text,
  local_date date,
  lang text
)
language sql stable
as $$
  select
    r.id as reminder_id,
    h.id as habit_id,
    h.user_id,
    h.name as habit_name,
    h.icon as habit_icon,
    h.frequency,
    ln.local_now::date as local_date,
    habit_notification_lang(h.user_id) as lang
  from habit_reminders r
  join habits h on h.id = r.habit_id
  cross join lateral (
    select coalesce(us.timezone, 'UTC') as tz
    from user_settings us where us.user_id = h.user_id
  ) tzs
  cross join lateral (
    select (now() at time zone tzs.tz) as local_now
  ) ln
  where h.archived = false
    and h.notifications_enabled = true
    and (r.day_of_week is null or r.day_of_week = extract(dow from ln.local_now)::int)
    and r.time_local <= ln.local_now::time
    and r.time_local > (ln.local_now::time - make_interval(mins => p_lookback_minutes))
    and not exists (
      select 1 from habit_reminder_log l
      where l.reminder_id = r.id and l.local_date = ln.local_now::date
    )
    and not is_user_on_vacation(h.user_id)
    and (
      h.frequency = 'daily'
      or (
        select count(*) from habit_completions c
        where c.habit_id = h.id
          and c.completed_date between
            habit_week_start(ln.local_now::date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0))
            and habit_week_start(ln.local_now::date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0)) + 6
      ) < h.weekly_target
    );
$$;
