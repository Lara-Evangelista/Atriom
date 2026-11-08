import React, { useEffect, useRef, useState } from "react";
import { Camera, Check, ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { getSignedPhotoUrl } from "../lib/photos";

// Shared with IconPicker: a value is a storage path (not an emoji/short
// string) once it's longer than a typical emoji sequence and contains a
// folder separator.
export function isIconPhotoPath(value) {
  return !!value && value.length > 10 && !value.startsWith("http") && value.includes("/");
}

// Renders a chore/avatar icon value: an emoji as plain text, a photo path
// as an actual <img> (resolved via a signed URL), or a fallback character
// while nothing is set. When `size` is omitted, the emoji case inherits
// font-size from whatever wraps it (e.g. a "text-lg" span) instead of
// forcing its own — only the photo case needs an explicit pixel size.
export function IconGlyph({ icon, fallback = "✓", size, className = "" }) {
  const isPhoto = isIconPhotoPath(icon);
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (isPhoto) {
      getSignedPhotoUrl(icon).then((u) => { if (!cancelled) setUrl(u); }).catch(() => { if (!cancelled) setUrl(null); });
    } else {
      setUrl(null);
    }
    return () => { cancelled = true; };
  }, [icon, isPhoto]);

  if (isPhoto) {
    const dim = size || 28;
    return url ? (
      <img src={url} alt="" className={`rounded object-cover shrink-0 ${className}`} style={{ width: dim, height: dim }} />
    ) : (
      <div className={`rounded bg-black/5 shrink-0 ${className}`} style={{ width: dim, height: dim }} />
    );
  }
  return (
    <span className={`app-emoji ${className}`} style={size ? { fontSize: size * 0.85, lineHeight: 1 } : undefined}>
      {icon || fallback}
    </span>
  );
}

export function PeoplePicker({ roster, selected, onChange, multi = true }) {
  function toggle(uid) {
    if (multi) {
      onChange(selected.includes(uid) ? selected.filter((x) => x !== uid) : [...selected, uid]);
    } else {
      onChange([uid]);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {roster.map((m) => {
        const isOn = selected.includes(m.user_id);
        return (
          <button
            type="button"
            key={m.user_id}
            onClick={() => toggle(m.user_id)}
            className="app-btn px-3 py-1.5 text-sm flex items-center gap-1.5"
            style={{
              background: isOn ? "var(--accent)" : "var(--surface)",
              color: isOn ? "var(--accent-ink)" : "var(--ink)",
              border: "1.5px solid var(--border)",
            }}
          >
            {isOn && <Check size={13} />}
            <IconGlyph icon={m.avatar_url} fallback="👤" size={16} />
            {m.display_name}
          </button>
        );
      })}
      {multi && roster.length > 1 && (
        <button
          type="button"
          className="app-btn px-3 py-1.5 text-sm app-muted"
          style={{ border: "1.5px dashed var(--border)" }}
          onClick={() => onChange(roster.map((m) => m.user_id))}
        >
          Everyone
        </button>
      )}
    </div>
  );
}

const COMMON_ICONS = ["🧹", "🍽️", "🗑️", "🚽", "🧺", "🧼", "🛏️", "🪟", "🐶", "🌱", "📦", "🧴"];

export function IconPicker({ value, onChange, groupId }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Detect if value is a storage path (not an emoji/short string)
  const isPhoto = isIconPhotoPath(value);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (isPhoto) {
      getSignedPhotoUrl(value).then(setPreviewUrl).catch(() => setPreviewUrl(null));
    } else {
      setPreviewUrl(null);
    }
  }, [value, isPhoto]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!groupId) {
      setUploadError("Can't upload a photo here yet — missing household id.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      // Storage RLS requires the first path segment to be the group_id.
      const path = `${groupId}/icons/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("chore-photos").upload(path, file, {
        upsert: false,
        contentType: file.type || "image/jpeg",
      });
      if (error) throw error;
      onChange(path);
    } catch (err) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {COMMON_ICONS.map((ic) => (
          <button
            type="button"
            key={ic}
            onClick={() => onChange(ic)}
            className="app-btn text-lg w-9 h-9 flex items-center justify-center"
            style={{
              border: value === ic ? "2px solid var(--accent)" : "1.5px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            {ic}
          </button>
        ))}

        {/* Photo upload button */}
        <button
          type="button"
          className="app-btn w-9 h-9 flex items-center justify-center"
          style={{
            border: isPhoto ? "2px solid var(--accent)" : "1.5px solid var(--border)",
            background: "var(--surface)",
          }}
          onClick={() => fileRef.current?.click()}
          title="Use a photo as icon"
          disabled={uploading}
        >
          {uploading ? (
            <span className="text-xs">…</span>
          ) : isPhoto && previewUrl ? (
            <img src={previewUrl} alt="icon" className="w-7 h-7 rounded object-cover" />
          ) : (
            <ImagePlus size={15} />
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>

      {uploadError && <div className="text-xs text-red-500 mb-1">{uploadError}</div>}

      <input
        className="app-input"
        placeholder="Or type/paste any emoji"
        value={isPhoto ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={32}
      />
    </div>
  );
}

export function PhotoField({ onFile, busy, label = "Add photo" }) {
  return (
    <label className="app-btn app-card px-3 py-2 text-sm flex items-center gap-2 w-fit cursor-pointer">
      <Camera size={15} />
      {busy ? "Uploading…" : label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

export function PhotoThumb({ path, size = 48 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (path) getSignedPhotoUrl(path).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!path) return null;
  return url ? (
    <img
      src={url}
      alt="proof"
      style={{ width: size, height: size, objectFit: "cover", borderRadius: "0.6rem" }}
    />
  ) : (
    <div
      className="app-card"
      style={{ width: size, height: size, borderRadius: "0.6rem" }}
    />
  );
}

export function StatusChip({ status }) {
  const { t } = useTranslation();
  const map = {
    pending: { cls: "app-chip-warn", label: t("To do") },
    done: { cls: "app-chip-good", label: t("Done") },
    running: { cls: "app-chip-warn", label: t("Running") },
    out: { cls: "app-chip-danger", label: t("Out") },
    resolved: { cls: "app-chip-good", label: t("Restocked") },
    accepted: { cls: "app-chip-good", label: t("Accepted") },
    declined: { cls: "app-chip-danger", label: t("Declined") },
  };
  const s = map[status] || { cls: "app-chip-warn", label: status };
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

export function EmptyState({ children }) {
  return <div className="text-sm app-muted text-center py-8">{children}</div>;
}

export function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="text-sm app-chip-danger app-radius px-3 py-2 flex justify-between items-start gap-2">
      <span>{error}</span>
      {onClose && (
        <button onClick={onClose} className="font-bold">
          ×
        </button>
      )}
    </div>
  );
}
