// supabase/functions/calendar-feed/index.ts
//
// GET /calendar-feed?token=<calendar_tokens.token>
//
// Returns an .ics (iCalendar) feed of one person's chores in one group:
// their upcoming scheduled turns, their pending one-time tasks, and any
// running timer cycles. No Supabase auth header — the token itself (a
// random uuid, get_or_create_calendar_token / rotate_calendar_token in
// schema.sql) is the credential, because calendar apps subscribing to a
// URL can't send custom auth headers.
//
// In the app: call supabase.rpc('get_or_create_calendar_token', { p_group_id })
// then build the link as:
//   `${SUPABASE_URL}/functions/v1/calendar-feed?token=${token}`
// and offer "Copy calendar link" / "Add to Google Calendar" (Google
// Calendar > Other calendars > + > From URL).

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function dateStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// All-day event value, e.g. 20260906
function dayValue(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Missing token", { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: tokenRow } = await supabase
    .from("calendar_tokens")
    .select("user_id, group_id")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) {
    return new Response("Invalid or revoked calendar link", { status: 404, headers: corsHeaders });
  }

  const { user_id: userId, group_id: groupId } = tokenRow;

  const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle();
  const groupName = group?.name || "Chores";

  // A window around today: a bit of recent history plus the ~30-day
  // rolling horizon the schema keeps generated ahead.
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const through = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("chore_events")
    .select("id, date, status, chore_types ( name, icon )")
    .eq("group_id", groupId)
    .eq("assigned_user_id", userId)
    .gte("date", from)
    .lte("date", through)
    .order("date", { ascending: true });

  const { data: runs } = await supabase
    .from("chore_runs")
    .select("id, started_at, cycle_ends_at, status, chore_types ( name, icon )")
    .eq("group_id", groupId)
    .in("status", ["running", "pending"])
    .order("started_at", { ascending: true });

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Chore App//Calendar Feed//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push(`X-WR-CALNAME:${icsEscape(groupName + " chores")}`);
  // Ask calendar apps to poll roughly every 4 hours; most will still use
  // their own minimum refresh interval on top of this (Google ignores it
  // and uses its own ~8-24h schedule).
  lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT4H");
  lines.push("X-PUBLISHED-TTL:PT4H");

  for (const ev of events || []) {
    const choreName = (ev as any).chore_types?.name || "Chore";
    const icon = (ev as any).chore_types?.icon;
    const summary = (icon ? icon + " " : "") + choreName + (ev.status === "done" ? " (done)" : "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:chore-event-${ev.id}@chore-app`);
    lines.push(`DTSTAMP:${dateStamp(new Date())}`);
    lines.push(`DTSTART;VALUE=DATE:${dayValue(ev.date)}`);
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    lines.push(`STATUS:${ev.status === "done" ? "CONFIRMED" : "TENTATIVE"}`);
    lines.push("END:VEVENT");
  }

  for (const run of runs || []) {
    if (!run.cycle_ends_at) continue;
    const choreName = (run as any).chore_types?.name || "Cycle";
    const icon = (run as any).chore_types?.icon;
    const start = new Date(run.started_at);
    const end = new Date(run.cycle_ends_at);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:chore-run-${run.id}@chore-app`);
    lines.push(`DTSTAMP:${dateStamp(new Date())}`);
    lines.push(`DTSTART:${dateStamp(start)}`);
    lines.push(`DTEND:${dateStamp(end)}`);
    lines.push(`SUMMARY:${icsEscape((icon ? icon + " " : "") + choreName + " ready")}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="chores.ics"',
    },
  });
});
