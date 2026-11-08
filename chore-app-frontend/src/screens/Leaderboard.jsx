import React, { useEffect, useState } from "react";
import { Trophy, Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { ErrorBanner, IconGlyph } from "../components/UI";


function getBounds(range) {
  const now = new Date();
  let since, until;
  if (range === "week") {
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    since = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    until = sunday.toISOString().slice(0, 10);
  } else if (range === "month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    since = firstDay.toISOString().slice(0, 10);
    until = lastDay.toISOString().slice(0, 10);
  } else if (range === "year") {
    const firstDay = new Date(now.getFullYear(), 0, 1);
    const lastDay = new Date(now.getFullYear(), 11, 31);
    since = firstDay.toISOString().slice(0, 10);
    until = lastDay.toISOString().slice(0, 10);
  }
  return { since, until };
}

export default function Leaderboard({ groupId, onSelectPerson, rewardsEnabled, currentMembership }) {
  const { t, i18n } = useTranslation();
  
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStr = `Week ${monday.getDate().toString().padStart(2, "0")}/${(monday.getMonth()+1).toString().padStart(2, "0")} - ${sunday.getDate().toString().padStart(2, "0")}/${(sunday.getMonth()+1).toString().padStart(2, "0")}`;
    const monthStr = now.toLocaleString(i18n.language, { month: "long" });
    const yearStr = now.getFullYear().toString();

    const RANGES = [
      { id: "week", label: weekStr, prizeKey: "weekly_leaderboard_prize_coins" },
      { id: "month", label: monthStr.charAt(0).toUpperCase() + monthStr.slice(1), prizeKey: "monthly_leaderboard_prize_coins" },
      { id: "year", label: yearStr, prizeKey: "yearly_leaderboard_prize_coins" },
    ];

  const [range, setRange] = useState("month");
  const [rows, setRows] = useState([]);
  const [coinBalances, setCoinBalances] = useState({});
  const [error, setError] = useState("");

  const currentPrizeAmount = currentMembership?.groups?.[RANGES.find(r => r.id === range)?.prizeKey];

  useEffect(() => {
    if (!groupId) return;
    
      const { since, until } = getBounds(range);
      supabase
        .rpc("get_leaderboard", { p_group_id: groupId, p_since: since, p_until: until }
)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows(data || []);
      });
  }, [groupId, range]);

  // Fetch coin balances for all members (only when rewards are enabled)
  useEffect(() => {
    if (!groupId || !rewardsEnabled) return;
    supabase
      .from("memberships")
      .select("user_id, coin_balance")
      .eq("group_id", groupId)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((m) => { map[m.user_id] = m.coin_balance ?? 0; });
        setCoinBalances(map);
      });
  }, [groupId, rewardsEnabled]);

  const max = Math.max(1, ...rows.map((r) => Number(r.points)));

  return (
    <div className="flex flex-col gap-4 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />
      <div className="flex gap-2 flex-wrap">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`app-btn px-3 py-1.5 text-sm ${range === r.id ? "app-accent-bg" : "app-card"}`}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      
      {rewardsEnabled && currentPrizeAmount > 0 && (
        <div className="app-card app-radius p-3 text-sm text-center flex items-center justify-center gap-2">
          <span>{t("Prize for topping this leaderboard:")}</span>
          <span className="font-bold text-yellow-500">🪙 {currentPrizeAmount}</span>
        </div>
      )}

      <div className="app-card app-radius p-4 flex flex-col gap-3">
        {rows.length === 0 && <div className="text-sm app-muted">{t("No completions in this range yet.")}</div>}
        {rows.map((r, i) => (
          <button
            key={r.user_id}
            className="flex items-center gap-3 text-left"
            onClick={() => onSelectPerson?.(r.user_id, r.display_name)}
          >
            <span className="text-sm font-semibold w-5 app-muted">{i + 1}</span>
            {i === 0 && Number(r.points) > 0 ? <Trophy size={16} className="app-accent-text" /> : <span className="w-4" />}
            <IconGlyph icon={r.avatar_url} fallback="👤" size={22} />
            <span className="text-sm flex-1">{r.display_name}</span>
            <div className="flex-1 max-w-[40%] h-2 rounded-full app-card overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-full app-accent-bg"
                style={{ width: `${(Number(r.points) / max) * 100}%`, borderRadius: "9999px" }}
              />
            </div>
            <span className="text-sm font-semibold w-8 text-right">{r.points}</span>
            {rewardsEnabled && coinBalances[r.user_id] != null && (
              <span className="text-xs app-muted flex items-center gap-0.5 w-12 justify-end" title={t("Coins")}>
                🪙 {coinBalances[r.user_id]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
