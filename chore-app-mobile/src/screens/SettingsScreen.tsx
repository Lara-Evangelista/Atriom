import QRCode from 'react-native-qrcode-svg';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme, themes } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Notice, Section, Segment, Field, Button } from '@/components/ui/primitives';
import { IconPickerField } from '@/components/ui/IconPickerField';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { HouseholdSwitcherSection } from '@/components/HouseholdSwitcherSection';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { useTranslation } from 'react-i18next';

export function SettingsScreen({ onSelectPerson }: { onSelectPerson?: (userId: string, name: string) => void }) {
  const { groupId, currentMembership, roster, signOut, refresh, leaveGroup } = useChoreApp();
  const { mode, colors } = useTheme();
  const s = createStyles(colors);
  const { t, i18n } = useTranslation();

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const isSoleMember = (roster || []).length <= 1;

  const doLeaveGroup = async () => {
    if (!groupId) return;
    setLeaveBusy(true);
    setLeaveError('');
    try {
      await leaveGroup(groupId);
      setConfirmLeave(false);
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : t('Could not leave household.'));
    }
    setLeaveBusy(false);
  };

  return (
    <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>
      <Section title={t('Appearance')}>
        <Text style={s.taskDue}>{t('Your theme is whichever one you have equipped in Rewards \u2192 Cosmetics.')}</Text>
        <Text style={[s.taskTitle, { marginTop: 8 }]}>{themes[mode] ? t(mode.charAt(0).toUpperCase() + mode.slice(1)) : mode}</Text>
      </Section>

      <Section title={t('Navigation')}>
        <Text style={s.taskDue}>{t('Long-press any icon in the tab bar to rearrange it, drag it onto More to hide it, or drag an item out of More onto the tab bar to add it.')}</Text>
      </Section>

      <HouseholdSettingsSection t={t} />
      <LeaderboardPrizesSection t={t} />
      <AdminManagementSection onSelectPerson={onSelectPerson} />


      <Section title={t('Invite people')}>
        <View style={s.invite}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ padding: 8, backgroundColor: 'white', borderRadius: 8, marginRight: 16 }}>
              <QRCode value={currentMembership?.groups?.invite_code || ''} size={80} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>{t('Invite code')}</Text>
              <Text style={s.inviteCode}>{currentMembership?.groups?.invite_code || '—'}</Text>
            </View>
          </View>
          <Text style={[s.muted, { marginTop: 12 }]}>{t('Scan or share this code with the people in your household.')}</Text>
        </View>
      </Section>

      <CalendarSyncSection groupId={groupId} />

      <HouseholdSwitcherSection />
      
      <Section title={t('Household')}>
        <Notice message={leaveError} error />
        {confirmLeave ? (
          <View style={{ gap: 10 }}>
            <Text style={s.taskTitle}>{isSoleMember ? t('Leave and delete this household?') : t('Leave this household?')}</Text>
            <Text style={s.muted}>
              {isSoleMember
                ? t("You're the only member left. Leaving will permanently delete this household — its chores, history, stock, and everything else — for good. This can't be undone.")
                : t("You'll lose access to its chores, stock, and history until someone invites you back.")}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[s.button, { flex: 1, backgroundColor: colors.red }, leaveBusy && s.dim]} onPress={doLeaveGroup} disabled={leaveBusy}>
                <Text style={s.buttonText}>{leaveBusy ? t('Leaving...') : isSoleMember ? t('Yes, delete it') : t('Yes, leave')}</Text>
              </Pressable>
              <Pressable style={[s.outlineButton, { flex: 1 }]} onPress={() => setConfirmLeave(false)} disabled={leaveBusy}>
                <Text style={s.outlineText}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={s.signOut} onPress={() => setConfirmLeave(true)}>
            <Ionicons name="exit-outline" size={18} color={colors.red} />
            <Text style={s.signOutText}>{t('Leave this household')}</Text>
          </Pressable>
        )}
      </Section>


      <Text style={s.footerText}>{t('Native mobile client connected to your existing Chores household.')}</Text>
    </KeyboardAwareScrollView>
  );
}

const CALENDAR_FEED_URL = process.env.EXPO_PUBLIC_CALENDAR_FEED_URL;

