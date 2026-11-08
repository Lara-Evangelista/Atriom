// supabase/functions/daily-check/index.ts
//
// Runs on a schedule (set up via pg_cron — see README). Two jobs that must
// fire even if nobody opens the app:
//   1. "It's your turn today" for scheduled chore_events.
//   2. "Cycle finished, go unload it" for running timer chore_runs whose
//      cycle_ends_at has passed. (This one could also run more often than
//      daily if you want faster alerts — see README for adjusting the cron.)
//
// Because this runs once a day and always asks for "30 days from today",
// the visible window of upcoming turns rolls forward by exactly one day
// every day — there are always ~30 days of turns generated ahead, enough
// room for people to arrange trades before their turn comes up.
//
// Sends via standard Web Push (see _shared/push.ts) rather than Expo.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const throughDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Extend schedules for every group.
  const { data: groups } = await supabase.from("groups").select("id");
  for (const g of groups || []) {
    await supabase.rpc("ensure_all_events", { p_group_id: g.id, p_through_date: throughDate });
  }

  // 1. Due-today scheduled turns.
  const { data: dueEvents } = await supabase
    .from("chore_events")
    .select(`
      id, group_id, chore_types ( name ),
      chore_event_assignees ( user_id )
    `)
    .eq("date", today)
    .eq("status", "pending")
    .eq("notified_turn", false);

  let turnCount = 0;
  for (const ev of dueEvents || []) {
    const choreName = (ev as any).chore_types?.name || "a chore";
    await supabase.from("chore_events").update({ notified_turn: true }).eq("id", ev.id);
    await supabase.from("activity_log").insert({
      group_id: ev.group_id,
      text: `It's your turn today: ${choreName}.`,
      type: "turn",
    });
    const assignees = ((ev as any).chore_event_assignees || []).map((a: any) => a.user_id).filter(Boolean);
    await sendPush(supabase, assignees, "Chore due today", choreName);
    turnCount++;
  }

  // 2. Timer cycles that finished but nobody's been told yet.
  //
  //    The cycle itself (the wash actually running) is closed out
  //    automatically here — nobody has to "complete" a timer expiring on
  //    its own, so done_by is left null on purpose (see get_leaderboard:
  //    a null done_by earns no points). What DOES earn a point is the
  //    follow-up task this spins up ("Unload: Dishwasher"), assigned only
  //    to the people who were on the timer when it was started — everyone
  //    else in the group is left alone, notification-wise.
  const nowIso = new Date().toISOString();
  const { data: finishedRuns } = await supabase
    .from("chore_runs")
    .select("id, group_id, chore_type_id, trigger_reason, chore_types ( name, icon )")
    .eq("status", "running")
    .eq("notified_cycle_end", false)
    .lte("cycle_ends_at", nowIso);

  let timerCount = 0;
  for (const run of finishedRuns || []) {
    const choreName = (run as any).chore_types?.name || "The cycle";
    const icon = (run as any).chore_types?.icon || null;

    await supabase
      .from("chore_runs")
      .update({ status: "done", done_at: new Date().toISOString(), notified_cycle_end: true })
      .eq("id", run.id);

    const { data: assignees } = await supabase
      .from("chore_run_assignees")
      .select("user_id")
      .eq("chore_run_id", run.id);
    const userIds = (assignees || []).map((a: any) => a.user_id);

    if (userIds.length > 0) {
      if (run.trigger_reason === "onetime_timer") {
        const { data: ev } = await supabase.from('chore_events').insert({
          chore_type_id: run.chore_type_id,
          group_id: run.group_id,
          date: today,
          status: 'pending'
        }).select('id').single();
        if (ev) {
          await supabase.from('chore_event_assignees').insert(userIds.map((uid: string) => ({ chore_event_id: ev.id, user_id: uid })));
        }
        await sendPush(supabase, userIds, "Timer finished", `${choreName} is ready!`);
      } else {
        await supabase.rpc("create_onetime_task_system", {
          p_group_id: run.group_id,
          p_name: `Unload: ${choreName}`,
          p_icon: icon,
          p_assignee_ids: userIds,
        });
        await sendPush(supabase, userIds, "Ready to unload", `${choreName} finished — go unload it.`);
      }
    }
    timerCount++;
  }

  return new Response(JSON.stringify({ ok: true, turnsNotified: turnCount, timersNotified: timerCount }), {
    status: 200,
  });
});
