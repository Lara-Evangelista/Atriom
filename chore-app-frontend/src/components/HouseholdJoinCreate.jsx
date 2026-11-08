import React, { useState } from "react";
import { useTranslation } from "react-i18next";

export default function HouseholdJoinCreate({ onCreate, onJoin, initialTab = "join", onDone }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab);
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (tab === "create") {
        await onCreate(groupName.trim(), displayName.trim());
      } else {
        await onJoin(inviteCode.trim(), displayName.trim());
      }
      onDone && onDone();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          className={`app-btn flex-1 py-2 text-sm ${tab === "join" ? "app-accent-bg" : "app-card"}`}
          onClick={() => setTab("join")}
          type="button"
        >
          {t("Join")}
        </button>
        <button
          className={`app-btn flex-1 py-2 text-sm ${tab === "create" ? "app-accent-bg" : "app-card"}`}
          onClick={() => setTab("create")}
          type="button"
        >
          {t("Create new")}
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {tab === "create" ? (
          <input
            className="app-input"
            placeholder={t("Household name (e.g. Maple St)")}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
            autoFocus
          />
        ) : (
          <input
            className="app-input uppercase"
            placeholder={t("Invite code")}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            maxLength={6}
            required
            autoFocus
          />
        )}
        <input
          className="app-input"
          placeholder={t("Your display name in this household")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        {error && <div className="text-sm app-chip-danger app-radius px-3 py-2">{error}</div>}
        <button className="app-btn app-accent-bg py-2.5 mt-1" disabled={busy} type="submit">
          {busy ? t("Working...") : tab === "create" ? t("Create household") : t("Join household")}
        </button>
      </form>
    </div>
  );
}
