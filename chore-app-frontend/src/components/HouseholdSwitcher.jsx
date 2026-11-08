import React, { useCallback, useRef, useState } from "react";
import { GripVertical, Plus, X, ChevronLeft, Check, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { IconGlyph, ErrorBanner } from "./UI";
import HouseholdJoinCreate from "./HouseholdJoinCreate";
import MyChoresAcrossGroups from "./MyChoresAcrossGroups";
import ChoreCalendarWidget from "./ChoreCalendarWidget";

/*
 * The "first menu" — reachable any time via the house button, not just
 * when you have zero households. Lets you: change UI language, switch
 * between households you've already joined (drag to reorder), or drop
 * into the exact same join/create panel shown on the zero-households
 * screen (Household.jsx) via the shared HouseholdJoinCreate form.
 */
export default function HouseholdSwitcher({
  memberships,
  groupId,
  onSwitch,
  onCreate,
  onJoin,
  onReorder,
  onClose,
}) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState("list"); // 'list' | 'join' | 'create'
  const [view, setView] = useState("households"); // 'households' | 'today' | 'calendar'

  const [order, setOrder] = useState(memberships);
  const dragIndex = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [reorderError, setReorderError] = useState("");

  const goToGroup = useCallback(
    (gid) => {
      onSwitch(gid);
      onClose();
    },
    [onSwitch, onClose]
  );

  function handleDragStart(i) {
    dragIndex.current = i;
  }

  function handleDragOver(e, i) {
    e.preventDefault();
    if (i !== dragOverIndex) setDragOverIndex(i);
  }

  function handleDrop(i) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOverIndex(null);
    if (from === null || from === i) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    setOrder(next);
    onReorder(next).catch((err) => setReorderError(err.message || String(err)));
  }

  const showTabs = mode === "list" && memberships.length > 1;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className={`app-card app-radius p-5 w-full max-h-[85vh] overflow-y-auto flex flex-col gap-5 ${
          showTabs && view !== "households" ? "max-w-2xl" : "max-w-sm"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            {mode !== "list" && (
              <button type="button" className="app-btn app-card p-1.5" onClick={() => setMode("list")}>
                <ChevronLeft size={16} />
              </button>
            )}
            🏠 {mode === "list" ? t("Your households") : t("Your household")}
          </h2>
          <button className="app-btn app-card p-1.5" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {showTabs && (
          <div className="flex gap-2">
            <button
              className={`app-btn px-3 py-1.5 text-xs flex-1 ${view === "households" ? "app-accent-bg" : "app-card"}`}
              onClick={() => setView("households")}
            >
              {t("Households")}
            </button>
            <button
              className={`app-btn px-3 py-1.5 text-xs flex-1 ${view === "today" ? "app-accent-bg" : "app-card"}`}
              onClick={() => setView("today")}
            >
              {t("Today's chores")}
            </button>
            <button
              className={`app-btn px-3 py-1.5 text-xs flex-1 ${view === "calendar" ? "app-accent-bg" : "app-card"}`}
              onClick={() => setView("calendar")}
            >
              {t("Calendar")}
            </button>
          </div>
        )}

        <div>
          <label className="text-xs app-muted block mb-1">{t("UI Language")}</label>
          <select
            className="app-input w-full"
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            <option value="en">{t("English")}</option>
            <option value="pt-PT">{t("Portuguese")}</option>
          </select>
        </div>

        {mode !== "list" ? (
          <HouseholdJoinCreate
            onCreate={onCreate}
            onJoin={onJoin}
            initialTab={mode}
            onDone={onClose}
          />
        ) : view === "today" ? (
          <MyChoresAcrossGroups onOpenGroup={goToGroup} />
        ) : view === "calendar" ? (
          <MyCalendarAcrossGroups onOpenGroup={goToGroup} />
        ) : (
          <>
            <div>
              <div className="text-xs app-muted mb-2">{t("Drag to reorder. Tap one to switch.")}</div>
              <div className="flex flex-col gap-2">
                {order.map((m, i) => (
                  <div
                    key={m.group_id}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={() => handleDrop(i)}
                    onDragEnd={() => setDragOverIndex(null)}
                    className={`flex items-center gap-2 app-radius p-3 text-sm transition ${
                      m.group_id === groupId ? "app-accent-bg" : "app-btn app-card"
                    } ${dragOverIndex === i ? "ring-2 ring-offset-1 app-accent-text" : ""}`}
                  >
                    <span className="cursor-grab shrink-0 opacity-60">
                      <GripVertical size={16} />
                    </span>
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center justify-between text-left"
                      onClick={() => goToGroup(m.group_id)}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <IconGlyph icon={m.groups?.icon} fallback="🏠" />
                        <span className="truncate">{m.groups?.name}</span>
                      </span>
                      <span className="app-muted text-xs shrink-0 ml-2">{t("as")} {m.display_name}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {reorderError && <div className="text-sm app-chip-danger app-radius px-3 py-2">{reorderError}</div>}

            <div className="flex gap-2">
              <button className="app-btn app-card flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5" onClick={() => setMode("join")}>
                <Plus size={15} /> {t("Enter a household")}
              </button>
              <button className="app-btn app-card flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5" onClick={() => setMode("create")}>
                <Plus size={15} /> {t("Create new")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A month calendar spanning every household the user belongs to. Reuses
// the same ChoreCalendarWidget the per-household Calendar screen uses, but
// backed by the cross-group get_my_calendar_month RPC, and adds quick
// mark-done / delay / open-household actions for the selected day's items.
function MyCalendarAcrossGroups({ onOpenGroup }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchMonth = useCallback(async (year, month) => {
    const { data, error } = await supabase.rpc("get_my_calendar_month", {
      p_year: year,
      p_month: month,
    });
    if (error) throw error;
    return data || {};
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markDone() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("complete_chore_event", {
        p_event_id: selected.id,
        p_photo_url: null,
      });
      if (error) throw error;
      setSelected(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function delay(days) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("delay_chore_event", {
        p_event_id: selected.id,
        p_days: days,
      });
      if (error) throw error;
      setSelected(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner error={error} onClose={() => setError("")} />
      <ChoreCalendarWidget key={refreshKey} fetchMonth={fetchMonth} onSelectTask={setSelected} />
      {selected && (
        <div className="app-card app-radius p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconGlyph icon={selected.icon} fallback="📋" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{selected.name}</div>
              <button
                type="button"
                className="text-xs app-muted flex items-center gap-1"
                onClick={() => onOpenGroup(selected.group_id)}
              >
                <IconGlyph icon={selected.group_icon} fallback="🏠" size={12} />
                {selected.group_name}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {selected.status === "pending" &&
              (selected.requires_photo ? (
                <button className="app-btn app-accent-bg px-3 py-1.5 text-sm" onClick={() => onOpenGroup(selected.group_id)}>
                  <Camera size={14} className="inline mr-1" /> {t("Open to complete")}
                </button>
              ) : (
                <button className="app-btn app-accent-bg px-3 py-1.5 text-sm" disabled={busy} onClick={markDone}>
                  <Check size={14} className="inline mr-1" /> {t("Done")}
                </button>
              ))}
            {selected.status === "pending" && selected.is_delayable && (
              <button className="app-btn app-card px-3 py-1.5 text-sm" disabled={busy} onClick={() => delay(1)}>
                {t("Delay a day")}
              </button>
            )}
            <button className="app-btn app-card p-1.5" onClick={() => setSelected(null)}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

