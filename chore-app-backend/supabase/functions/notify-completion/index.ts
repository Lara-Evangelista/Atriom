// supabase/functions/notify-completion/index.ts
//
// Called by the client after completing a chore event to notify the other
// assigned people with a grammatically correct, pronoun-aware message.
//
// POST body: { eventId: string, creditedUserIds: string[] }
//
// Constructs a sentence like:
//   "Lara marked Dishwasher as done!"
//   "Lara and Bob marked Dishwasher as done!"
//   "Lara marked Dishwasher as done by her, Bob, and you"

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// EN pronouns to object pronoun
function pronounObjEN(pronouns: string) {
  const p = (pronouns || "they/them").toLowerCase();
  if (p.startsWith("she")) return "her";
  if (p.startsWith("he")) return "him";
  return "them";
}

// PT pronoun mappings
function pronounObjPT(pronouns: string) {
  const p = (pronouns || "they/them").toLowerCase();
  if (p.startsWith("she")) return "ela";
  if (p.startsWith("he")) return "ele";
  return "eles/elas";
}

function joinNamesEN(names: string[]): string {
  if (names.length === 0) return "someone";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function joinNamesPT(names: string[]): string {
  if (names.length === 0) return "alguém";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, e ${names[names.length - 1]}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { eventId, creditedUserIds } = await req.json();
    if (!eventId) {
      return new Response(JSON.stringify({ ok: false, error: "eventId is required" }), { status: 400, headers: corsHeaders });
    }

    // Authenticate caller
    const authorization = req.headers.get("Authorization");
    if (!authorization) return new Response(JSON.stringify({ ok: false, error: "Authorization required" }), { status: 401, headers: corsHeaders });

    const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const callerId = authData.user.id;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get event details
    const { data: event } = await supabase
      .from("chore_events")
      .select("id, group_id, chore_type_id, chore_types(name), groups!inner(notification_language)")
      .eq("id", eventId)
      .single();

    if (!event) return new Response(JSON.stringify({ ok: false, error: "Event not found" }), { status: 404, headers: corsHeaders });

    const choreName = (event as any).chore_types?.name || "a chore";
    const lang = (event as any).groups?.notification_language || "en";
    const isPT = lang.startsWith("pt");

    // Get all assignees for this event
    const { data: assignees } = await supabase
      .from("chore_event_assignees")
      .select("user_id")
      .eq("chore_event_id", event.id);
    const assigneeIds = (assignees || []).map((a: any) => a.user_id);

    // People to notify = assignees who are NOT the caller
    let toNotify = assigneeIds.filter((id: string) => id !== callerId);

    // If rotational or single-assignee chore, notify other members in the rotation or household
    if (toNotify.length === 0) {
      const { data: rotMembers } = await supabase
        .from("chore_type_rotation")
        .select("user_id")
        .eq("chore_type_id", event.chore_type_id);
      const rotIds = (rotMembers || []).map((r: any) => r.user_id).filter((uid: string) => uid !== callerId);
      if (rotIds.length > 0) {
        toNotify = rotIds;
      } else {
        const { data: household } = await supabase
          .from("memberships")
          .select("user_id")
          .eq("group_id", event.group_id)
          .neq("user_id", callerId);
        toNotify = (household || []).map((m: any) => m.user_id);
      }
    }

    if (toNotify.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: "No one else to notify" }), { status: 200, headers: corsHeaders });
    }

    // Get memberships for pronoun + name lookups
    const { data: memberships } = await supabase
      .from("memberships")
      .select("user_id, display_name, pronouns")
      .eq("group_id", event.group_id)
      .in("user_id", [...new Set([callerId, ...(creditedUserIds || []), ...toNotify])]);

    const memberMap = new Map((memberships || []).map((m: any) => [m.user_id, m]));
    const callerName = memberMap.get(callerId)?.display_name || (isPT ? "Alguém" : "Someone");

    // Build notification body for each recipient
    let sent = 0;
    for (const recipientId of toNotify) {
      const credited = (creditedUserIds || [callerId]) as string[];

      // Build the "done by" part from the perspective of the recipient
      const doerNames: string[] = [];
      for (const uid of credited) {
        if (uid === recipientId) {
          doerNames.push(isPT ? "ti" : "you");
        } else if (uid === callerId) {
          // Caller is already named at the start, skip if they're the only doer
          continue;
        } else {
          const m = memberMap.get(uid);
          doerNames.push(m?.display_name || (isPT ? "alguém" : "someone"));
        }
      }

      let body: string;
      const callerPronouns = memberMap.get(callerId)?.pronouns || "they/them";
      
      if (doerNames.length === 0) {
        // Only the caller did it
        body = isPT 
          ? `${callerName} marcou a tarefa ${choreName} como concluída!`
          : `${callerName} marked ${choreName} as done!`;
      } else if (doerNames.length === 1 && doerNames[0] === (isPT ? "ti" : "you")) {
        // Caller + recipient did it together
        body = isPT
          ? `${callerName} marcou a tarefa ${choreName} como concluída por ${pronounObjPT(callerPronouns)} e ti!`
          : `${callerName} marked ${choreName} as done by ${pronounObjEN(callerPronouns)} and you!`;
      } else {
        // Multiple people, build natural list
        const allNames = [isPT ? pronounObjPT(callerPronouns) : pronounObjEN(callerPronouns), ...doerNames];
        body = isPT
          ? `${callerName} marcou a tarefa ${choreName} como concluída por ${joinNamesPT(allNames)}!`
          : `${callerName} marked ${choreName} as done by ${joinNamesEN(allNames)}!`;
      }

      await sendPush(supabase, [recipientId], choreName, body, { type: "chore_done", eventId });
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
