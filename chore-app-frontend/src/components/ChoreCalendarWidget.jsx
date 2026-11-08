import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Camera, Check, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconGlyph } from "./UI";

// ============================================================================
// ChoreCalendarWidget
//
// A month-at-a-glance calendar for the chore app. Drop this component into
// your app and pass it a `fetchMonth(year, month)` function that calls the
// `get_calendar_month` RPC added in schema.sql:
//
//   async function fetchMonth(year, month) {
//     const { data, error } = await supabase.rpc('get_calendar_month', {
//       p_group_id: groupId,
//       p_year: year,
//       p_month: month, // 1-12
//     });
//     if (error) throw error;
//     return data; // { "2026-09-06": [ { id, name, icon, status, ... } ] }
//   }
//
//   <ChoreCalendarWidget fetchMonth={fetchMonth} />
//
// With no `fetchMonth` prop it falls back to generated demo data, so it
// renders something sensible dropped straight into a page with no wiring.
// ============================================================================

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function isoDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Monday-first weekday index (0 = Monday .. 6 = Sunday)
function mondayIndex(year, month, day) {
  const jsDay = new Date(year, month - 1, day).getDay(); // 0 = Sunday
  return (jsDay + 6) % 7;
}

function demoFetchMonth(year, month) {
  // Deterministic-ish placeholder data so the widget looks alive without
  // a backend connected yet.
  const names = ["Dishes", "Trash", "Bathroom", "Unload: Dishwasher", "Vacuum"];
  const icons = ["🍽️", "🗑️", "🚽", "🧺", "🧹"];
  const people = ["Alex", "Sam", "Jo"];
  const total = daysInMonth(year, month);
  const out = {};
  for (let d = 1; d <= total; d++) {
    if (d % 3 === 0) continue; // some empty days, for contrast
    const count = 1 + ((d * 7) % 3);
    const items = [];
    for (let i = 0; i < count; i++) {
      const idx = (d + i) % names.length;
      items.push({
        id: `${d}-${i}`,
        name: names[idx],
        icon: icons[idx],
        status: d < new Date().getDate() ? "done" : "pending",
        requires_photo: idx === 3,
        display_name: people[(d + i) % people.length],
      });
    }
    out[isoDate(year, month, d)] = items;
  }
  return Promise.resolve(out);
}

const STATUS_STYLES = {
  pending: { dot: "#C97B2E", label: "To do" },
  done: { dot: "#5C7A5E", label: "Done" },
};

