import React, { useCallback, useEffect, useState } from "react";
import { Check, Clock, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { ErrorBanner, IconGlyph } from "./UI";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Shows everything assigned to the current user across every household
// they belong to — not scoped to whichever group is "current" — so
// someone in several households can see what they need to do without
// switching into each one individually. Quick actions (mark done / delay)
// reuse the same per-event RPCs the in-household Today screen uses; those
// only take an event id and figure out the household from it.
export default function MyChoresAcrossGroups({ onOpenGroup }) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("today"); // 'today' | 'upcoming'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data, error } = await supabase.rpc("get_my_chores", {
        p_since: null,
        p_until: null,
      });
      if (error) throw error;
      setTasks(data || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markDone(task) {
    if (task.requires_photo) {
      // Photo proof has to happen inside the household itself (camera /
      // upload flow lives there); jump the person straight to it.
      onOpenGroup(task.group_id);
      return;
    }
    setBusyId(task.event_id);
    try {
      const { error } = await supabase.rpc("complete_chore_event", {
        p_event_id: task.event_id,
        p_photo_url: null,
      });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function delay(task, days) {
    setBusyId(task.event_id);
    try {
      const { error } = await supabase.rpc("delay_chore_event", {
        p_event_id: task.event_id,
        p_days: days,
      });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  const today = isoToday();
  const filtered = filter === "today" ? tasks.filter((task) => task.date <= today) : tasks.filter((task) => task.date > today);

  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner error={error} onClose={() => setError("")} />
      <div className="flex gap-2">
        <button
          className={`app-btn px-3 py-1.5 text-xs ${filter === "today" ? "app-accent-bg" : "app-card"}`}
          onClick={() => setFilter("today")}
        >
          {t("Today & overdue")}
        </button>
        <button
          className={`app-btn px-3 py-1.5 text-xs ${filter === "upcoming" ? "app-accent-bg" : "app-card"}`}
          onClick={() => setFilter("upcoming")}
        >
          {t("Upcoming")}
        </button>
      </div>

      {loading ? (
        <div className="text-sm app-muted py-4 text-center">{t("Loading…")}</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm app-muted py-4 text-center">
          {filter === "today" ? t("Nothing due across your households right now.") : t("Nothing coming up yet.")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((task) => {
            const overdue = task.date < today;
            const delaysLeft = task.is_delayable ? Math.max(0, (task.max_consecutive_delays || 0) - (task.consecutive_delays_count || 0)) : 0;
            return (
              <div key={task.event_id} className="app-card app-radius p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-[11px] app-muted min-w-0"
                    onClick={() => onOpenGroup(task.group_id)}
                    title={t("Open this household")}
                  >
                    <IconGlyph icon={task.group_icon} fallback="🏠" size={13} />
                    <span className="truncate">{task.group_name}</span>
                  </button>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${overdue ? "app-chip-danger" : "app-chip-warn"}`}>
                    {overdue ? t("Overdue") : task.date === today ? t("Today") : task.date}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <IconGlyph icon={task.icon} fallback="📋" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{task.name}</div>
                  </div>
                  {task.requires_photo && <Camera size={13} className="app-muted shrink-0" />}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="app-btn app-accent-bg px-2.5 py-1 text-xs flex items-center gap-1"
                    disabled={busyId === task.event_id}
                    onClick={() => markDone(task)}
                  >
                    <Check size={12} /> {task.requires_photo ? t("Open to complete") : t("Done")}
                  </button>
                  {task.is_delayable && delaysLeft > 0 && (
                    <button
                      className="app-btn app-card px-2.5 py-1 text-xs flex items-center gap-1"
                      disabled={busyId === task.event_id}
                      onClick={() => delay(task, 1)}
                    >
                      <Clock size={12} /> {t("Delay a day")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
