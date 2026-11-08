-- Migration 025: Wire up habit_notification_mode
--
-- Migration 023 built get_due_scheduled_habit_reminders() and
-- get_due_habit_urgency_nudges(), which correctly branch on each user's
-- habit_notification_mode (off / urgent_only / daily / scheduled_only).
-- But nothing ever called them: cron-habit-reminder was still calling
-- 022's get_due_habit_reminders(), which ignores the mode entirely and
-- always uses the fixed-slot logic. Net effect: habit_notification_mode
-- has been a UI-only setting with no server-side effect — 'off' didn't
-- suppress anything, and 'urgent_only' / 'daily' never fired.
--
-- This migration adds the one piece 023 left out: a function to record
-- that a scheduled/urgent/daily notification was actually sent, so the
-- edge function can dedupe against habit_notifications_sent without
-- needing to compute (or trust a client-supplied) local date itself.
-- The local date is recomputed here from the user's own timezone, the
-- same way the two get_due_* functions compute it, so it lines up with
-- what those functions checked moments earlier.

create or replace function mark_habit_notification_sent(
  p_habit_id uuid,
  p_user_id uuid,
  p_kind text,          -- 'scheduled' | 'urgent' | 'daily'
  p_reminder_id uuid default null  -- only for kind = 'scheduled'
)
returns void
language sql
as $$
  insert into habit_notifications_sent (habit_id, user_id, kind, reminder_id, sent_date)
  select
    p_habit_id,
    p_user_id,
    p_kind,
    p_reminder_id,
    (now() at time zone coalesce((select timezone from user_settings where user_id = p_user_id), 'UTC'))::date
  on conflict (habit_id, kind, sent_date, coalesce(reminder_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do nothing;
$$;

grant execute on function mark_habit_notification_sent(uuid, uuid, text, uuid) to service_role;
