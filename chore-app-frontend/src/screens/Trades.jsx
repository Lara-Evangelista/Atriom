import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { notifyHousehold } from "../lib/notify";
import { ErrorBanner, StatusChip, IconGlyph, isIconPhotoPath } from "../components/UI";

export default function Trades({ user, groupId, roster, prefillEvent, onClearPrefill }) {
  const { t } = useTranslation();
  const [myEvents, setMyEvents] = useState([]);
  const [fromEventId, setFromEventId] = useState(prefillEvent?.id || "");
  const [candidates, setCandidates] = useState([]);
  const [toEventId, setToEventId] = useState("");
  const [pendingTrades, setPendingTrades] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const nameFor = (uid) => roster.find((m) => m.user_id === uid)?.display_name || t("Someone");

  const loadMyEvents = useCallback(async () => {
    if (!groupId || !user) return;
    const { data } = await supabase
      .from("chore_events")
      .select("id, date, chore_type_id, assigned_user_id, chore_types(name, icon, has_schedule)")
      .eq("group_id", groupId)
      .eq("assigned_user_id", user.id)
      .eq("status", "pending")
      .order("date");
    setMyEvents((data || []).filter((e) => e.chore_types?.has_schedule));
  }, [groupId, user]);

  const loadTrades = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from("trades")
      .select(
        "id, status, from_user_id, to_user_id, created_at, from_event:from_event_id(id,date,chore_types(name,icon)), to_event:to_event_id(id,date,chore_types(name,icon))"
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(30);
    setPendingTrades(data || []);
  }, [groupId]);

  useEffect(() => {
    loadMyEvents();
    loadTrades();
    const ch = supabase
      .channel(`trades-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: `group_id=eq.${groupId}` }, loadTrades)
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_events", filter: `group_id=eq.${groupId}` }, loadMyEvents)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadMyEvents, loadTrades, groupId]);

  useEffect(() => {
    if (prefillEvent?.id) {
      setFromEventId(prefillEvent.id);
      onClearPrefill?.();
    }
  }, [prefillEvent, onClearPrefill]);

  useEffect(() => {
    async function loadCandidates() {
      if (!fromEventId) {
        setCandidates([]);
        return;
      }
      const chosen = myEvents.find((e) => e.id === fromEventId) || prefillEvent;
      if (!chosen) return;
      const { data } = await supabase
        .from("chore_events")
        .select("id, date, assigned_user_id, chore_types(name, icon)")
        .eq("chore_type_id", chosen.chore_type_id)
        .eq("status", "pending")
        .neq("assigned_user_id", user.id)
        .order("date");
      setCandidates(data || []);
    }
    loadCandidates();
  }, [fromEventId, myEvents, prefillEvent, user]);

  async function proposeTrade(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("request_trade", {
        p_from_event_id: fromEventId,
        p_to_event_id: toEventId,
      });
      if (error) throw error;
      const offered = myEvents.find((event) => event.id === fromEventId);
      const requested = candidates.find((event) => event.id === toEventId);
      if (requested?.assigned_user_id) {
        notifyHousehold(
          [requested.assigned_user_id],
          groupId,
          "Trade request",
          `${offered?.chore_types?.name || "A chore"} has been offered in exchange for your turn.`,
          { type: "trade", tradeId: data }
        ).catch(() => {});
      }
      setNotice(t("Swap proposed."));
      setFromEventId("");
      setToEventId("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function respond(tradeId, accept) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("respond_trade", { p_trade_id: tradeId, p_accept: accept });
      if (error) throw error;
      const trade = pendingTrades.find((item) => item.id === tradeId);
      if (trade?.from_user_id) {
        notifyHousehold(
          [trade.from_user_id],
          groupId,
          accept ? "Trade accepted" : "Trade declined",
          accept ? "Your chore swap was accepted." : "Your chore swap was declined.",
          { type: "trade", tradeId }
        ).catch(() => {});
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const incoming = pendingTrades.filter((trade) => trade.status === "pending" && trade.to_user_id === user.id);
  const outgoing = pendingTrades.filter((trade) => trade.status === "pending" && trade.from_user_id === user.id);
  const history = pendingTrades.filter((trade) => trade.status !== "pending");

  return (
    <div className="flex flex-col gap-6 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />

      <div>
        <h3 className="text-sm font-semibold app-muted mb-2">{t("Propose a swap")}</h3>
        <form onSubmit={proposeTrade} className="app-card app-radius p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium app-muted">{t("Your turn to give up")}</label>
            <select className="app-input mt-1" value={fromEventId} onChange={(e) => setFromEventId(e.target.value)} required>
              <option value="">{t("Pick one of your turns…")}</option>
              {myEvents.map((e) => (
                <option key={e.id} value={e.id}>
                  {isIconPhotoPath(e.chore_types?.icon) ? "" : e.chore_types?.icon} {e.chore_types?.name} — {e.date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium app-muted">{t("Swap for")}</label>
            <select className="app-input mt-1" value={toEventId} onChange={(e) => setToEventId(e.target.value)} required disabled={!fromEventId}>
              <option value="">{t("Pick their turn…")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameFor(c.assigned_user_id)} — {c.date}
                </option>
              ))}
            </select>
          </div>
          {notice && <div className="text-sm app-chip-good app-radius px-3 py-2">{notice}</div>}
          <button className="app-btn app-accent-bg py-2.5" disabled={busy || !fromEventId || !toEventId} type="submit">
            <ArrowLeftRight size={14} className="inline mr-1" /> {t("Propose swap")}
          </button>
        </form>
      </div>

      <Section title={t("Waiting on your response")} items={incoming}>
        {(trade) => (
          <div key={trade.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
            <TradeSummary trade={trade} nameFor={nameFor} />
            <div className="flex gap-1.5 shrink-0">
              <button className="app-btn app-accent-bg p-1.5" disabled={busy} onClick={() => respond(trade.id, true)}>
                <Check size={14} />
              </button>
              <button className="app-btn app-card p-1.5" disabled={busy} onClick={() => respond(trade.id, false)}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t("You proposed")} items={outgoing}>
        {(trade) => (
          <div key={trade.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
            <TradeSummary trade={trade} nameFor={nameFor} />
            <StatusChip status="pending" />
          </div>
        )}
      </Section>

      <Section title={t("History")} items={history}>
        {(trade) => (
          <div key={trade.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
            <TradeSummary trade={trade} nameFor={nameFor} />
            <StatusChip status={trade.status} />
          </div>
        )}
      </Section>
    </div>
  );
}

function TradeSummary({ trade, nameFor }) {
  return (
    <div className="text-sm">
      <span className="font-medium">{nameFor(trade.from_user_id)}</span>'s {trade.from_event?.chore_types?.name} ({trade.from_event?.date}) ↔{" "}
      <span className="font-medium">{nameFor(trade.to_user_id)}</span>'s {trade.to_event?.chore_types?.name} ({trade.to_event?.date})
    </div>
  );
}

function Section({ title, items, children }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{title}</h3>
      <div className="flex flex-col gap-2">{items.map(children)}</div>
    </div>
  );
}
