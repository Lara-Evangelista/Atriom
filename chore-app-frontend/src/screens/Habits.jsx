import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Flame, Plus, Settings as SettingsIcon, X, History, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { ErrorBanner, EmptyState, IconGlyph, IconPicker } from "../components/UI";

// Habits are personal — not scoped to any group. Every RPC here reads
// auth.uid() server-side, so no groupId is ever passed.

const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayLocalISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export default function Habits() {
  const { t } = useTranslation();
  const [habits, setHabits] = useState([]);
  const [settings, setSettings] = useState({ week_end_day: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // habit object, or {} for new
  const [historyFor, setHistoryFor] = useState(null); // habit object
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const [{ data: h, error: hErr }, { data: s }] = await Promise.all([
      supabase.from("habit_summaries").select("*").eq("archived", false).order("sort_order").order("created_at"),
      supabase.from("user_settings").select("*").maybeSingle(),
    ]);
    if (hErr) setError(hErr.message);
    setHabits(h || []);
    if (s) setSettings(s);
  }, []);

  useEffect(() => {
    load();
    // Keep the server's idea of "where you are" fresh, silently, so
    // notification-hour math (done server-side) uses the right timezone.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) supabase.rpc("touch_my_timezone", { p_timezone: tz });
    } catch {
      /* Intl not available — server falls back to UTC */
    }

    const ch = supabase
      .channel("habits-own")
      .on("postgres_changes", { event: "*", schema: "public", table: "habits" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "habit_completions" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  async function toggleToday(habit) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("toggle_habit_today", {
        p_habit_id: habit.id,
        p_local_date: todayLocalISO(),
      });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function archiveHabit(habit) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("archive_habit", { p_habit_id: habit.id, p_archived: true });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t("Habits")}</h2>
        <div className="flex gap-2">
          <button className="app-btn app-card p-2" onClick={() => setShowSettings(true)} title={t("Habit settings")}>
            <SettingsIcon size={16} />
          </button>
          <button className="app-btn app-accent-bg p-2" onClick={() => setEditing({})} title={t("New habit")}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {habits.length === 0 ? (
        <EmptyState>{t("No habits yet — add one you want to build.")}</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {habits.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              busy={busy}
              t={t}
              onToggle={() => toggleToday(h)}
              onEdit={() => setEditing(h)}
              onHistory={() => setHistoryFor(h)}
              onArchive={() => archiveHabit(h)}
            />
          ))}
        </div>
      )}

      {editing && (
        <HabitEditor
          habit={editing}
          t={t}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {historyFor && (
        <HabitHistory habit={historyFor} t={t} onClose={() => setHistoryFor(null)} />
      )}

      {showSettings && (
        <HabitSettings
          settings={settings}
          t={t}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function HabitRow({ habit, busy, t, onToggle, onEdit, onHistory, onArchive }) {
  const isWeekly = habit.frequency === "weekly";
  const remaining = isWeekly ? Math.max(0, habit.weekly_target - (habit.this_week_count || 0)) : null;
  const isDone = isWeekly ? (habit.this_week_count || 0) >= habit.weekly_target : habit.done_today;

  // Once the weekly target is met, further clicks are blocked (nothing
  // left to log this week) — except undoing *today's own* completion,
  // which is always allowed.
  const canClick = habit.done_today || !isWeekly || (habit.this_week_count || 0) < habit.weekly_target;

  return (
    <div className={`app-card app-radius p-3 flex items-center gap-3 transition ${isDone ? "opacity-50" : ""}`}>
      <IconGlyph icon={habit.icon} fallback="✅" size={26} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate ${isDone ? "line-through" : ""}`}>{habit.name}</div>
        <div className="text-xs app-muted">
          {isWeekly ? t("{{count}}x / week", { count: habit.weekly_target }) : t("Daily")}
        </div>
      </div>

      {habit.current_streak > 0 && (
        <div className="flex items-center gap-0.5 text-xs font-semibold app-chip-warn px-1.5 py-0.5 rounded-full">
          <Flame size={13} />
          {habit.current_streak}
        </div>
      )}

      {isWeekly && !isDone && (
        <div className="text-sm font-semibold app-muted w-5 text-center">{remaining}</div>
      )}

      <button
        className="app-btn p-1.5"
        onClick={onHistory}
        title={t("History")}
      >
        <History size={15} />
      </button>
      <button className="app-btn p-1.5" onClick={onEdit} title={t("Edit")}>
        <Pencil size={15} />
      </button>
      <button
        className="app-btn p-2 rounded-full"
        style={{
          background: isDone ? "var(--accent)" : "var(--surface)",
          border: "1.5px solid var(--border)",
        }}
        disabled={busy || !canClick}
        onClick={onToggle}
        title={isDone ? t("Undo") : t("Mark done")}
      >
        <Check size={16} color={isDone ? "var(--accent-ink)" : undefined} />
      </button>
      <button className="app-btn p-1.5 app-muted" onClick={onArchive} title={t("Archive")}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function HabitEditor({ habit, t, onClose, onSaved }) {
  const isNew = !habit.id;
  const [name, setName] = useState(habit.name || "");
  const [icon, setIcon] = useState(habit.icon || "");
  const [frequency, setFrequency] = useState(habit.frequency || "daily");
  const [weeklyTarget, setWeeklyTarget] = useState(habit.weekly_target || 3);
  const [notificationsEnabled, setNotificationsEnabled] = useState(habit.notifications_enabled ?? true);
  // reminders: [{ day_of_week: number|null, time_local: "HH:MM" }]
  const [reminders, setReminders] = useState([]);
  // Daily habits only: a single shared time (day_of_week: null) vs one
  // time per day of the week. Weekly habits always use the per-day form.
  const [dailyMode, setDailyMode] = useState("same");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isNew) {
      supabase
        .from("habit_reminders")
        .select("*")
        .eq("habit_id", habit.id)
        .then(({ data }) => {
          const loaded = (data || []).map((r) => ({ day_of_week: r.day_of_week, time_local: r.time_local?.slice(0, 5) || "09:00" }));
          setReminders(loaded);
          if (habit.frequency === "daily" && loaded.some((r) => r.day_of_week !== null)) {
            setDailyMode("different");
          }
        });
    }
  }, [habit.id, isNew, habit.frequency]);

  function toggleDay(dow) {
    setReminders((rs) => {
      const has = rs.find((r) => r.day_of_week === dow);
      if (has) return rs.filter((r) => r.day_of_week !== dow);
      return [...rs, { day_of_week: dow, time_local: "09:00" }];
    });
  }

  function setDayTime(dow, time) {
    setReminders((rs) => rs.map((r) => (r.day_of_week === dow ? { ...r, time_local: time } : r)));
  }

  // Daily habit, "different time per day": every day of the week gets its
  // own reminder (it's a daily habit, so it always fires — this only
  // controls what hour it fires at on each day).
  function switchDailyMode(next) {
    setDailyMode(next);
    if (next === "same") {
      const t = reminders.find((r) => r.day_of_week !== null)?.time_local || "09:00";
      setReminders([{ day_of_week: null, time_local: t }]);
    } else {
      const existingByDay = Object.fromEntries(reminders.map((r) => [r.day_of_week, r.time_local]));
      const sharedTime = reminders.find((r) => r.day_of_week === null)?.time_local || "09:00";
      setReminders(DAY_LABELS_SHORT.map((_, dow) => ({ day_of_week: dow, time_local: existingByDay[dow] || sharedTime })));
    }
  }

  const dailyReminder = reminders.find((r) => r.day_of_week === null);
  const weeklyReminderDayCount = reminders.filter((r) => r.day_of_week !== null).length;
  const weeklyDayCountMismatch =
    frequency === "weekly" && weeklyReminderDayCount > 0 && Number(weeklyTarget) > 0 && weeklyReminderDayCount !== Number(weeklyTarget);

  async function save() {
    setBusy(true);
    setError("");
    try {
      let habitId = habit.id;
      if (isNew) {
        const { data, error } = await supabase.rpc("create_habit", {
          p_name: name.trim(),
          p_icon: icon || null,
          p_frequency: frequency,
          p_weekly_target: frequency === "weekly" ? Number(weeklyTarget) : null,
          p_notifications_enabled: notificationsEnabled,
        });
        if (error) throw error;
        habitId = data;
      } else {
        const { error } = await supabase.rpc("update_habit", {
          p_habit_id: habit.id,
          p_name: name.trim(),
          p_icon: icon || null,
          p_weekly_target: frequency === "weekly" ? Number(weeklyTarget) : null,
          p_notifications_enabled: notificationsEnabled,
        });
        if (error) throw error;
      }

      const { error: remErr } = await supabase.rpc("set_habit_reminders", {
        p_habit_id: habitId,
        p_reminders: reminders,
      });
      if (remErr) throw remErr;

      await onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="app-surface app-radius p-4 w-full max-w-md flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-bold">{isNew ? t("New habit") : t("Edit habit")}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <ErrorBanner error={error} onClose={() => setError("")} />

        <div>
          <label className="text-xs app-muted">{t("Name")}</label>
          <input className="app-input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Read, Stretch, Call mom")} />
        </div>

        <div>
          <label className="text-xs app-muted">{t("Icon")}</label>
          <div className="mt-1"><IconPicker value={icon} onChange={setIcon} groupId={null} /></div>
        </div>

        {isNew && (
          <div className="flex gap-2">
            {["daily", "weekly"].map((f) => (
              <button
                key={f}
                type="button"
                className="app-btn flex-1 py-2 text-sm"
                style={{
                  background: frequency === f ? "var(--accent)" : "var(--surface)",
                  color: frequency === f ? "var(--accent-ink)" : "var(--ink)",
                  border: "1.5px solid var(--border)",
                }}
                onClick={() => setFrequency(f)}
              >
                {f === "daily" ? t("Every day") : t("X times a week")}
              </button>
            ))}
          </div>
        )}

        {frequency === "weekly" && (
          <div>
            <label className="text-xs app-muted">{t("Times per week")}</label>
            <input
              className="app-input mt-1 w-24"
              type="number"
              min={1}
              max={7}
              value={weeklyTarget}
              onChange={(e) => setWeeklyTarget(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="text-sm">{t("Notifications for this habit")}</label>
          <input type="checkbox" checked={notificationsEnabled} onChange={(e) => setNotificationsEnabled(e.target.checked)} />
        </div>

        {notificationsEnabled && (
          <div>
            <label className="text-xs app-muted mb-1 block">
              {frequency === "daily" ? t("Reminder time") : t("Remind me on")}
            </label>

            {frequency === "daily" ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  {[
                    ["same", t("Same time every day")],
                    ["different", t("Different time per day")],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className="app-btn flex-1 py-1.5 text-xs"
                      style={{
                        background: dailyMode === key ? "var(--accent)" : "var(--surface)",
                        color: dailyMode === key ? "var(--accent-ink)" : "var(--ink)",
                        border: "1.5px solid var(--border)",
                      }}
                      onClick={() => switchDailyMode(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {dailyMode === "same" ? (
                  <input
                    className="app-input w-32"
                    type="time"
                    value={dailyReminder?.time_local || "09:00"}
                    onChange={(e) => setReminders([{ day_of_week: null, time_local: e.target.value }])}
                  />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {DAY_LABELS_SHORT.map((lbl, dow) => (
                      <div key={dow} className="flex items-center gap-2 text-sm">
                        <span className="w-10 app-muted">{t(lbl)}</span>
                        <input
                          className="app-input w-28"
                          type="time"
                          value={reminders.find((r) => r.day_of_week === dow)?.time_local || "09:00"}
                          onChange={(e) => setDayTime(dow, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-1 flex-wrap">
                  {DAY_LABELS_SHORT.map((lbl, dow) => {
                    const on = reminders.some((r) => r.day_of_week === dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        className="app-btn w-10 h-9 text-xs"
                        style={{
                          background: on ? "var(--accent)" : "var(--surface)",
                          color: on ? "var(--accent-ink)" : "var(--ink)",
                          border: "1.5px solid var(--border)",
                        }}
                        onClick={() => toggleDay(dow)}
                      >
                        {t(lbl)}
                      </button>
                    );
                  })}
                </div>
                {reminders
                  .filter((r) => r.day_of_week !== null)
                  .sort((a, b) => a.day_of_week - b.day_of_week)
                  .map((r) => (
                    <div key={r.day_of_week} className="flex items-center gap-2 text-sm">
                      <span className="w-10 app-muted">{t(DAY_LABELS_SHORT[r.day_of_week])}</span>
                      <input
                        className="app-input w-28"
                        type="time"
                        value={r.time_local}
                        onChange={(e) => setDayTime(r.day_of_week, e.target.value)}
                      />
                    </div>
                  ))}
                {weeklyDayCountMismatch && (
                  <p className="text-xs app-chip-warn rounded-md px-2 py-1.5 mt-1">
                    {t("You've set this habit to {{target}}x a week but picked {{days}} reminder day(s) — just making sure that's not an accident.", {
                      target: weeklyTarget,
                      days: weeklyReminderDayCount,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy || !name.trim()} onClick={save}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

function HabitHistory({ habit, t, onClose }) {
  const [range, setRange] = useState("week");
  const [dates, setDates] = useState([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    const from = new Date(today);
    if (range === "week") from.setDate(from.getDate() - 7);
    else if (range === "month") from.setMonth(from.getMonth() - 1);
    else from.setFullYear(from.getFullYear() - 1);
    return { from: from.toISOString().slice(0, 10), to: toStr };
  }, [range]);

  useEffect(() => {
    setLoading(true);
    supabase
      .rpc("get_habit_history", { p_habit_id: habit.id, p_from: from, p_to: to })
      .then(({ data }) => {
        setDates((data || []).map((r) => r.completed_date));
        setLoading(false);
      });
  }, [habit.id, from, to]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="app-surface app-radius p-4 w-full max-w-md flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-bold">{t("History")} · {habit.name}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex gap-2">
          {[
            ["week", t("Last week")],
            ["month", t("Last month")],
            ["year", t("Last year")],
          ].map(([key, label]) => (
            <button
              key={key}
              className="app-btn flex-1 py-1.5 text-xs"
              style={{
                background: range === key ? "var(--accent)" : "var(--surface)",
                color: range === key ? "var(--accent-ink)" : "var(--ink)",
                border: "1.5px solid var(--border)",
              }}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm app-muted text-center py-6">{t("Loading...")}</div>
        ) : dates.length === 0 ? (
          <EmptyState>{t("Nothing logged in this period.")}</EmptyState>
        ) : (
          <div className="flex flex-col gap-1">
            {dates.map((d) => (
              <div key={d} className="text-sm app-card app-radius px-3 py-2 flex items-center gap-2">
                <Check size={14} className="app-accent-text" />
                {new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HabitSettings({ settings, t, onClose, onSaved }) {
  const [weekEndDay, setWeekEndDay] = useState(settings.week_end_day ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("update_my_habit_settings", {
        p_week_end_day: Number(weekEndDay),
      });
      if (error) throw error;
      await onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="app-surface app-radius p-4 w-full max-w-md flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h3 className="font-bold">{t("Habit settings")}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <ErrorBanner error={error} onClose={() => setError("")} />

        <p className="text-xs app-muted">
          {t("Applies to all your habits, across every group you're in. Notifications are set per habit — edit a habit to choose when it reminds you.")}
        </p>

        <div>
          <label className="text-xs app-muted">{t("My week ends on")}</label>
          <select className="app-input mt-1" value={weekEndDay} onChange={(e) => setWeekEndDay(e.target.value)}>
            {DAY_LABELS_SHORT.map((lbl, i) => (
              <option key={i} value={i}>{t(lbl)}</option>
            ))}
          </select>
        </div>

        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy} onClick={save}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}