export default function ChoreCalendarWidget({ fetchMonth, onSelectTask }) {
  const { t } = useTranslation();
  const WEEKDAYS_T = [t("day.mon"), t("day.tue"), t("day.wed"), t("day.thu"), t("day.fri"), t("day.sat"), t("day.sun")];
  const statusLabel = (status) => (status === "done" ? t("Done") : status === "pending" ? t("To do") : status);
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [monthData, setMonthData] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate()));

  const loader = fetchMonth || demoFetchMonth;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader(cursor.year, cursor.month)
      .then((data) => {
        if (!cancelled) setMonthData(data || {});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.year, cursor.month]);

  const goPrev = useCallback(() => {
    setCursor((c) => (c.month === 1 ? { year: c.year - 1, month: 12 } : { year: c.year, month: c.month - 1 }));
  }, []);
  const goNext = useCallback(() => {
    setCursor((c) => (c.month === 12 ? { year: c.year + 1, month: 1 } : { year: c.year, month: c.month + 1 }));
  }, []);

  const monthLabel = useMemo(
    () =>
      new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [cursor]
  );

  const cells = useMemo(() => {
    const total = daysInMonth(cursor.year, cursor.month);
    const firstOffset = mondayIndex(cursor.year, cursor.month, 1);
    const arr = Array(firstOffset).fill(null);
    for (let d = 1; d <= total; d++) {
      const date = isoDate(cursor.year, cursor.month, d);
      arr.push({ day: d, date, items: monthData[date] || [] });
    }
    return arr;
  }, [cursor, monthData]);

  const selectedItems = monthData[selectedDay] || [];
  const isToday = (date) => date === isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  return (
    <div className="w-full max-w-3xl mx-auto" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div className="flex rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: "#E3DCC9" }}>
        {/* Calendar grid */}
        <div className="flex-1 p-5" style={{ background: "#FAF7F0" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold" style={{ color: "#1F2A44" }}>
              {monthLabel}
            </h2>
            <div className="flex gap-1">
              <button
                onClick={goPrev}
                className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                aria-label={t("Previous month")}
              >
                <ChevronLeft size={18} color="#1F2A44" />
              </button>
              <button
                onClick={goNext}
                className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                aria-label={t("Next month")}
              >
                <ChevronRight size={18} color="#1F2A44" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS_T.map((w, i) => (
              <div key={i} className="text-xs font-medium text-center py-1" style={{ color: "#8A8272" }}>
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, i) =>
              cell === null ? (
                <div key={`empty-${i}`} />
              ) : (
                <button
                  key={cell.date}
                  onClick={() => setSelectedDay(cell.date)}
                  className="aspect-square rounded-lg flex flex-col items-center justify-start pt-1 gap-0.5 transition-all"
                  style={{
                    background: selectedDay === cell.date ? "#1F2A44" : "transparent",
                    border: isToday(cell.date) && selectedDay !== cell.date ? "1.5px solid #C97B2E" : "1.5px solid transparent",
                  }}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: selectedDay === cell.date ? "#FAF7F0" : "#1F2A44" }}
                  >
                    {cell.day}
                  </span>
                  <div className="flex flex-wrap justify-center gap-0.5 px-0.5">
                    {cell.items.slice(0, 3).map((it) => (
                      <span
                        key={it.id}
                        className="block rounded-full"
                        style={{
                          width: 5,
                          height: 5,
                          background: STATUS_STYLES[it.status]?.dot || "#8A8272",
                        }}
                      />
                    ))}
                    {cell.items.length > 3 && (
                      <span
                        className="text-[8px] leading-none"
                        style={{ color: selectedDay === cell.date ? "#FAF7F0" : "#8A8272" }}
                      >
                        +{cell.items.length - 3}
                      </span>
                    )}
                  </div>
                </button>
              )
            )}
          </div>

          <div className="flex gap-4 mt-4 text-xs" style={{ color: "#8A8272" }}>
            <span className="flex items-center gap-1.5">
              <span className="block rounded-full" style={{ width: 6, height: 6, background: STATUS_STYLES.pending.dot }} />
              {t("To do")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="block rounded-full" style={{ width: 6, height: 6, background: STATUS_STYLES.done.dot }} />
              {t("Done")}
            </span>
          </div>
        </div>

        {/* Day detail panel */}
        <div className="w-64 p-5 border-l" style={{ background: "#FFFFFF", borderColor: "#E3DCC9" }}>
          <div className="text-xs font-medium mb-3" style={{ color: "#8A8272" }}>
            {new Date(selectedDay + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </div>

          {loading ? (
            <div className="text-sm" style={{ color: "#8A8272" }}>
              {t("Loading…")}
            </div>
          ) : selectedItems.length === 0 ? (
            <div className="text-sm" style={{ color: "#8A8272" }}>
              {t("Nothing due this day.")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedItems.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onSelectTask && onSelectTask(it)}
                  className="text-left rounded-xl p-3 border flex items-start gap-2.5 hover:border-black/20 transition-colors"
                  style={{ borderColor: "#E3DCC9" }}
                >
                  <span className="text-lg leading-none mt-0.5"><IconGlyph icon={it.icon} fallback="📋" /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "#1F2A44" }}>
                      {it.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "#8A8272" }}>
                      {it.display_name || t("Unassigned")}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1"
                        style={{
                          background: it.status === "done" ? "#EAF1EA" : "#FBF0E2",
                          color: STATUS_STYLES[it.status]?.dot || "#8A8272",
                        }}
                      >
                        {it.status === "done" ? <Check size={10} /> : <Clock size={10} />}
                        {statusLabel(it.status)}
                      </span>
                      {it.requires_photo && <Camera size={12} color="#8A8272" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
