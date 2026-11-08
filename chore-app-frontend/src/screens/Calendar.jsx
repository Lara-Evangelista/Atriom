import React, { useCallback, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { uploadChorePhoto } from "../lib/photos";
import ChoreCalendarWidget from "../components/ChoreCalendarWidget";
import { ErrorBanner, PhotoField, IconGlyph } from "../components/UI";
import { useCosmetics } from "../contexts/CosmeticsProvider";

export default function CalendarScreen({ groupId }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { triggerEffect } = useCosmetics();

  const fetchMonth = useCallback(
    async (year, month) => {
      const { data, error } = await supabase.rpc("get_calendar_month", {
        p_group_id: groupId,
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
      return data || {};
    },
    [groupId]
  );

  async function markDone(photoPath) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("complete_chore_event", {
        p_event_id: selected.id,
        p_photo_url: photoPath || null,
      });
      if (error) throw error;
      setSelected(null);
      triggerEffect();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoDone(file) {
    setBusy(true);
    try {
      const path = await uploadChorePhoto(groupId, selected.id, file);
      await markDone(path);
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />
      <ChoreCalendarWidget fetchMonth={fetchMonth} onSelectTask={setSelected} />
      {selected && (
        <div className="app-card app-radius p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <IconGlyph icon={selected.icon} fallback="📋" />
            <div>
              <div className="text-sm font-medium">{selected.name}</div>
              <div className="text-xs app-muted">{selected.display_name || t("Unassigned")}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {selected.status === "pending" &&
              (selected.requires_photo ? (
                <PhotoField busy={busy} label={t("Photo & done")} onFile={handlePhotoDone} />
              ) : (
                <button className="app-btn app-accent-bg px-3 py-1.5 text-sm" disabled={busy} onClick={() => markDone(null)}>
                  <Check size={14} className="inline mr-1" /> {t("Done")}
                </button>
              ))}
            <button className="app-btn app-card p-1.5" onClick={() => setSelected(null)}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
