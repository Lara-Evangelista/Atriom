import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { PhotoThumb, ErrorBanner, IconPicker, IconGlyph } from "../components/UI";
import { useTranslation } from "react-i18next";

export default function You({ user, groupId, roster, viewing, onClearViewing, currentMembership, onSelectPerson }) {
  const { t, i18n } = useTranslation();
  const viewingUserId = viewing?.userId || user.id;
  const viewingName = viewing?.name || currentMembership?.display_name || t("You");
  const isSelf = viewingUserId === user.id;

  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!groupId || !viewingUserId) return;
    supabase
      .rpc("get_member_history", { p_group_id: groupId, p_user_id: viewingUserId })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setHistory(data || []);
      });
  }, [groupId, viewingUserId]);

  return (
    <div className="flex flex-col gap-5 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />

      {!isSelf && (
        <div className="flex items-center justify-between">
          <button className="app-btn app-card px-3 py-1.5 text-sm" onClick={onClearViewing}>
            {t("Back")}
          </button>
        </div>
      )}

      <HistorySection history={history} isSelf={isSelf} viewingName={viewingName} t={t} />

      {isSelf && (
        <>
          <PersonalSettingsSection groupId={groupId} current={currentMembership} t={t} i18n={i18n} />
          {roster && <RosterSection groupId={groupId} roster={roster} currentMembership={currentMembership} t={t} onSelectPerson={onSelectPerson} />}
        </>
      )}
    </div>
  );
}

function PersonalSettingsSection({ groupId, current, t, i18n }) {
  const prefs = current?.notification_preferences || { daily_chores: true, timers: true, supermarket: true };
  const [name, setName] = useState(current?.display_name || "");
  const [avatar, setAvatar] = useState(current?.avatar_url || "");
  const [pronouns, setPronouns] = useState(current?.pronouns || "they/them");
  const [hour, setHour] = useState(String(current?.notification_hour ?? 9));
  const [daily, setDaily] = useState(prefs.daily_chores ?? true);
  const [timers, setTimers] = useState(prefs.timers ?? true);
  const [supermarket, setSupermarket] = useState(prefs.supermarket ?? true);
  const [isPaused, setIsPaused] = useState(current?.is_paused ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Keep local fields in sync whenever the membership record loads/changes
  // (e.g. it can arrive a moment after this screen first mounts, or update
  // after a save elsewhere). Without this, the form could get stuck showing
  // stale/empty values even though the real record has a name.
  useEffect(() => {
    if (!current) return;
    setName(current.display_name || "");
    setAvatar(current.avatar_url || "");
    setPronouns(current.pronouns || "they/them");
    setHour(String(current.notification_hour ?? 9));
    const p = current.notification_preferences || {};
    setDaily(p.daily_chores ?? true);
    setTimers(p.timers ?? true);
    setSupermarket(p.supermarket ?? true);
    setIsPaused(current.is_paused ?? false);
  }, [current]);

  const save = async () => {
    if (!current?.group_id) {
      setError(t("Still loading your household — try again in a moment."));
      return;
    }
    setBusy(true); setNotice(""); setError("");
    try {
      const hr = parseInt(hour, 10);
      const { error } = await supabase.rpc("update_personal_settings", {
        p_group_id: current.group_id,
        p_display_name: name.trim(),
        p_avatar_url: avatar,
        p_notification_hour: isNaN(hr) ? 9 : hr,
        p_notification_preferences: { daily_chores: daily, timers, supermarket },
        p_pronouns: pronouns,
        p_is_paused: isPaused,
      });
      if (error) throw error;
      setNotice(t("Saved.")); setTimeout(() => setNotice(""), 2000);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      // Always clears, even if the request throws before it ever reaches
      // the network (e.g. missing group id) — this is what was making the
      // button get stuck on "Saving..." forever.
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t("Personal Settings")}</h3>
      <div className="app-card app-radius p-4 flex flex-col gap-4">
        <ErrorBanner error={error} onClose={() => setError("")} />
        {notice && <div className="text-sm text-green-500">{notice}</div>}
        <div>
          <label className="text-xs app-muted block mb-1">{t("Your Display Name")}</label>
          <input className="app-input w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t("Avatar (emoji or photo)")}</label>
          <IconPicker value={avatar} onChange={setAvatar} groupId={groupId} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t("Pronouns")}</label>
          <select className="app-input w-full bg-transparent" value={pronouns} onChange={e => setPronouns(e.target.value)}>
            <option value="they/them">{t("They/Them")}</option>
            <option value="she/her">{t("She/Her")}</option>
            <option value="he/him">{t("He/Him")}</option>
          </select>
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t("App Language")}</label>
          <select className="app-input w-full bg-transparent" value={i18n.language} onChange={e => i18n.changeLanguage(e.target.value)}>
            <option value="en">{t("English")}</option>
            <option value="pt-PT">{t("Portuguese")}</option>
          </select>
        </div>
        <h4 className="text-xs font-semibold mt-2">{t("Notification Preferences")}</h4>
        <div>
          <label className="text-xs app-muted block mb-1">{t("Daily Summary Hour (0-23)")}</label>
          <input className="app-input w-full" type="number" min="0" max="23" value={hour} onChange={e => setHour(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} /> {t("Daily Chores")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timers} onChange={e => setTimers(e.target.checked)} /> {t("Timers & Rotations")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supermarket} onChange={e => setSupermarket(e.target.checked)} /> {t("Supermarket Radar")}</label>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{t("Vacation Mode")}</div>
            <div className="text-xs app-muted">{t("Skip your turn in all rotations while paused.")}</div>
          </div>
          <button className={`app-btn p-2 text-xs ${isPaused ? "app-chip-danger" : "app-card"}`} onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? t("Paused") : t("Active")}
          </button>
        </div>
        <button className="app-btn app-accent-bg py-2 mt-2" onClick={save} disabled={busy || !name.trim()}>
          {busy ? t("Saving...") : t("Save Personal Settings")}
        </button>
      </div>
    </div>
  );
}

