// supabase/functions/cron-overdue-nudger/index.ts
//
// Designed to be called via Supabase Cron (pg_cron) or an external
// scheduler every 5 minutes. Scans for overdue chores that have
// overdue_nudge_interval_minutes set, and sends auto-nudge push
// notifications to assignees who haven't been nudged recently enough.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const now = new Date();

    // Find all pending chore events that:
    // 1. Have a due_time set on their chore_type
    // 2. Have overdue_nudge_interval_minutes set
    // 3. Are for today or earlier (overdue)
    const today = now.toISOString().slice(0, 10);

    const { data: overdueEvents, error: fetchErr } = await supabase
      .from("chore_events")
      .select(`
        id, date, group_id,
        chore_types!inner(name, icon, due_time, overdue_nudge_interval_minutes),
        chore_event_assignees(user_id, last_nudged_at),
        groups!inner(notification_language)
      `)
      .eq("status", "pending")
      .lte("date", today)
      .not("chore_types.overdue_nudge_interval_minutes", "is", null);

    if (fetchErr) throw fetchErr;
    if (!overdueEvents || overdueEvents.length === 0) {
      return new Response(JSON.stringify({ ok: true, nudged: 0 }), { status: 200 });
    }

    let totalNudged = 0;

    for (const event of overdueEvents) {
      const ct = event.chore_types as any;
      const intervalMinutes = ct.overdue_nudge_interval_minutes;
      if (!intervalMinutes || intervalMinutes <= 0) continue;

      // Check if the chore is actually overdue based on due_time
      if (ct.due_time) {
        const [hours, minutes] = ct.due_time.split(":").map(Number);
        const dueDate = new Date(`${event.date}T${ct.due_time}`);
        if (now < dueDate) continue; // Not overdue yet
      }

      const lang = (event.groups as any)?.notification_language || "en";
      const isPT = lang.startsWith("pt");
      const choreName = ct.name || "a chore";

      // Check each assignee
      for (const assignee of (event.chore_event_assignees || [])) {
        const lastNudged = assignee.last_nudged_at ? new Date(assignee.last_nudged_at) : null;
        const intervalMs = intervalMinutes * 60 * 1000;

        // Skip if nudged too recently
        if (lastNudged && (now.getTime() - lastNudged.getTime()) < intervalMs) {
          continue;
        }

        const title = isPT
          ? `⏰ Tarefa atrasada: ${choreName}`
          : `⏰ Overdue: ${choreName}`;
        const body = isPT
          ? `A tua tarefa "${choreName}" está atrasada! Por favor, completa-a o mais rápido possível.`
          : `Your task "${choreName}" is overdue! Please complete it as soon as possible.`;

        const sent = await sendPush(supabase, [assignee.user_id], title, body, {
          type: "overdue_nudge",
          eventId: event.id,
        });

        // Update last_nudged_at
        await supabase
          .from("chore_event_assignees")
          .update({ last_nudged_at: now.toISOString() })
          .eq("chore_event_id", event.id)
          .eq("user_id", assignee.user_id);

        totalNudged += sent;
      }
    }

    return new Response(JSON.stringify({ ok: true, nudged: totalNudged }), { status: 200 });
  } catch (e) {
    console.error("cron-overdue-nudger error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
