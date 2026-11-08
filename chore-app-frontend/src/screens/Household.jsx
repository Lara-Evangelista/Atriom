import React from "react";
import { useTranslation } from "react-i18next";
import HouseholdJoinCreate from "../components/HouseholdJoinCreate";

export default function Household({ onCreate, onJoin }) {
  const { t } = useTranslation();
  // Renders inline inside the normal tab content area now (Habits works
  // without a group, so this is no longer a full-screen blocking gate) —
  // no min-h-screen/centering wrapper needed here anymore.
  return (
    <div className="app-card app-radius p-6 w-full max-w-sm mx-auto">
      <h1 className="text-xl font-semibold app-ink mb-1">🏠 {t("Your household")}</h1>
      <p className="text-sm app-muted mb-4">{t("Join one with an invite code, or start a new one.")}</p>
      <HouseholdJoinCreate onCreate={onCreate} onJoin={onJoin} initialTab="join" />
    </div>
  );
}
