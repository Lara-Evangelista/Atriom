// supabase/functions/notify-nudge/index.ts
//
// Called by the client after nudging an assignee.
// The client has already called the `nudge_assignee` RPC which validates
// permissions and the 5-minute cooldown. This function just sends the push.
//
// POST body: { eventId: string, nudgeeId: string }

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { eventId, nudgeeId } = await req.json();
    if (!eventId || !nudgeeId) {
      return new Response(JSON.stringify({ ok: false, error: "eventId and nudgeeId are required" }), { status: 400, headers: corsHeaders });
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

    // Get caller's display name
    const { data: callerMembership } = await supabase
      .from("memberships")
      .select("display_name")
      .eq("group_id", event.group_id)
      .eq("user_id", callerId)
      .single();

    const callerName = callerMembership?.display_name || (isPT ? "Alguém" : "Someone");

    const body = isPT
      ? `Olá! ${callerName} está a dar-te um toque para fazeres a tarefa ${choreName}. 👋`
      : `Hey! ${callerName} is gently nudging you to do the ${choreName}. 👋`;

    const title = isPT ? `Toque: ${choreName}` : `Nudge: ${choreName}`;

    const sent = await sendPush(supabase, [nudgeeId], title, body, { type: "nudge", eventId });

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
