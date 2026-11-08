// supabase/functions/cron-habit-reminder/index.ts
//
// Designed to be called via Supabase Cron (pg_cron) or an external
// scheduler every 5-15 minutes (see backend README).
//
// habit_notification_mode (per user, in user_settings) picks ONE of four
// mutually exclusive behaviors — see migration 023 for the full design
// rationale:
//   off            -> no habit notifications at all
//   scheduled_only -> the specific day/hour slots set per-habit
//   urgent_only    -> only warns once you must do it every remaining
//                     day this week to still hit the target
//   daily          -> a once-a-day "you haven't hit today/this week's
//                     target yet" nudge
//
// This function asks two RPCs which notifications are due right now (in
// each user's own local time) — each SQL function is already scoped to
// the modes it applies to, so a user in 'off' mode simply never shows up
// in either result set:
//   - get_due_scheduled_habit_reminders() -> scheduled_only mode
//   - get_due_habit_urgency_nudges()      -> urgent_only / daily modes
//
// Suppression (weekly target already met, user on vacation) is handled
// inside those functions — see migration 023's comments for the exact
// rules. After each push, mark_habit_notification_sent() (migration 025)
// logs it against habit_notifications_sent so the same slot/day doesn't
// fire twice.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const [{ data: scheduled, error: scheduledError }, { data: urgency, error: urgencyError }] =
      await Promise.all([
        supabase.rpc("get_due_scheduled_habit_reminders", { p_window_minutes: 15 }),
        supabase.rpc("get_due_habit_urgency_nudges", { p_check_hour: 20, p_window_minutes: 30 }),
      ]);
    if (scheduledError) throw scheduledError;
    if (urgencyError) throw urgencyError;

    let sent = 0;

    // scheduled_only mode: fixed day/time slots the user picked per habit.
    for (const r of scheduled || []) {
      const isPT = (r.lang || "en").startsWith("pt");
      const title = r.icon ? `${r.icon} ${r.name}` : r.name;
      const body = isPT
        ? `Hora de "${r.name}".`
        : `Time for "${r.name}".`;

      const count = await sendPush(supabase, [r.user_id], title, body, {
        type: "habit_reminder",
        habitId: r.habit_id,
      });

      // Log regardless of whether a device was actually reachable (count
      // could be 0 with no push subscriptions) — otherwise a user with no
      // subscriptions would cause this slot to be re-matched every tick
      // all day.
      await supabase.rpc("mark_habit_notification_sent", {
        p_habit_id: r.habit_id,
        p_user_id: r.user_id,
        p_kind: "scheduled",
        p_reminder_id: r.reminder_id,
      });

      sent += count;
    }

    // urgent_only / daily modes: one automatic nudge per user-local-day.
    for (const r of urgency || []) {
      const isPT = (r.lang || "en").startsWith("pt");
      const isDaily = r.frequency === "daily";
      const title = r.icon ? `${r.icon} ${r.name}` : r.name;

      let body: string;
      if (r.kind === "urgent") {
        // Only fires when every remaining day this week is needed to hit
        // the target, so this is always a "last chance" message.
        body = isPT
          ? `Última chamada: precisas de fazer "${r.name}" hoje para ainda conseguires o objetivo desta semana (${r.this_week_count}/${r.weekly_target}).`
          : `Last call: you need to do "${r.name}" today to still hit this week's goal (${r.this_week_count}/${r.weekly_target}).`;
      } else if (isDaily) {
        body = isPT
          ? `Ainda não fizeste "${r.name}" hoje.`
          : `You haven't done "${r.name}" yet today.`;
      } else {
        body = isPT
          ? `"${r.name}" — estás em ${r.this_week_count}/${r.weekly_target} esta semana. Não te esqueças.`
          : `"${r.name}" — you're at ${r.this_week_count}/${r.weekly_target} this week. Don't forget.`;
      }

      const count = await sendPush(supabase, [r.user_id], title, body, {
        type: "habit_reminder",
        habitId: r.habit_id,
      });

      await supabase.rpc("mark_habit_notification_sent", {
        p_habit_id: r.habit_id,
        p_user_id: r.user_id,
        p_kind: r.kind,
        p_reminder_id: null,
      });

      sent += count;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scheduled_slots: (scheduled || []).length,
        urgency_nudges: (urgency || []).length,
        sent,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("cron-habit-reminder error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
