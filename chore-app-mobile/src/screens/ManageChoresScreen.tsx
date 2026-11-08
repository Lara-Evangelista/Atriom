import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles, themedFontFamily } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section, Segment } from '@/components/ui/primitives';
import { IconPickerField } from '@/components/ui/IconPickerField';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { getErrorMessage } from '@/lib/errors';
import { WeeklyDayTimes, WeeklyMap, normalizeWeekly, serializeWeekly } from '@/components/WeeklyDayTimes';
import { ResourceUsageEditor, resourceMapToArrays } from '@/components/ResourceUsageEditor';

export function ManageChoresScreen() {
  const { t } = useTranslation();
  const { groupId, roster, currentMembership, user } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;
  const maxCoins = currentMembership?.groups?.max_coin_reward;
  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';
  const restrictCoinsToAdmins = currentMembership?.groups?.restrict_coins_to_admins ?? true;
  const allowSelfAssignedCoins = !!currentMembership?.groups?.allow_self_assigned_coins;
  const canSetCoins = rewardsEnabled && (isAdmin || !restrictCoinsToAdmins);
  const currentUserId = user?.id;

  const [types, setTypes] = useState<any[]>([]);
  const [onetimeTasks, setOnetimeTasks] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!groupId) return;
    const throughDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await supabase.rpc('ensure_all_events', { p_group_id: groupId, p_through_date: throughDate }).catch(() => {});

    const [{ data: allTypes }, { data: events }, { data: res }] = await Promise.all([
      supabase.from('chore_types').select('id, group_id, name, icon, requires_photo, has_schedule, has_counter, has_timer, is_onetime, schedule_interval_days, counter_threshold, advanced_schedule, is_rotational, is_delayable, max_consecutive_delays, coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard, created_by, chore_type_rotation(user_id, sort_order), chore_type_resources(resource_id, qty_per_completion)').eq('group_id', groupId).eq('archived', false).order('name'),
      supabase.from('chore_events').select('id, date, chore_type_id, chore_types(id, group_id, name, icon, requires_photo, has_schedule, has_counter, has_timer, is_onetime, archived, counts_for_leaderboard), chore_event_assignees(user_id)').eq('group_id', groupId).eq('status', 'pending').order('date'),
      supabase.from('resources').select('id, name, unit').eq('group_id', groupId).order('name'),
    ]);

    // is_onetime is the single source of truth for "recurring definition you
    // manage" vs. "single-use task with one due date" — NOT has_timer, which
    // a one-time task can also carry (e.g. "run this one load of laundry as
    // a timer"). Building both lists off one shared `claimed` set also makes
    // it structurally impossible for the same chore_type to ever render in
    // both places at once (the bug where deleting one card silently deleted
    // a "duplicate" card too, because they were really the same underlying
    // chore_type shown twice).
    const recurringTypes = (allTypes || []).filter(t => !t.is_onetime && (t.has_schedule || t.has_counter || t.has_timer));
    setTypes(recurringTypes);

    const claimed = new Set(recurringTypes.map(t => t.id));
    const onetime = [];
    for (const ev of (events || []) as any[]) {
      const ct = ev.chore_types;
      if (!ct || ct.archived || !ct.is_onetime) continue;
      if (claimed.has(ct.id)) continue;
      claimed.add(ct.id);
      onetime.push(ev);
    }
    setOnetimeTasks(onetime);
    setResources(res || []);
  }, [groupId]);

  const nameFor = (userId: string) => roster.find((r: any) => r.user_id === userId)?.display_name || t('Someone');

  useEffect(() => { load(); }, [load]);

  const runAction = async (fn: () => Promise<void>, successMsg: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await fn();
      setNotice(successMsg);
      setEditingKey(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const askDeleteType = (id: string, name: string) => {
    Alert.alert(t('Delete {{name}}?', { name }), t('Past history and points are kept. Only future occurrences are removed.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => runAction(async () => {
        const { error } = await supabase.rpc('archive_chore_type', { p_chore_type_id: id });
        if (error) throw error;
      }, t('Chore deleted.')) }
    ]);
  };

  const askDeleteOnetime = (id: string, name: string) => {
    Alert.alert(t('Delete {{name}}?', { name }), t('This one-time task will be removed.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => runAction(async () => {
        const { error } = await supabase.rpc('delete_onetime_task', { p_event_id: id });
        if (error) throw error;
      }, t('Task deleted.')) }
    ]);
  };

  return (
    <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>
      <Notice message={notice} />
      <Notice message={error} error />
      
      <Section title={t('Active Chores')}>
        {types.length === 0 && onetimeTasks.length === 0 ? <Empty text={t('No active chores to manage.')} /> : null}
        
        {types.map(ct => {
          const key = `type-${ct.id}`;
          const isEditing = editingKey === key;
          
          if (isEditing) {
            return <EditChoreCard key={key} chore={ct} roster={roster} resources={resources} rewardsEnabled={rewardsEnabled} maxCoins={maxCoins} canSetCoins={canSetCoins} allowSelfAssignedCoins={allowSelfAssignedCoins} currentUserId={currentUserId} onSave={(fn: () => Promise<void>, msg: string) => runAction(fn, msg)} onCancel={() => setEditingKey(null)} busy={busy} />;
          }

          const subtitle = ct.has_schedule ? t('Every {{count}} day(s)', { count: ct.schedule_interval_days }) : ct.has_counter ? t('Triggers at {{count}}', { count: ct.counter_threshold }) : t('Timer / Cycle');
          const rotationNames = [...(ct.chore_type_rotation || [])]
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((r: any) => nameFor(r.user_id));
          const whoLabel = rotationNames.length ? t('Rotation: {{names}}', { names: rotationNames.join(', ') }) : t('Unassigned — open to anyone');

          return (
            <View key={key} style={s.taskCard}>
              <View style={s.taskIcon}><IconGlyph icon={ct.icon} /></View>
              <View style={s.taskBody}>
                <Text style={s.taskTitle}>{ct.name}</Text>
                <Text style={s.taskDue}>{subtitle}</Text>
                <Text style={s.muted}>{whoLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable style={s.outlineButton} onPress={() => setEditingKey(key)}><Ionicons name="pencil" size={16} color={colors.ink} /></Pressable>
                <Pressable style={s.outlineButton} onPress={() => askDeleteType(ct.id, ct.name)}><Ionicons name="trash" size={16} color={colors.red} /></Pressable>
              </View>
            </View>
          );
        })}
        
        {onetimeTasks.map(ev => {
          const key = `onetime-${ev.id}`;
          const ct = ev.chore_types;
          const isEditing = editingKey === key;

          if (isEditing) {
            return <EditOnetimeCard key={key} event={ev} roster={roster} onSave={(fn: () => Promise<void>, msg: string) => runAction(fn, msg)} onCancel={() => setEditingKey(null)} busy={busy} />;
          }

          const assigneeIds = (ev.chore_event_assignees || []).map((a: any) => a.user_id);
          const assigneeCount = assigneeIds.length;
          const whoLabel = assigneeCount === 0
            ? t('Unassigned — open to anyone')
            : assigneeCount > 1
              ? t('Offered to {{names}}', { names: assigneeIds.map(nameFor).join(', ') })
              : t('Assigned to {{name}}', { name: nameFor(assigneeIds[0]) });
          return (
            <View key={key} style={s.taskCard}>
              <View style={s.taskIcon}><IconGlyph icon={ct.icon} /></View>
              <View style={s.taskBody}>
                <Text style={s.taskTitle}>{ct.name}</Text>
                <Text style={s.taskDue}>{t('Due {{date}}', { date: ev.date })}</Text>
                <Text style={s.muted}>{whoLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable style={s.outlineButton} onPress={() => setEditingKey(key)}><Ionicons name="pencil" size={16} color={colors.ink} /></Pressable>
                <Pressable style={s.outlineButton} onPress={() => askDeleteOnetime(ev.id, ct.name)}><Ionicons name="trash" size={16} color={colors.red} /></Pressable>
              </View>
            </View>
          );
        })}
      </Section>
    </KeyboardAwareScrollView>
  );
}

// Keys match the RRULE-style weekday numbering already used by
// advanced_schedule (1=Monday .. 7=Sunday). Labels are looked up through
// i18n's day.* keys so this always shows real, translated day names
// instead of literal translation keys.
const DAYS = [
  { k: '1', l: 'day.mon' },
  { k: '2', l: 'day.tue' },
  { k: '3', l: 'day.wed' },
  { k: '4', l: 'day.thu' },
  { k: '5', l: 'day.fri' },
  { k: '6', l: 'day.sat' },
  { k: '7', l: 'day.sun' },
];

function EditChoreCard({ chore, roster, resources, rewardsEnabled, maxCoins, canSetCoins, allowSelfAssignedCoins, currentUserId, onSave, onCancel, busy }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  
  const [name, setName] = useState(chore.name);
  const [icon, setIcon] = useState(chore.icon || '🧹');
  const [requiresPhoto, setRequiresPhoto] = useState(chore.requires_photo || false);
  const [intervalDays, setIntervalDays] = useState(String(chore.schedule_interval_days || 7));
  const [people, setPeople] = useState<string[]>(() => [...(chore.chore_type_rotation || [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((r: any) => r.user_id));
  const [threshold, setThreshold] = useState(String(chore.counter_threshold || 5));

  // New fields
  const [scheduleType, setScheduleType] = useState(chore.advanced_schedule ? 'weekly' : 'interval');
  const [weekly, setWeekly] = useState<WeeklyMap>(normalizeWeekly(chore.advanced_schedule));
  const [isRotational, setIsRotational] = useState(chore.is_rotational ?? true);
  const [isDelayable, setIsDelayable] = useState(chore.is_delayable ?? true);
  const [maxDelays, setMaxDelays] = useState(String(chore.max_consecutive_delays ?? 3));
  const [resourceMap, setResourceMap] = useState<{ [id: string]: string }>(() => Object.fromEntries((chore.chore_type_resources || []).map((r: any) => [r.resource_id, String(r.qty_per_completion)])));
  const [coinReward, setCoinReward] = useState(String(chore.coin_reward ?? 1));
  const [requiresApproval, setRequiresApproval] = useState(chore.requires_approval ?? false);
  const [dueTime, setDueTime] = useState(chore.due_time || '');
  const [showDueTimePicker, setShowDueTimePicker] = useState(false);
  const [overdueNudge, setOverdueNudge] = useState(chore.overdue_nudge_interval_minutes ? String(chore.overdue_nudge_interval_minutes) : '');
  const [countsForLeaderboard, setCountsForLeaderboard] = useState(chore.counts_for_leaderboard ?? true);


  const addPersonSequence = (id: string) => setPeople(prev => [...prev, id]);
  const removePersonSequence = (index: number) => setPeople(prev => prev.filter((_: any, i: number) => i !== index));
  const togglePersonShared = (id: string) => setPeople(prev => prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]);

  // Same self-assignment rule as web/create: can't set coins on a rotation
  // that's only you.
  const selfAssignmentBlocksCoins = (peopleList: string[]) => {
    if (allowSelfAssignedCoins) return false;
    if (!currentUserId) return false;
    return peopleList.includes(currentUserId) && peopleList.length < 2;
  };
  const coinsBlockedBySelfAssignment = selfAssignmentBlocksCoins(people);
  const canEditCoins = canSetCoins && !coinsBlockedBySelfAssignment;

  const save = () => {
    onSave(async () => {
      const { error: e1 } = await supabase.rpc('update_chore_details', { p_chore_type_id: chore.id, p_name: name, p_icon: icon });
      if (e1) throw e1;

      const { ids, qtys } = resourceMapToArrays(resourceMap);
      const { error: e2 } = await supabase.rpc('update_chore_resources', { p_chore_type_id: chore.id, p_resource_ids: ids, p_qtys: qtys });
      if (e2) throw e2;

      if (chore.has_schedule) {
        const advSched = scheduleType === 'weekly' ? serializeWeekly(weekly) : null;
        // If coins aren't editable here because this became self-only and
        // self-assigned coins aren't allowed, explicitly clear the reward
        // rather than leaving it as-is — leaving it as-is would send no
        // change, and the server would then reject the whole save because
        // the *existing* stored reward still violates policy against the
        // new roster. Otherwise (blocked only by admin restriction, roster
        // itself is fine), leave the existing value untouched.
        const coinRewardToSend = coinsBlockedBySelfAssignment ? 0 : (canEditCoins ? Number(coinReward) : null);
        const { error } = await supabase.rpc('update_chore_schedule', {
          p_chore_type_id: chore.id,
          p_interval_days: scheduleType === 'interval' ? Number(intervalDays) : 1,
          p_user_ids: people,
          p_requires_photo: requiresPhoto,
          p_advanced_schedule: advSched,
          p_is_rotational: isRotational,
          p_is_delayable: isDelayable,
          p_max_consecutive_delays: isDelayable ? Number(maxDelays) : null,
          p_coin_reward: coinRewardToSend,
          p_requires_approval: requiresApproval,
          p_due_time: dueTime || null,
          p_overdue_nudge_interval_minutes: overdueNudge ? Number(overdueNudge) : null,
          p_counts_for_leaderboard: countsForLeaderboard,
        });
        if (error) throw error;
      } else if (chore.has_counter) {
        const { error: te } = await supabase.rpc('update_counter_threshold', { p_chore_type_id: chore.id, p_threshold: Number(threshold) });
        if (te) throw te;
        const { error: pe } = await supabase.from('chore_types').update({ requires_photo: requiresPhoto, counts_for_leaderboard: countsForLeaderboard }).eq('id', chore.id);
        if (pe) throw pe;
      } else {
        const { error: pe } = await supabase.from('chore_types').update({ requires_photo: requiresPhoto, counts_for_leaderboard: countsForLeaderboard }).eq('id', chore.id);
        if (pe) throw pe;
      }
    }, t('Saved changes.'));
  };

  return (
    <View style={[s.taskCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={s.sectionTitle}>{t('Edit Chore')}</Text>
        <Pressable onPress={onCancel}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
      </View>
      
      <Field label={t('Name')} value={name} onChangeText={setName} />
      <IconPickerField label={t('Icon (emoji or photo)')} value={icon} onChange={setIcon} groupId={chore.group_id} />
      
      {chore.has_schedule && (
        <>
          <View style={{ height: 12 }} />
          <Segment values={[['interval', t('Every X Days')], ['weekly', t('Specific Days & Times')]]} value={scheduleType} onChange={(v) => setScheduleType(v as string)} />
          <View style={{ height: 12 }} />

          {scheduleType === 'interval' ? (
            <Field label={t('Interval (Days)')} value={intervalDays} onChangeText={setIntervalDays} keyboardType="number-pad" />
          ) : (
            <WeeklyDayTimes value={weekly} onChange={setWeekly} />
          )}

          <View style={{ height: 16 }} />
          <Segment values={[['true', t('Rotational (Turns)')], ['false', t('Shared (Everyone)')]]} value={String(isRotational)} onChange={(v) => setIsRotational(v === 'true')} />
          <View style={{ height: 12 }} />

          {isRotational ? (
            <View>
              <Text style={s.muted}>{t('Tap to append to sequence. Tap sequence to remove.')}</Text>
              <View style={s.people}>
                {roster.map((person: any) => (
                  <Pressable key={person.user_id} style={[s.outlineButton, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => addPersonSequence(person.user_id)}>
                    <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />
                    <Text style={s.outlineText}>+ {person.display_name}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ marginTop: 8 }}>
                {people.map((id: string, index: number) => {
                  const p = roster.find((r: any) => r.user_id === id);
                  return (
                    <Pressable key={`${id}-${index}`} style={s.moreRow} onPress={() => removePersonSequence(index)}>
                      <IconGlyph icon={p?.avatar_url} fallback="👤" size={15} photoSize={20} />
                      <Text style={[s.taskTitle, { flex: 1 }]}>{index + 1}. {p?.display_name || t('Unknown')}</Text>
                      <Text style={s.taskDue}>{t('Remove')}</Text>
                    </Pressable>
                  );
                })}
                {people.length === 0 && <Text style={s.muted}>{t('No sequence yet.')} {t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}
              </View>
            </View>
          ) : (
            <View style={s.people}>
              {roster.map((person: any) => (
                <Pressable key={person.user_id} style={[s.personChip, people.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => togglePersonShared(person.user_id)}>
                  <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />
                  <Text style={[s.personText, people.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>
                </Pressable>
              ))}
              {people.length === 0 && <Text style={[s.muted, { marginTop: 8 }]}>{t('No one selected.')} {t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}
            </View>
          )}

          <View style={{ height: 16 }} />
          <Text style={s.fieldLabel}>{t('Delay Settings')}</Text>
          <Pressable style={s.quickRow} onPress={() => setIsDelayable(!isDelayable)}>
            <View style={[s.radio, isDelayable && s.radioActive]} />
            <Text style={s.taskTitle}>{t('Can be delayed')}</Text>
          </Pressable>
          {isDelayable && (
            <Field label={t('Max consecutive delays')} value={maxDelays} onChangeText={setMaxDelays} keyboardType="number-pad" />
          )}

          <View style={{ height: 16 }} />
          <Text style={s.fieldLabel}>{t('Rewards & Timing')}</Text>
          {!rewardsEnabled ? (
            <Text style={s.taskDue}>{t('Coin rewards are off. Turn on "Rewards & Coins" in Settings to assign coins to this chore.')}{chore.coin_reward > 0 ? ` ${t('(Currently {{count}}, unchanged.)', { count: chore.coin_reward })}` : ''}</Text>
          ) : !canSetCoins ? (
            <Text style={s.taskDue}>{t('Only admins can set coin rewards on chores in this household.')}{chore.coin_reward > 0 ? ` ${t('(Currently {{count}}, unchanged.)', { count: chore.coin_reward })}` : ''}</Text>
          ) : coinsBlockedBySelfAssignment ? (
            <Text style={s.taskDue}>{t("You're in this rotation alone — this household doesn't allow self-assigned coins, so saving will clear its coin reward. Add another person to keep it.")}{chore.coin_reward > 0 ? ` ${t('(Currently {{count}}.)', { count: chore.coin_reward })}` : ''}</Text>
          ) : (
            <Field label={maxCoins ? `${t('Coin reward')} ${t('(max {{max}})', { max: maxCoins })}` : t('Coin reward')} value={coinReward} onChangeText={setCoinReward} keyboardType="number-pad" />
          )}
          <Pressable style={s.quickRow} onPress={() => setRequiresApproval(!requiresApproval)}>
            <View style={[s.radio, requiresApproval && s.radioActive]} />
            <Text style={s.taskTitle}>{t('Requires admin approval')}</Text>
          </Pressable>
          <View style={{ marginBottom: 16 }}>
            <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Due Time (Optional)')}</Text>
            <Text style={[s.taskDue, { marginBottom: 8 }]}>{t('The clock time this chore is due each day. Leave blank if only the date matters.')}</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={dueTime ? (function(){ const [h,m]=dueTime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => date && setDueTime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0"))} />
            ) : (
              <>
                <Pressable style={s.input} onPress={() => setShowDueTimePicker(true)}>
                  <Text style={{ color: dueTime ? colors.ink : colors.muted }}>{dueTime || 'No time set'}</Text>
                </Pressable>
                {showDueTimePicker && (
                  <DateTimePicker value={dueTime ? (function(){ const [h,m]=dueTime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => { setShowDueTimePicker(false); if (date) setDueTime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0")); }} />
                )}
              </>
            )}
            {dueTime ? (
              <Pressable onPress={() => setDueTime('')} style={{ marginTop: 8 }}><Text style={{ color: colors.accent, fontSize: 12, fontFamily: themedFontFamily(colors) }}>{t('Clear time')}</Text></Pressable>
            ) : null}
          </View>
          <Field label={t('Overdue nudge interval (minutes, optional)')} value={overdueNudge} onChangeText={setOverdueNudge} keyboardType="number-pad" placeholder={t('e.g. 30')} />
          <Text style={[s.taskDue, { marginTop: -8, marginBottom: 8 }]}>{t("Once this chore is overdue (past its due time), how often to automatically re-nudge the assignee — not part of when it's due.")}</Text>
        </>
      )}

      {chore.has_counter && (
        <Field label={t('Trigger at')} value={threshold} onChangeText={setThreshold} keyboardType="number-pad" />
      )}
      
      <Pressable style={s.quickRow} onPress={() => setRequiresPhoto(!requiresPhoto)}>
        <View style={[s.radio, requiresPhoto && s.radioActive]} />
        <Text style={s.taskTitle}>{t('Require photo')}</Text>
      </Pressable>

      <Pressable style={s.quickRow} onPress={() => setCountsForLeaderboard(!countsForLeaderboard)}>
        <View style={[s.radio, countsForLeaderboard && s.radioActive]} />
        <Text style={s.taskTitle}>{t('Counts toward the leaderboard')}</Text>
      </Pressable>
      <Text style={s.taskDue}>{t('Leaderboard totals are recalculated live, so this applies to past completions too, not just future ones.')}</Text>

      <ResourceUsageEditor resources={resources} value={resourceMap} onChange={setResourceMap} />

      <View style={{ height: 8 }} />
      <Button label={busy ? t('Saving...') : t('Save')} onPress={save} disabled={busy || !name.trim()} />
    </View>
  );
}

function EditOnetimeCard({ event, roster, onSave, onCancel, busy }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const ct = event.chore_types;

  const [name, setName] = useState(ct.name);
  const [icon, setIcon] = useState(ct.icon || '🧹');
  const [requiresPhoto, setRequiresPhoto] = useState(ct.requires_photo || false);
  const [dueDate, setDueDate] = useState(event.date);
  const [people, setPeople] = useState<string[]>(() => (event.chore_event_assignees || []).map((a: any) => a.user_id));
  const [countsForLeaderboard, setCountsForLeaderboard] = useState(ct.counts_for_leaderboard ?? true);

  const togglePerson = (id: string) => setPeople(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const save = () => {
    onSave(async () => {
      const { error: e1 } = await supabase.rpc('update_chore_details', { p_chore_type_id: ct.id, p_name: name, p_icon: icon });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('chore_types').update({ requires_photo: requiresPhoto }).eq('id', ct.id);
      if (e2) throw e2;
      const { error: e3 } = await supabase.rpc('update_onetime_task', { p_event_id: event.id, p_assignee_ids: people, p_due_date: dueDate || null, p_counts_for_leaderboard: countsForLeaderboard });
      if (e3) throw e3;
    }, t('Saved changes.'));
  };

  return (
    <View style={[s.taskCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={s.sectionTitle}>{t('Edit One-time Task')}</Text>
        <Pressable onPress={onCancel}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
      </View>

      <Field label={t('Name')} value={name} onChangeText={setName} />
      <IconPickerField label={t('Icon (emoji or photo)')} value={icon} onChange={setIcon} groupId={ct.group_id} />
      <Field label={t('Due date (YYYY-MM-DD)')} value={dueDate} onChangeText={setDueDate} placeholder="2026-09-15" />

      <View style={{ height: 8 }} />
      <Text style={s.fieldLabel}>{t('Assign to')}</Text>
      <View style={s.people}>
        {roster.map((person: any) => (
          <Pressable key={person.user_id} style={[s.personChip, people.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => togglePerson(person.user_id)}>
            <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />
            <Text style={[s.personText, people.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 8 }} />
      <Pressable style={s.quickRow} onPress={() => setRequiresPhoto(!requiresPhoto)}>
        <View style={[s.radio, requiresPhoto && s.radioActive]} />
        <Text style={s.taskTitle}>{t('Require photo')}</Text>
      </Pressable>

      <Pressable style={s.quickRow} onPress={() => setCountsForLeaderboard(!countsForLeaderboard)}>
        <View style={[s.radio, countsForLeaderboard && s.radioActive]} />
        <Text style={s.taskTitle}>{t('Counts toward the leaderboard')}</Text>
      </Pressable>

      <Button label={busy ? t('Saving...') : t('Save')} onPress={save} disabled={busy || !name.trim()} />
    </View>
  );
}
