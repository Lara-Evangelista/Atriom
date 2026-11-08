import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Bell, BellOff, Copy, LogOut, RefreshCw } from "lucide-react";
import { supabase, CALENDAR_FEED_URL } from "../supabaseClient";
import { ErrorBanner, IconPicker, IconGlyph } from "../components/UI";
import { useTranslation } from 'react-i18next';

export default function Settings({ groupId, memberships, roster, onSwitchGroup, onLeaveGroup, onSignOut, onRefreshGroup, onOpenGroupPicker }) {
  const current = memberships.find((m) => m.group_id === groupId);
  const { t, i18n } = useTranslation();
  const [confirmLeave, setConfirmLeave] = useState(false);
  // If we're the only member, leaving deletes the household entirely —
  // worth a stronger warning than the normal "lose access" message.
  const isSoleMember = (roster || []).length <= 1;

  return (
    <div className="flex flex-col gap-8 pb-10">
      <HouseholdSettingsSection current={current} roster={roster} t={t} onSaved={onRefreshGroup} />
      
      <LeaderboardPrizesSection current={current} t={t} onSaved={onRefreshGroup} />
      
      <CalendarSection groupId={groupId} t={t} />
      
      <InviteSection current={current} t={t} />

      {memberships.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold app-muted mb-2">{t('Switch household')}</h3>
          <div className="flex flex-col gap-2">
            {memberships.map((m) => (
              <button
                key={m.group_id}
                className={`app-btn app-radius p-3 text-left text-sm flex justify-between ${m.group_id === groupId ? "app-accent-bg" : "app-card"}`}
                onClick={() => onSwitchGroup(m.group_id)}
              >
                <span>{m.groups?.name}</span>
                <span className="app-muted">{t("as")} {m.display_name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold app-muted mb-2">{t('Households')}</h3>
        <button className="app-btn app-card py-2.5 w-full" onClick={onOpenGroupPicker}>
          {t('Create or join another household')}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {confirmLeave ? (
          <div className="app-card app-radius p-4 flex flex-col gap-3">
            <div className="text-sm font-medium">
              {isSoleMember ? t("Leave and delete this household?") : t('Leave this household?')}
            </div>
            <div className="text-xs app-muted">
              {isSoleMember
                ? t("You're the only member left. Leaving will permanently delete this household — its chores, history, stock, and everything else — for good. This can't be undone.")
                : t("You'll lose access to its chores, stock, and history until someone invites you back.")}
            </div>
            <div className="flex gap-2">
              <button className="app-btn app-chip-danger py-2 flex-1" onClick={() => { setConfirmLeave(false); onLeaveGroup(groupId); }}>
                {isSoleMember ? t('Yes, delete it') : t('Yes, leave')}
              </button>
              <button className="app-btn app-card py-2 flex-1" onClick={() => setConfirmLeave(false)}>
                {t('Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button className="app-btn app-chip-danger py-2.5" onClick={() => setConfirmLeave(true)}>
            {t('Leave this household')}
          </button>
        )}
        <button className="app-btn app-card py-2.5 flex items-center justify-center gap-2" onClick={onSignOut}>
          <LogOut size={15} /> {t('Sign out')}
        </button>
      </div>
    </div>
  );
}

function HouseholdSettingsSection({ current, roster, t, onSaved }) {
  const group = current?.groups || {};
  const [name, setName] = useState(group.name || '');
  const [icon, setIcon] = useState(group.icon || '');
  const [allowEdit, setAllowEdit] = useState(group.allow_anyone_to_edit_chores ?? true);
  const [nudgePolicy, setNudgePolicy] = useState(group.nudge_policy || 'restricted');
  const [notificationLanguage, setNotificationLanguage] = useState(group.notification_language || 'en');
  const [rewardsEnabled, setRewardsEnabled] = useState(group.rewards_enabled ?? false);
  const [maxCoinReward, setMaxCoinReward] = useState(group.max_coin_reward ?? 10);
  const [cosmeticsUnlockedForAll, setCosmeticsUnlockedForAll] = useState(group.cosmetics_unlocked_for_all ?? false);
  const [restrictCoinsToAdmins, setRestrictCoinsToAdmins] = useState(group.restrict_coins_to_admins ?? true);
  const [allowSelfAssignedCoins, setAllowSelfAssignedCoins] = useState(group.allow_self_assigned_coins ?? false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const isAdmin = current?.role === 'owner' || current?.role === 'admin';

  const save = async () => {
    setBusy(true); setNotice(''); setError('');
    const { error } = await supabase.rpc('update_household_settings', {
      p_group_id: group.id,
      p_name: name,
      p_icon: icon,
      p_allow_anyone_to_edit_chores: allowEdit,
      p_nudge_policy: nudgePolicy,
      p_notification_language: notificationLanguage,
      p_rewards_enabled: rewardsEnabled,
      p_max_coin_reward: maxCoinReward,
      p_restrict_coins_to_admins: restrictCoinsToAdmins,
      p_allow_self_assigned_coins: allowSelfAssignedCoins,
      p_cosmetics_unlocked_for_all: cosmeticsUnlockedForAll,
    });
    if (error) setError(error.message);
    else {
      setNotice(t('Saved.'));
      setTimeout(() => setNotice(''), 2000);
      // Re-fetch memberships so the rest of the app (e.g. the Rewards tab,
      // and this form on its next mount) reflects what was just saved.
      await onSaved?.();
    }
    setBusy(false);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t('Household Settings')}</h3>
      <div className="app-card app-radius p-4 flex flex-col gap-4">
        <ErrorBanner error={error} onClose={() => setError('')} />
        {notice && <div className="text-sm text-green-500">{notice}</div>}
        
        <div>
          <label className="text-xs app-muted block mb-1">{t('Household Name')}</label>
          <input className="app-input w-full" value={name} onChange={e => setName(e.target.value)} disabled={!isAdmin} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Household Icon (emoji or photo)')}</label>
          {isAdmin ? (
            <IconPicker value={icon} onChange={setIcon} groupId={group.id} />
          ) : (
            <input className="app-input w-full" value={icon} disabled />
          )}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{t('Allow anyone to edit chores')}</div>
            <div className="text-xs app-muted">{t('If off, only admins can edit chores.')}</div>
          </div>
          <button 
            className={`app-btn p-2 text-xs ${allowEdit ? 'app-accent-bg' : 'app-card'}`} 
            disabled={!isAdmin}
            onClick={() => setAllowEdit(!allowEdit)}>
            {allowEdit ? t('Yes') : t('No')}
          </button>
        </div>

        <div>
          <label className="text-xs app-muted block mb-1">{t('Nudge Policy')}</label>
          <div className="text-xs app-muted mb-2">{t('Who can send reminders to assignees.')}</div>
          <div className="flex gap-2">
            {[['off', t('Off')], ['restricted', t('Restricted')], ['everyone', t('Everyone')]].map(([val, label]) => (
              <button key={val} className={`app-btn px-3 py-1.5 text-sm ${nudgePolicy === val ? 'app-accent-bg' : 'app-card'}`} disabled={!isAdmin} onClick={() => setNudgePolicy(val)}>{label}</button>
            ))}
          </div>
          <div className="text-xs app-muted mt-1">
            {nudgePolicy === 'off' ? t('No one can nudge.') : nudgePolicy === 'everyone' ? t('Any member can nudge any assignee.') : t('Only the task creator or co-rotation members can nudge.')}
          </div>
        </div>

        <div>
          <label className="text-xs app-muted block mb-1">{t('Notification Language')}</label>
          <div className="text-xs app-muted mb-2">{t('The language for push notifications about chores.')}</div>
          <select 
            className="app-input w-full" 
            value={notificationLanguage} 
            onChange={(e) => setNotificationLanguage(e.target.value)}
            disabled={!isAdmin}
          >
            <option value="en">{t('English')}</option>
            <option value="pt-PT">{t('Portuguese')}</option>
          </select>
        </div>

        {current?.role === 'owner' && roster && roster.length > 0 && (
          <div className="pt-2 border-t app-border">
            <h4 className="font-semibold mb-2 mt-3">{t('Rewards System')}</h4>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 text-accent" checked={rewardsEnabled} onChange={e => setRewardsEnabled(e.target.checked)} disabled={!isAdmin} />
              <span className="font-medium">{t('Enable Rewards & Coins')}</span>
            </label>
            {rewardsEnabled && (
              <div className="mt-3 pl-7">
                <label className="block text-sm font-semibold mb-1">{t('Max Coins per Chore')} ({maxCoinReward})</label>
                <input type="range" min="1" max="100" value={maxCoinReward} onChange={e => setMaxCoinReward(parseInt(e.target.value))} disabled={!isAdmin} className="w-full accent-[var(--accent)]" />

                <label className="flex items-center justify-between gap-3 mt-4">
                  <span>
                    <span className="font-medium block">{t('Only admins can set coin rewards')}</span>
                    <span className="text-xs app-muted">{t('If off, any member can put coins on a chore they create.')}</span>
                  </span>
                  <input type="checkbox" className="w-4 h-4 text-accent shrink-0" checked={restrictCoinsToAdmins} onChange={e => setRestrictCoinsToAdmins(e.target.checked)} disabled={!isAdmin} />
                </label>

                <label className="flex items-center justify-between gap-3 mt-3">
                  <span>
                    <span className="font-medium block">{t('Allow coins on self-assigned chores')}</span>
                    <span className="text-xs app-muted">{t("If off, no one can put a coin reward on a chore assigned only to themselves. For a rotation, they need at least one other person in it besides themselves.")}</span>
                  </span>
                  <input type="checkbox" className="w-4 h-4 text-accent shrink-0" checked={allowSelfAssignedCoins} onChange={e => setAllowSelfAssignedCoins(e.target.checked)} disabled={!isAdmin} />
                </label>
              </div>
            )}

            <label className="flex items-center space-x-3 cursor-pointer mt-4">
              <input type="checkbox" className="w-4 h-4 text-accent" checked={cosmeticsUnlockedForAll} onChange={e => setCosmeticsUnlockedForAll(e.target.checked)} disabled={!isAdmin} />
              <span className="font-medium">{t('Unlock all themes & effects for everyone')}</span>
            </label>
            <div className="text-xs app-muted mt-1 pl-7">
              {t('Skip the coin cost on App Cosmetics (themes, completion effects) for every member — handy if you\'d rather keep coins purely for real-world rewards, or aren\'t using coins at all.')}
            </div>

            <div className="text-xs app-muted mt-2">{t('Saved together with the rest of this form when you press Save Household below.')}</div>
          </div>
        )}

        {isAdmin ? (
          <button type="button" className="app-btn app-accent-bg py-2 mt-2" onClick={save} disabled={busy || !name.trim()}>
            {busy ? t('Saving...') : t('Save Household')}
          </button>
        ) : (
          <div className="text-xs app-muted mt-2">{t('Only admins and the owner can change household settings.')}</div>
        )}
      </div>

      {current?.role === 'owner' && roster && roster.length > 0 && (
        <AdminManagementSection groupId={group.id} roster={roster} currentUserId={current.user_id} t={t} />
      )}
    </div>
  );
}

function LeaderboardPrizesSection({ current, t, onSaved }) {
  const group = current?.groups || {};
  const isAdmin = current?.role === 'owner' || current?.role === 'admin';
  const rewardsEnabled = !!group.rewards_enabled;

  const [weeklyPrize, setWeeklyPrize] = useState(group.weekly_leaderboard_prize_coins ?? 0);
  const [monthlyPrize, setMonthlyPrize] = useState(group.monthly_leaderboard_prize_coins ?? 0);
  const [yearlyPrize, setYearlyPrize] = useState(group.yearly_leaderboard_prize_coins ?? 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  if (!rewardsEnabled) return null;

  const save = async () => {
    if (!isAdmin) return;
    setBusy(true); setNotice(''); setError('');
    const { error: rpcErr } = await supabase.rpc('update_leaderboard_prizes', {
      p_group_id: group.id,
      p_weekly_coins: weeklyPrize || 0,
      p_monthly_coins: monthlyPrize || 0,
      p_yearly_coins: yearlyPrize || 0,
    });
    if (rpcErr) setError(rpcErr.message);
    else {
      setNotice(t('Saved.'));
      setTimeout(() => setNotice(''), 2000);
      await onSaved?.();
    }
    setBusy(false);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t('Leaderboard Prizes')}</h3>
      <div className="app-card app-radius p-4 flex flex-col gap-4">
        <ErrorBanner error={error} onClose={() => setError('')} />
        {notice && <div className="text-sm text-green-500">{notice}</div>}
        <div className="text-xs app-muted">
          {t('Award coins automatically to whoever tops the leaderboard each week, month, and year. A prize left at 0 stays off — nothing is paid out for that period. If more than one person ties for the top spot, everyone tied gets the full prize.')}
        </div>
        
        <div>
          <label className="text-xs app-muted block mb-1">{t('Weekly prize (coins)')}</label>
          <input className="app-input w-full" type="number" min="0" max="1000" value={weeklyPrize} onChange={e => setWeeklyPrize(parseInt(e.target.value) || 0)} disabled={!isAdmin} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Monthly prize (coins)')}</label>
          <input className="app-input w-full" type="number" min="0" max="1000" value={monthlyPrize} onChange={e => setMonthlyPrize(parseInt(e.target.value) || 0)} disabled={!isAdmin} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Yearly prize (coins)')}</label>
          <input className="app-input w-full" type="number" min="0" max="1000" value={yearlyPrize} onChange={e => setYearlyPrize(parseInt(e.target.value) || 0)} disabled={!isAdmin} />
        </div>

        {isAdmin ? (
          <button type="button" className="app-btn app-accent-bg py-2 mt-2" onClick={save} disabled={busy}>
            {busy ? t('Saving...') : t('Save Prizes')}
          </button>
        ) : (
          <div className="text-xs app-muted mt-2">{t('Only admins can set leaderboard prizes.')}</div>
        )}
      </div>
    </div>
  );
}

function PersonalSettingsSection({ current }) {
  const { t } = useTranslation();
  const prefs = current?.notification_preferences || { daily_chores: true, timers: true, supermarket: true };
  const [name, setName] = useState(current?.display_name || '');
  const [avatar, setAvatar] = useState(current?.avatar_url || '');
  const [pronouns, setPronouns] = useState(current?.pronouns || 'they/them');
  const [hour, setHour] = useState(String(current?.notification_hour ?? 9));
  
  const [daily, setDaily] = useState(prefs.daily_chores ?? true);
  const [timers, setTimers] = useState(prefs.timers ?? true);
  const [supermarket, setSupermarket] = useState(prefs.supermarket ?? true);
  const [isPaused, setIsPaused] = useState(current?.is_paused ?? false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setNotice(''); setError('');
    const hr = parseInt(hour, 10);
    const { error } = await supabase.rpc('update_personal_settings', {
      p_group_id: current.group_id,
      p_display_name: name,
      p_avatar_url: avatar,
      p_notification_hour: isNaN(hr) ? 9 : hr,
      p_notification_preferences: { daily_chores: daily, timers, supermarket },
      p_pronouns: pronouns,
      p_is_paused: isPaused
    });
    if (error) setError(error.message);
    else { setNotice(t('Saved.')); setTimeout(() => setNotice(''), 2000); }
    setBusy(false);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t('Personal Settings')}</h3>
      <div className="app-card app-radius p-4 flex flex-col gap-4">
        <ErrorBanner error={error} onClose={() => setError('')} />
        {notice && <div className="text-sm text-green-500">{notice}</div>}
        
        <div>
          <label className="text-xs app-muted block mb-1">{t('Your Display Name')}</label>
          <input className="app-input w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Avatar (emoji or photo)')}</label>
          <IconPicker value={avatar} onChange={setAvatar} />
        </div>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Pronouns')}</label>
          <select className="app-input w-full bg-transparent" value={pronouns} onChange={e => setPronouns(e.target.value)}>
            <option value="they/them">{t('They/Them')}</option>
            <option value="she/her">{t('She/Her')}</option>
            <option value="he/him">{t('He/Him')}</option>
          </select>
        </div>
        
        <h4 className="text-xs font-semibold mt-2">{t('Notification Preferences')}</h4>
        <div>
          <label className="text-xs app-muted block mb-1">{t('Daily Summary Hour (0-23)')}</label>
          <input className="app-input w-full" type="number" min="0" max="23" value={hour} onChange={e => setHour(e.target.value)} />
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} /> {t('Daily Chores')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timers} onChange={e => setTimers(e.target.checked)} /> {t('Timers & Rotations')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supermarket} onChange={e => setSupermarket(e.target.checked)} /> {t('Supermarket Radar')}</label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{t('Vacation Mode')}</div>
            <div className="text-xs app-muted">{t('Skip your turn in all rotations while paused.')}</div>
          </div>
          <button className={`app-btn p-2 text-xs ${isPaused ? 'app-chip-danger' : 'app-card'}`} onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? t('Paused') : t('Active')}
          </button>
        </div>

        <button type="button" className="app-btn app-accent-bg py-2 mt-2" onClick={save} disabled={busy || !name.trim()}>
          {busy ? t('Saving...') : t('Save Personal Settings')}
        </button>
      </div>
    </div>
  );
}

function InviteSection({ current, t }) {
  const [copied, setCopied] = useState(false);
  function copy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t('Invite people')}</h3>
      <div className="app-card app-radius p-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="bg-white p-2 rounded shadow-sm">
            <QRCodeSVG value={current?.groups?.invite_code || ""} size={64} level="L" includeMargin={false} />
          </div>
          <div>
            <div className="text-xs app-muted mb-1">{t('Scan or use code')}</div>
            <div className="text-xl font-mono tracking-widest">{current?.groups?.invite_code || "—"}</div>
          </div>
        </div>
        <button className="app-btn app-card p-2" onClick={() => copy(current?.groups?.invite_code || "")}>
          <Copy size={18} />
        </button>
      </div>
      {copied && <div className="text-xs app-chip-good app-radius px-2 py-1 mt-2 w-fit">{t("Copied")}</div>}
    </div>
  );
}

function CalendarSection({ groupId, t }) {
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    supabase.rpc("get_or_create_calendar_token", { p_group_id: groupId }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setToken(data);
    });
  }, [groupId]);

  const feedUrl = token && CALENDAR_FEED_URL ? `${CALENDAR_FEED_URL}?token=${token}` : null;

  async function rotate() {
    setBusy(true); setError("");
    try {
      const { data, error } = await supabase.rpc("rotate_calendar_token", { p_group_id: groupId });
      if (error) throw error;
      setToken(data);
    } catch (err) { setError(err.message || String(err)); } 
    finally { setBusy(false); }
  }

  function copy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2">{t('See your chores in your own calendar app')}</h3>
      <ErrorBanner error={error} onClose={() => setError("")} />
      <p className="text-xs app-muted mb-2">
        {t("This gives you a private link you can add to Google, Apple, or Outlook Calendar as a read-only \"subscribe by URL\" calendar. Once added, your chores show up there automatically and stay in sync — no separate login needed. Only you can see it, so don't share the link.")}
      </p>
      {feedUrl ? (
        <div className="app-card app-radius p-3 flex items-center gap-2">
          <input className="app-input flex-1 text-xs" readOnly value={feedUrl} onFocus={(e) => e.target.select()} />
          <button className="app-btn app-card p-2" onClick={() => copy(feedUrl)}>
            <Copy size={15} />
          </button>
        </div>
      ) : (
        <div className="text-xs app-muted">
          {t('This deployment has not set up calendar sync yet.')} (<code>VITE_CALENDAR_FEED_URL</code>)
        </div>
      )}
      {copied && <div className="text-xs app-chip-good app-radius px-2 py-1 mt-2 w-fit">{t('Copied')}</div>}
      <button className="app-btn app-card px-3 py-1.5 text-xs mt-2 flex items-center gap-1.5" disabled={busy} onClick={rotate}>
        <RefreshCw size={13} /> {t('Get a new link (the old one stops working)')}
      </button>
    </div>
  );
}
function AdminManagementSection({ groupId, roster, currentUserId, t }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleRole = async (userId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    setBusy(true); setError('');
    try {
      const { error: rpcErr } = await supabase.rpc('set_member_role', {
        p_group_id: groupId,
        p_target_user_id: userId,
        p_new_role: newRole
      });
      if (rpcErr) throw rpcErr;
      // Realtime subscription will refresh memberships.
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold app-muted mb-2">{t('Manage Admins')}</h3>
      <div className="app-card app-radius p-4 flex flex-col gap-3">
        <div className="text-xs app-muted">{t('As the household owner, you can promote members to admins. Admins can edit household settings and manage chores.')}</div>
        <ErrorBanner error={error} onClose={() => setError('')} />
        <div className="flex flex-col gap-2 mt-2">
          {roster.map(member => (
            <div key={member.user_id} className="flex items-center justify-between p-2 app-card app-radius">
              <div className="flex items-center gap-2">
                <IconGlyph icon={member.avatar_url} fallback="👤" size={24} />
                <div>
                  <div className="text-sm font-medium">{member.display_name} {member.user_id === currentUserId && t('(You)')}</div>
                  <div className="text-xs app-muted capitalize">{member.role}</div>
                </div>
              </div>
              {member.role !== 'owner' && (
                <button 
                  className={`app-btn px-3 py-1.5 text-xs ${member.role === 'admin' ? 'app-card' : 'app-accent-bg'}`} 
                  disabled={busy} 
                  onClick={() => toggleRole(member.user_id, member.role)}
                >
                  {member.role === 'admin' ? t('Remove Admin') : t('Make Admin')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