function CalendarSyncSection({ groupId }: { groupId: string | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!groupId) return;
    supabase.rpc('get_or_create_calendar_token', { p_group_id: groupId }).then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      else setToken(data);
    });
  }, [groupId]);

  const feedUrl = token && CALENDAR_FEED_URL ? `${CALENDAR_FEED_URL}?token=${token}` : null;

  const rotate = async () => {
    if (!groupId) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('rotate_calendar_token', { p_group_id: groupId });
      if (rpcError) throw rpcError;
      setToken(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('See your chores in your own calendar app')}>
      <Notice message={error} error />
      <Text style={[s.muted, { marginBottom: 8 }]}>
        {t("This gives you a private link you can add to Google, Apple, or Outlook Calendar as a read-only \"subscribe by URL\" calendar. Once added, your chores show up there automatically and stay in sync — no separate login needed. Only you can see it, so don't share the link.")}
      </Text>
      {feedUrl ? (
        <Field label={t('Calendar feed URL')} value={feedUrl} editable={false} selectTextOnFocus />
      ) : (
        <Text style={s.muted}>{t('This deployment has not set up calendar sync yet.')}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {feedUrl && (
          <Pressable style={s.outlineButton} onPress={() => Share.share({ message: feedUrl })}>
            <Text style={s.outlineText}>{t('Share link')}</Text>
          </Pressable>
        )}
        <Pressable style={s.outlineButton} onPress={rotate} disabled={busy}>
          <Text style={s.outlineText}>{busy ? t('Working...') : t('Get a new link (the old one stops working)')}</Text>
        </Pressable>
      </View>
    </Section>
  );
}

function HouseholdSettingsSection({ t }: { t: any }) {
  const { groupId, currentMembership, roster, refresh } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';
  const isOwner = currentMembership?.role === 'owner';

  const [name, setName] = useState(currentMembership?.groups?.name || '');
  const [icon, setIcon] = useState(currentMembership?.groups?.icon || '🏠');
  const [allowEdit, setAllowEdit] = useState(currentMembership?.groups?.allow_anyone_to_edit_chores ?? true);
  const [nudgePolicy, setNudgePolicy] = useState(currentMembership?.groups?.nudge_policy || 'restricted');
  const [notificationLanguage, setNotificationLanguage] = useState(currentMembership?.groups?.notification_language || 'en');
  const [rewardsEnabled, setRewardsEnabled] = useState(currentMembership?.groups?.rewards_enabled ?? false);
  const [maxCoinReward, setMaxCoinReward] = useState(currentMembership?.groups?.max_coin_reward ?? 10);
  const [cosmeticsUnlockedForAll, setCosmeticsUnlockedForAll] = useState(currentMembership?.groups?.cosmetics_unlocked_for_all ?? false);
  const [restrictCoinsToAdmins, setRestrictCoinsToAdmins] = useState(currentMembership?.groups?.restrict_coins_to_admins ?? true);
  const [allowSelfAssignedCoins, setAllowSelfAssignedCoins] = useState(currentMembership?.groups?.allow_self_assigned_coins ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const save = async () => {
    if (!groupId || !isAdmin) return;
    setBusy(true); setNotice('');
    const { error } = await supabase.rpc('update_household_settings', { 
      p_group_id: groupId, 
      p_name: name, 
      p_icon: icon, 
      p_allow_anyone_to_edit_chores: allowEdit,
      p_nudge_policy: nudgePolicy,
      p_notification_language: notificationLanguage,
      p_rewards_enabled: rewardsEnabled,
      p_max_coin_reward: maxCoinReward,
      p_restrict_coins_to_admins: restrictCoinsToAdmins,
      p_allow_self_assigned_coins: allowSelfAssignedCoins,
      p_cosmetics_unlocked_for_all: cosmeticsUnlockedForAll
    });
    if (error) setNotice(error.message);
    else { setNotice(t('Saved.')); await refresh(); }
    setBusy(false);
  };

  return (
    <Section title={t('Household Settings')}>
      <Field label={t('Name')} value={name} onChangeText={setName} placeholder={t('Household Name')} editable={isAdmin} style={!isAdmin ? [s.input, s.dim] : undefined} />
      {isAdmin ? (
        <IconPickerField label={t('Icon (emoji or photo)')} value={icon} onChange={setIcon} groupId={groupId} />
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={[s.fieldLabel, s.dim]}>{t('Icon')}</Text>
          <View style={[s.notificationRow, s.dim]}><IconGlyph icon={icon} /></View>
        </View>
      )}
      
      <View style={s.notificationRow}>
        <View style={s.taskBody}>
          <Text style={s.taskTitle}>{t('Allow anyone to edit')}</Text>
          <Text style={s.taskDue}>{t('If off, only the creator can edit chores.')}</Text>
        </View>
        <Pressable style={[allowEdit ? s.outlineButton : s.button, !isAdmin && s.dim]} onPress={() => setAllowEdit(!allowEdit)} disabled={busy || !isAdmin}>
          <Text style={allowEdit ? s.outlineText : s.buttonText}>{allowEdit ? t('Yes') : t('No')}</Text>
        </Pressable>
      </View>

      <Text style={s.fieldLabel}>{t('Nudge Policy')}</Text>
      <Text style={s.taskDue}>{t('Who can send nudge reminders to assignees.')}</Text>
      <View pointerEvents={isAdmin ? 'auto' : 'none'} style={!isAdmin ? s.dim : undefined}>
        <Segment values={[['off', t('Off')], ['restricted', t('Restricted')], ['everyone', t('Everyone')]]} value={nudgePolicy} onChange={(v) => isAdmin && setNudgePolicy(v as string)} />
      </View>

      <Text style={s.fieldLabel}>{t('Notification Language')}</Text>
      <Text style={s.taskDue}>{t('The language for push notifications about chores.')}</Text>
      <View pointerEvents={isAdmin ? 'auto' : 'none'} style={!isAdmin ? s.dim : undefined}>
        <Segment values={[['en', t('English')], ['pt-PT', t('Portuguese')]]} value={notificationLanguage} onChange={(v) => isAdmin && setNotificationLanguage(v as string)} />
      </View>

      {isOwner && (
        <View style={{ paddingTop: 16, borderTopWidth: 1, borderColor: colors.line, marginTop: 4 }}>
          <Text style={s.fieldLabel}>{t('Rewards System')}</Text>
          <View style={s.notificationRow}>
            <Text style={s.taskTitle}>{t('Enable Rewards & Coins')}</Text>
            <Pressable style={rewardsEnabled ? s.outlineButton : s.button} onPress={() => setRewardsEnabled(!rewardsEnabled)}>
              <Text style={rewardsEnabled ? s.outlineText : s.buttonText}>{rewardsEnabled ? t('On') : t('Off')}</Text>
            </Pressable>
          </View>
          {rewardsEnabled && (
            <>
              <Field label={t('Max Coins per Chore (1-100)')} value={String(maxCoinReward)} onChangeText={(v) => setMaxCoinReward(Math.max(1, Math.min(100, parseInt(v, 10) || 1)))} keyboardType="number-pad" />

              <View style={s.notificationRow}>
                <View style={s.taskBody}>
                  <Text style={s.taskTitle}>{t('Only admins can set coin rewards')}</Text>
                  <Text style={s.taskDue}>{t('If off, any member can put coins on a chore they create.')}</Text>
                </View>
                <Pressable style={restrictCoinsToAdmins ? s.outlineButton : s.button} onPress={() => setRestrictCoinsToAdmins(!restrictCoinsToAdmins)}>
                  <Text style={restrictCoinsToAdmins ? s.outlineText : s.buttonText}>{restrictCoinsToAdmins ? t('Yes') : t('No')}</Text>
                </Pressable>
              </View>

              <View style={s.notificationRow}>
                <View style={s.taskBody}>
                  <Text style={s.taskTitle}>{t('Allow coins on self-assigned chores')}</Text>
                  <Text style={s.taskDue}>{t("If off, no one can put a coin reward on a chore assigned only to themselves. For a rotation, they need at least one other person in it besides themselves.")}</Text>
                </View>
                <Pressable style={allowSelfAssignedCoins ? s.outlineButton : s.button} onPress={() => setAllowSelfAssignedCoins(!allowSelfAssignedCoins)}>
                  <Text style={allowSelfAssignedCoins ? s.outlineText : s.buttonText}>{allowSelfAssignedCoins ? t('Yes') : t('No')}</Text>
                </Pressable>
              </View>
            </>
          )}

          <View style={s.notificationRow}>
            <View style={s.taskBody}>
              <Text style={s.taskTitle}>{t('Unlock all themes & effects for everyone')}</Text>
              <Text style={s.taskDue}>{t("Skip the coin cost on App Cosmetics for every member — handy if you'd rather keep coins purely for real-world rewards, or aren't using coins at all.")}</Text>
            </View>
            <Pressable style={cosmeticsUnlockedForAll ? s.outlineButton : s.button} onPress={() => setCosmeticsUnlockedForAll(!cosmeticsUnlockedForAll)}>
              <Text style={cosmeticsUnlockedForAll ? s.outlineText : s.buttonText}>{cosmeticsUnlockedForAll ? t('On') : t('Off')}</Text>
            </Pressable>
          </View>

          <Text style={s.taskDue}>{t('Saved together with the rest of this form when you press Save Household below.')}</Text>
        </View>
      )}

      <Button label={busy ? t('Saving...') : t('Save Household Settings')} onPress={save} disabled={busy || !name.trim() || !isAdmin} />
      <Notice message={notice} />
    </Section>
  );
}

function LeaderboardPrizesSection({ t }: { t: any }) {
  const { groupId, currentMembership, refresh } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;

  const [weeklyPrize, setWeeklyPrize] = useState(currentMembership?.groups?.weekly_leaderboard_prize_coins ?? 0);
  const [monthlyPrize, setMonthlyPrize] = useState(currentMembership?.groups?.monthly_leaderboard_prize_coins ?? 0);
  const [yearlyPrize, setYearlyPrize] = useState(currentMembership?.groups?.yearly_leaderboard_prize_coins ?? 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  if (!rewardsEnabled) return null;

  const clamp = (v: string) => Math.max(0, Math.min(1000, parseInt(v, 10) || 0));

  const save = async () => {
    if (!groupId || !isAdmin) return;
    setBusy(true); setNotice('');
    const { error } = await supabase.rpc('update_leaderboard_prizes', {
      p_group_id: groupId,
      p_weekly_coins: weeklyPrize,
      p_monthly_coins: monthlyPrize,
      p_yearly_coins: yearlyPrize,
    });
    if (error) setNotice(getErrorMessage(error));
    else { setNotice(t('Saved.')); await refresh(); }
    setBusy(false);
  };

  return (
    <Section title={t('Leaderboard Prizes')}>
      <Text style={s.taskDue}>{t('Award coins automatically to whoever tops the leaderboard each week, month, and year. A prize left at 0 stays off — nothing is paid out for that period. If more than one person ties for the top spot, everyone tied gets the full prize.')}</Text>

      <Field label={t('Weekly prize (coins)')} value={String(weeklyPrize)} onChangeText={(v) => setWeeklyPrize(clamp(v))} keyboardType="number-pad" editable={isAdmin} style={!isAdmin ? [s.input, s.dim] : undefined} />
      <Field label={t('Monthly prize (coins)')} value={String(monthlyPrize)} onChangeText={(v) => setMonthlyPrize(clamp(v))} keyboardType="number-pad" editable={isAdmin} style={!isAdmin ? [s.input, s.dim] : undefined} />
      <Field label={t('Yearly prize (coins)')} value={String(yearlyPrize)} onChangeText={(v) => setYearlyPrize(clamp(v))} keyboardType="number-pad" editable={isAdmin} style={!isAdmin ? [s.input, s.dim] : undefined} />

      {isAdmin && (
        <Button label={busy ? t('Saving...') : t('Save Prizes')} onPress={save} disabled={busy} />
      )}
      {!isAdmin && <Text style={[s.taskDue, s.dim]}>{t('Only admins can set leaderboard prizes.')}</Text>}
      <Notice message={notice} />
    </Section>
  );
}

function AdminManagementSection({ onSelectPerson }: { onSelectPerson?: (userId: string, name: string) => void }) {
  const { t } = useTranslation();
  const { groupId, currentMembership, roster, refresh, refreshRoster } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [busy, setBusy] = useState<string | null>(null);
  const [roleError, setRoleError] = useState('');
  const [roleNotice, setRoleNotice] = useState('');

  if (currentMembership?.role !== 'owner') return null;

  const toggleRole = async (userId: string, currentRole: string, displayName: string) => {
    if (!groupId) return;
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    setBusy(userId); setRoleError(''); setRoleNotice('');
    try {
      const { error } = await supabase.rpc('set_member_role', {
        p_group_id: groupId,
        p_target_user_id: userId,
        p_new_role: newRole
      });
      if (error) throw error;
      await refreshRoster();
      setRoleNotice(newRole === 'admin' ? t('{{name}} is now an admin.', { name: displayName }) : t('{{name}} is no longer an admin.', { name: displayName }));
    } catch (err) {
      setRoleError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const roleLabel = (role: string) => role === 'admin' ? t('Admin') : role === 'owner' ? t('Owner') : t('Member');

  return (
    <Section title={t('Manage Admins')}>
      <Text style={s.taskDue}>{t('As the household owner, you can promote members to admins. Admins can edit household settings and manage chores.')}</Text>
      <Notice message={roleNotice} />
      <Notice message={roleError} error />
      <View style={{ height: 16 }} />
      {roster.map(member => (
        <View key={member.user_id} style={s.notificationRow}>
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
            onPress={() => member.user_id !== currentMembership.user_id && onSelectPerson?.(member.user_id, member.display_name)}
            disabled={member.user_id === currentMembership.user_id}
          >
            <IconGlyph icon={member.avatar_url} fallback="👤" size={15} photoSize={26} />
            <View style={s.taskBody}>
              <Text style={s.taskTitle}>{member.display_name} {member.user_id === currentMembership.user_id && t('(You)')}</Text>
              <Text style={s.taskDue}>{roleLabel(member.role)}</Text>
            </View>
          </Pressable>
          {member.role !== 'owner' && (
            <Pressable 
              style={member.role === 'admin' ? s.outlineButton : s.button} 
              onPress={() => toggleRole(member.user_id, member.role, member.display_name)}
              disabled={busy === member.user_id}
            >
              <Text style={member.role === 'admin' ? s.outlineText : s.buttonText}>
                {member.role === 'admin' ? t('Remove Admin') : t('Make Admin')}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
    </Section>
  );
}

