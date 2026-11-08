// supabase/functions/notify/index.ts
//
// Called by the app right after it writes something (a trade request, a
// completion, a stock item going out) so the relevant people get pushed
// immediately, even if their app/tab is closed.
//
// POST body: { userIds: string[], title: string, body: string, data?: object }
// userIds are Supabase auth user ids (accounts), not per-group names.
//
// Sends via Expo Push API to mobile devices.

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
    const { userIds, groupId, title, body, data } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !groupId) {
      return new Response(JSON.stringify({ ok: false, error: "userIds and groupId are required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return new Response(JSON.stringify({ ok: false, error: "Authorization is required" }), { status: 401, headers: corsHeaders });

    const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: members, error: memberError } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("group_id", groupId)
      .in("user_id", [...new Set([...userIds, authData.user.id])]);
    const memberIds = new Set((members || []).map((member) => member.user_id));
    if (memberError || !memberIds.has(authData.user.id) || userIds.some((userId: string) => !memberIds.has(userId))) {
      return new Response(JSON.stringify({ ok: false, error: "Recipients must belong to your household" }), { status: 403, headers: corsHeaders });
    }
    const sent = await sendPush(supabase, userIds, title, body, data || {});

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
