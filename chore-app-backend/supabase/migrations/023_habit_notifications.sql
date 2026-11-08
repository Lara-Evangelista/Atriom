-- Migration 023: Habit notification delivery
--
-- Migration 022 built the whole habits data model (habits, habit_reminders,
-- habit_completions, user_settings.habit_notification_mode) but nothing
-- ever reads habit_reminders or the mode and actually sends a push. This
-- migration adds the two read-side functions the new `cron-habit-reminders`
-- edge function calls, plus a dedupe log so a habit never gets nudged twice
-- for the same thing on the same day even if the cron runs more often than
-- once per tick window.
--
-- Design decisions (flagging these since the mode's exact behavior wasn't
-- fully pinned down — easy to adjust if this doesn't match what you want):
--
-- - The four `habit_notification_mode` values are treated as mutually
--   exclusive behaviors, not layers:
--     off            -> no habit notifications at all
--     urgent_only    -> ONLY the "must do it every remaining day" alert
--     daily          -> ONLY a once-a-day "you haven't hit today/this
--                        week's target yet" reminder
--     scheduled_only -> ONLY the specific day/hour slots set per-habit
--                        in habit_reminders fire
--   i.e. a habit's own habit_reminders schedule only actually sends
--   anything while the user's global mode is 'scheduled_only'. Under the
--   other three modes, per-habit reminder times are ignored in favor of
--   the automatic logic. If you'd rather have scheduled reminders fire
--   in every mode (as an addition, not an alternative), that's a small
--   change to get_due_scheduled_habit_reminders() below.
-- - Both automatic modes (urgent_only, daily) check once per day at a
--   fixed local hour (20:00 / 8pm, HABIT_URGENCY_CHECK_HOUR below) rather
--   than a per-habit time, since there's no per-habit "urgency hour".
-- - "On vacation" for a personal (non-group) habit is defined as: the
--   user has at least one group membership, and every membership of
--   theirs currently has is_paused = true. A user with zero memberships
--   is never considered on vacation.
-- - Habit push text is English by default; if the user belongs to any
--   group with notification_language starting 'pt', Portuguese is used
--   (mirroring how existing chore notifications pick language per group,
--   applied loosely here since habits aren't group-scoped).

-- ------------------------------------------------------------
-- Dedupe log — one row per notification actually sent.
-- ------------------------------------------------------------
create table if not exists habit_notifications_sent (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('scheduled', 'urgent', 'daily')),
  -- non-null only for kind = 'scheduled', identifies which reminder slot
  reminder_id uuid references habit_reminders(id) on delete cascade,
  sent_date date not null,
  sent_at timestamptz not null default now()
);

-- One send per (habit, kind, reminder slot, day). The coalesce lets
-- 'urgent'/'daily' rows (reminder_id is null) still dedupe correctly.
create unique index if not exists habit_notifications_sent_dedupe
  on habit_notifications_sent (
    habit_id, kind, sent_date,
    coalesce(reminder_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table habit_notifications_sent enable row level security;
drop policy if exists "own habit notification log" on habit_notifications_sent;
create policy "own habit notification log" on habit_notifications_sent for select
  using (user_id = auth.uid());
-- No insert/update/delete policy for regular users — only the edge
-- function (service role, which bypasses RLS entirely) writes here.

create index if not exists habit_notifications_sent_lookup
  on habit_notifications_sent (habit_id, sent_date);

-- ------------------------------------------------------------
-- user_settings.habit_notification_mode
--
-- This migration's header comment (and the functions below) assume this
-- column already exists, but it doesn't: migration 022 deliberately
-- removed the old global mode switch in favor of fully-manual per-habit
-- reminders (see 022's PART 1 header comment), then this migration
-- re-introduces a global mode to add automatic urgent/daily nudges on
-- top of that — without ever adding the column back. Adding it here.
--
-- Default 'scheduled_only' preserves pre-023 behavior for every existing
-- user: a habit only ever notifies if it has explicit reminder slots set,
-- same as before this migration. Nobody is silently opted into the new
-- automatic urgent/daily nudges — they have to choose that in Settings.
-- ------------------------------------------------------------
alter table user_settings
  add column if not exists habit_notification_mode text not null default 'scheduled_only'
  check (habit_notification_mode in ('off', 'scheduled_only', 'urgent_only', 'daily'));

-- ------------------------------------------------------------
-- Vacation check, shared by both functions below.
-- ------------------------------------------------------------
create or replace function is_user_on_habit_vacation(p_user_id uuid)
returns boolean
language sql stable
as $$
  select
    exists (select 1 from memberships where user_id = p_user_id)
    and not exists (
      select 1 from memberships
      where user_id = p_user_id and coalesce(is_paused, false) = false
    );
$$;

-- Best-effort language guess: pt if any of the user's groups uses it.
create or replace function habit_notification_lang(p_user_id uuid)
returns text
language sql stable
as $$
  select case
    when exists (
      select 1 from memberships m
      join groups g on g.id = m.group_id
      where m.user_id = p_user_id and g.notification_language like 'pt%'
    ) then 'pt' else 'en'
  end;
$$;

-- ------------------------------------------------------------
-- Function A: scheduled_only mode — specific day/hour slots.
-- Called on a tight cron tick (e.g. every 15 min); matches any slot
-- whose local time falls within the last 15 minutes, not sent yet today.
-- ------------------------------------------------------------
create or replace function get_due_scheduled_habit_reminders(p_window_minutes int default 15)
returns table (
  habit_id uuid,
  user_id uuid,
  name text,
  icon text,
  reminder_id uuid,
  lang text
)
language sql stable
as $$
  select
    h.id, h.user_id, h.name, h.icon, hr.id, habit_notification_lang(h.user_id)
  from habits h
  join habit_reminders hr on hr.habit_id = h.id
  join user_settings us on us.user_id = h.user_id
  where h.archived = false
    and h.notifications_enabled = true
    and us.habit_notification_mode = 'scheduled_only'
    and not is_user_on_habit_vacation(h.user_id)
    and (hr.day_of_week is null or hr.day_of_week = extract(dow from (now() at time zone us.timezone))::int)
    -- Known limitation: a slot in the last p_window_minutes before midnight
    -- (e.g. 23:50 with a 15-min window) won't match, since the window
    -- wraps past 00:00 and `between` can't express that. Rare in practice
    -- for a habit reminder; worth a follow-up if you actually hit it.
    and (now() at time zone us.timezone)::time
        between hr.time_local and hr.time_local + make_interval(mins => p_window_minutes) - interval '1 second'
    and not exists (
      select 1 from habit_notifications_sent s
      where s.habit_id = h.id and s.kind = 'scheduled' and s.reminder_id = hr.id
        and s.sent_date = (now() at time zone us.timezone)::date
    );
$$;

-- ------------------------------------------------------------
-- Function B: urgent_only / daily automatic nudges.
-- Fires once per user-local-day, at HABIT_URGENCY_CHECK_HOUR.
-- ------------------------------------------------------------
create or replace function get_due_habit_urgency_nudges(
  p_check_hour int default 20,     -- 8pm local
  p_window_minutes int default 30  -- tolerance for cron cadence
)
returns table (
  habit_id uuid,
  user_id uuid,
  name text,
  icon text,
  frequency text,
  kind text,              -- 'urgent' | 'daily'
  this_week_count int,
  weekly_target int,
  lang text
)
language plpgsql stable
as $$
declare
begin
  return query
  with due_users as (
    select h.id as habit_id, h.user_id, h.name, h.icon, h.frequency, h.weekly_target,
           us.habit_notification_mode as mode,
           us.timezone,
           coalesce(us.week_end_day, 0) as week_end_day,
           (now() at time zone us.timezone) as local_ts
    from habits h
    join user_settings us on us.user_id = h.user_id
    where h.archived = false
      and h.notifications_enabled = true
      and us.habit_notification_mode in ('urgent_only', 'daily')
      and not is_user_on_habit_vacation(h.user_id)
  )
  select
    du.habit_id, du.user_id, du.name, du.icon, du.frequency,
    (case when du.mode = 'urgent_only' then 'urgent' else 'daily' end) as kind,
    wk.this_week_count,
    du.weekly_target,
    habit_notification_lang(du.user_id)
  from due_users du
  left join lateral (
    select
      case when du.frequency = 'weekly' then
        (select count(*)::int from habit_completions c
         where c.habit_id = du.habit_id
           and c.completed_date between
             habit_week_start(du.local_ts::date, du.week_end_day)
             and habit_week_start(du.local_ts::date, du.week_end_day) + 6)
      else null end as this_week_count,
      exists (
        select 1 from habit_completions c
        where c.habit_id = du.habit_id and c.completed_date = du.local_ts::date
      ) as done_today
  ) wk on true
  where
    extract(hour from du.local_ts)::int = p_check_hour
    and extract(minute from du.local_ts)::int < p_window_minutes
    and not exists (
      select 1 from habit_notifications_sent s
      where s.habit_id = du.habit_id
        and s.kind = (case when du.mode = 'urgent_only' then 'urgent' else 'daily' end)
        and s.sent_date = du.local_ts::date
    )
    and (
      -- daily habit: only "not done today" matters for either mode
      (du.frequency = 'daily' and not wk.done_today)
      or
      -- weekly habit, mode = daily: remind every day until target met
      (du.frequency = 'weekly' and du.mode = 'daily'
        and coalesce(wk.this_week_count, 0) < du.weekly_target)
      or
      -- weekly habit, mode = urgent_only: only once you must do it
      -- literally every remaining day (including today) to still hit target
      (du.frequency = 'weekly' and du.mode = 'urgent_only'
        and coalesce(wk.this_week_count, 0) < du.weekly_target
        and (du.weekly_target - coalesce(wk.this_week_count, 0))
            >= ((habit_week_start(du.local_ts::date, du.week_end_day) + 6 - du.local_ts::date) + 1))
    );
end;
$$;

grant execute on function get_due_scheduled_habit_reminders(int) to service_role;
grant execute on function get_due_habit_urgency_nudges(int, int) to service_role;
grant execute on function is_user_on_habit_vacation(uuid) to service_role;
grant execute on function habit_notification_lang(uuid) to service_role;
