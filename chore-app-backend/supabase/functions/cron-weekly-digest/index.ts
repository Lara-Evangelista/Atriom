// supabase/functions/cron-weekly-digest/index.ts
//
// Designed to run every Sunday at 9 AM via Supabase Cron.
// Sends a push notification to all group members summarizing:
// - The week's leaderboard top 3
// - Number of overdue tasks
// - Total tasks completed this week

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get all groups
    const { data: groups, error: groupsErr } = await supabase
      .from("groups")
      .select("id, name, notification_language");
    if (groupsErr) throw groupsErr;
    if (!groups || groups.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 });
    }

    let totalSent = 0;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const group of groups) {
      const lang = group.notification_language || "en";
      const isPT = lang.startsWith("pt");

      // Get leaderboard for this week
      const { data: leaderboard } = await supabase.rpc("get_leaderboard", {
        p_group_id: group.id,
        p_since: weekAgoStr,
        p_until: todayStr,
      });

      // Count overdue tasks
      const { count: overdueCount } = await supabase
        .from("chore_events")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id)
        .eq("status", "pending")
        .lt("date", todayStr);

      // Get all members to notify
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("group_id", group.id);

      if (!members || members.length === 0) continue;

      const userIds = members.map((m: any) => m.user_id);
      const top3 = (leaderboard || []).slice(0, 3);
      const totalCompleted = (leaderboard || []).reduce((sum: number, r: any) => sum + (r.points || 0), 0);

      // Build the summary message
      let leaderboardStr = "";
      if (top3.length > 0) {
        const medals = ["🥇", "🥈", "🥉"];
        leaderboardStr = top3
          .map((r: any, i: number) => `${medals[i]} ${r.display_name}: ${r.points}`)
          .join("\n");
      }

      const title = isPT
        ? `📊 Resumo Semanal — ${group.name}`
        : `📊 Weekly Digest — ${group.name}`;

      const parts = [];
      if (totalCompleted > 0) {
        parts.push(isPT ? `✅ ${totalCompleted} tarefas concluídas` : `✅ ${totalCompleted} tasks completed`);
      }
      if (overdueCount && overdueCount > 0) {
        parts.push(isPT ? `⚠️ ${overdueCount} tarefas atrasadas` : `⚠️ ${overdueCount} overdue tasks`);
      }
      if (leaderboardStr) {
        parts.push(isPT ? `\n🏆 Classificação:\n${leaderboardStr}` : `\n🏆 Leaderboard:\n${leaderboardStr}`);
      }

      const body = parts.length > 0
        ? parts.join("\n")
        : (isPT ? "Sem atividade esta semana. Vamos lá! 💪" : "No activity this week. Let's get going! 💪");

      const sent = await sendPush(supabase, userIds, title, body, {
        type: "weekly_digest",
        groupId: group.id,
      });

      totalSent += sent;
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }), { status: 200 });
  } catch (e) {
    console.error("cron-weekly-digest error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
