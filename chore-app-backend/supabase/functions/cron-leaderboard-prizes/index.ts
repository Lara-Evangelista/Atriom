// supabase/functions/cron-leaderboard-prizes/index.ts
//
// Designed to run once a day via Supabase Cron (any time works -- the RPC
// below is idempotent, see notes).
//
// award_leaderboard_prizes(period_type), added in migration 032, is a
// security-definer function granted only to service_role: it iterates every
// group itself, works out "the most recently completed" week/month/year for
// that period type, and pays out coins to whoever topped that period's
// leaderboard -- but only if the group has set a coin amount > 0 for that
// period (see Settings -> Leaderboard Prizes, admin-only) and only once per
// (group, period_type, period_start), enforced by a unique constraint on
// leaderboard_prize_log. That means it's safe to call all three period
// types every single day: on every day except the one right after a period
// closes, the award is a no-op because it's already been logged. This
// function does no per-group work itself -- it only calls the RPC three
// times and reports what happened.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PERIOD_TYPES = ["weekly", "monthly", "yearly"] as const;

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const results: Record<string, { ok: boolean; error?: string }> = {};

  for (const periodType of PERIOD_TYPES) {
    const { error } = await supabase.rpc("award_leaderboard_prizes", {
      p_period_type: periodType,
    });
    if (error) {
      console.error(`cron-leaderboard-prizes (${periodType}) error:`, error);
      results[periodType] = { ok: false, error: error.message };
    } else {
      results[periodType] = { ok: true };
    }
  }

  const allOk = PERIOD_TYPES.every((p) => results[p].ok);
  return new Response(JSON.stringify({ ok: allOk, results }), {
    status: allOk ? 200 : 500,
  });
});