function HistorySection({ history, isSelf, viewingName, t }) {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState("today");

  const now = Date.now();
  const cutoffs = {
    today: new Date(new Date().setHours(0,0,0,0)).getTime(),
    week: now - 7 * 24 * 60 * 60 * 1000,
    month: now - 30 * 24 * 60 * 60 * 1000,
    lastyear: now - 365 * 24 * 60 * 60 * 1000,
    year: new Date(new Date().getFullYear(), 0, 1).getTime(),
  };

  const recent = history.slice(0, 5);
  // Cap the expanded list to 15 items so it doesn't become "wayyy too long"
  const filtered = expanded ? history.filter((h) => new Date(h.done_at).getTime() >= cutoffs[period]).slice(0, 15) : recent;

  const PERIODS = [
    ["today", t("Today")],
    ["week", t("This week")],
    ["month", t("This month")],
    ["year", t("This year")],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{isSelf ? t("Your history") : t("{{name}}'s history", { name: viewingName })}</h2>
      </div>

      {expanded && (
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              className={`app-btn px-3 py-1.5 text-xs ${period === key ? "app-accent-bg" : "app-card"}`}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.length === 0 && <div className="text-sm app-muted app-card app-radius p-3">{t("Nothing completed yet.")}</div>}
        {filtered.map((h, i) => (
          <div key={i} className="app-card app-radius p-3 flex items-center gap-3">
            <span className="text-lg app-emoji"><IconGlyph icon={h.icon} fallback={h.kind === "cycle" ? "⏱️" : "📋"} /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{h.name}</div>
              <div className="text-xs app-muted">{new Date(h.done_at).toLocaleString()}</div>
            </div>
            {h.photo_url && <PhotoThumb path={h.photo_url} />}
          </div>
        ))}
        {expanded && history.filter((h) => new Date(h.done_at).getTime() >= cutoffs[period]).length > 15 && (
          <div className="text-xs text-center app-muted mt-2">{t("Showing the 15 most recent items.")}</div>
        )}
      </div>

      {!expanded && history.length > 5 && (
        <button className="app-btn app-card py-2 text-sm" onClick={() => { setExpanded(true); setPeriod("week"); }}>
          {t("See more")}
        </button>
      )}
      {expanded && (
        <button className="app-btn app-card py-2 text-sm" onClick={() => { setExpanded(false); }}>
          {t("Show less")}
        </button>
      )}
    </div>
  );
}

function RosterSection({ groupId, roster, currentMembership, t, onSelectPerson }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = currentMembership?.role === "owner";

  const toggleRole = async (userId, currentRole) => {
    const newRole = currentRole === "admin" ? "member" : "admin";
    setBusy(true); setError("");
    try {
      const { error } = await supabase.rpc("set_member_role", { p_group_id: groupId, p_target_user_id: userId, p_new_role: newRole });
      if (error) throw error;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner error={error} onClose={() => setError("")} />
      <h3 className="text-sm font-semibold app-muted mb-2">{t("Household roster")}</h3>
      <div className="flex flex-col gap-1.5">
        {(roster || []).map((m) => {
          const isMe = m.user_id === currentMembership?.user_id;
          return (
            <div key={m.user_id} className="text-sm flex justify-between items-center app-card app-radius px-3 py-2">
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 text-left"
                onClick={() => !isMe && onSelectPerson?.(m.user_id, m.display_name)}
                disabled={isMe}
              >
                <IconGlyph icon={m.avatar_url} fallback="👤" size={24} />
                <span className="font-medium truncate">{m.display_name}</span>
                {isMe && <span className="text-xs app-muted ml-1 shrink-0">({t("You")})</span>}
                <span className="text-xs app-muted ml-2 capitalize shrink-0">{m.role}</span>
              </button>
              {isOwner && m.role !== "owner" && (
                <button
                  className={`app-btn px-2 py-1 text-xs shrink-0 ${m.role === "admin" ? "app-card" : "app-accent-bg"}`}
                  disabled={busy}
                  onClick={() => toggleRole(m.user_id, m.role)}
                >
                  {m.role === "admin" ? t("Remove Admin") : t("Make Admin")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
