import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { useTranslation } from "react-i18next";

export default function Auth() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { t, i18n } = useTranslation();

  async function submit(e) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice(t("Account created. Check your inbox if email confirmation is on."));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center app-bg px-4">
      <div className="app-card app-radius p-6 w-full max-w-sm flex flex-col gap-4">
        {/* Language picker */}
        <div className="flex justify-end">
          <select
            className="app-input text-xs py-1 px-2 w-auto"
            value={i18n.language.startsWith("pt") ? "pt-PT" : "en"}
            onChange={e => i18n.changeLanguage(e.target.value)}
          >
            <option value="en">🇬🇧 English</option>
            <option value="pt-PT">🇵🇹 Português</option>
          </select>
        </div>

        <div>
          <h1 className="text-xl font-semibold app-ink mb-1">🧹 Chores</h1>
          <p className="text-sm app-muted">
            {mode === "signup" ? t("Create an account to get started.") : t("Sign in to your account.")}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            className="app-input"
            type="email"
            placeholder={t("Email")}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="app-input"
            type="password"
            placeholder={t("Password")}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {error && <div className="text-sm app-chip-danger app-radius px-3 py-2">{error}</div>}
          {notice && <div className="text-sm app-chip-good app-radius px-3 py-2">{notice}</div>}
          <button className="app-btn app-accent-bg py-2.5 mt-1" disabled={busy} type="submit">
            {busy ? t("Working...") : mode === "signup" ? t("Sign up") : t("Sign in")}
          </button>
        </form>
        <button
          className="text-sm app-muted underline text-center"
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}
        >
          {mode === "signup" ? t("Already have an account? Sign in") : t("New here? Create an account")}
        </button>
      </div>
    </div>
  );
}
