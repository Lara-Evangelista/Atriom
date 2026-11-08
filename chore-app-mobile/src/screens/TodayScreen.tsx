import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { humanDate, isoDate } from '@/lib/date';
import { supabase } from '@/lib/supabase';
import { captureAndUploadChorePhoto } from '@/lib/photos';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useCosmetics } from '@/providers/CosmeticsProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section, Segment } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import type { EventRow } from '@/types/navigation';

export function TodayScreen() {
  const { t } = useTranslation();
  const { user, groupId, roster } = useChoreApp();
  const { triggerEffect } = useCosmetics();
  const { colors } = useTheme();
  const s = createStyles(colors);
  
  const [events, setEvents] = useState<EventRow[]>([]); 
  const [unassignedEvents, setUnassignedEvents] = useState<EventRow[]>([]);
  const [types, setTypes] = useState<any[]>([]); 
  const [runs, setRuns] = useState<any[]>([]); 
  const [runAssignees, setRunAssignees] = useState<Record<string, string[]>>({});
  const [activity, setActivity] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false); 
  const [error, setError] = useState(''); 
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [filter, setFilter] = useState<'today' | 'upcoming'>('today');
  const [timerPickerType, setTimerPickerType] = useState<any | null>(null);
  const [timerMinutes, setTimerMinutes] = useState('60');

  const load = useCallback(async () => {
    if (!user || !groupId) return;
    setError('');
    const throughDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await supabase.rpc('ensure_all_events', { p_group_id: groupId, p_through_date: throughDate }).catch(() => {});

    const [
      { data: allEvents, error: eventsError }, 
      { data: choreTypes, error: typesError }, 
      { data: nextRuns, error: runsError },
      { data: actRows },
    ] = await Promise.all([
      supabase.from('chore_events').select('id,date,status,chore_type_id,group_id,consecutive_delays_count,chore_types(name,icon,has_schedule,requires_photo,is_delayable,max_consecutive_delays,is_rotational),chore_event_assignees(user_id)').eq('status', 'pending').eq('group_id', groupId),
      supabase.from('chore_types').select('*,default_timer_minutes').eq('group_id', groupId).eq('archived', false),
      supabase.from('chore_runs').select('id,status,cycle_ends_at,chore_types(name,icon)').eq('group_id', groupId).in('status', ['pending', 'running']).order('started_at'),
      supabase.from('activity_log').select('id, text, type, created_at').eq('group_id', groupId).order('created_at', { ascending: false }).limit(15),
    ]);
    
    if (eventsError || typesError || runsError) { 
      setError(eventsError?.message ?? typesError?.message ?? runsError?.message ?? t('Could not load chores.')); 
      return; 
    }
    
    // Sort all fetched events
    const sortedEvents = ((allEvents ?? []) as any[]).sort((a, b) => a.date.localeCompare(b.date));
    
    // Events assigned to me
    const myAssignees = sortedEvents.filter(e => e.chore_event_assignees?.some((a: any) => a.user_id === user.id));
    setEvents(myAssignees as EventRow[]);
    
    // Events with NO assignees
    const unassigned = sortedEvents.filter(e => !e.chore_event_assignees || e.chore_event_assignees.length === 0);
    setUnassignedEvents(unassigned as EventRow[]);

    setTypes(choreTypes ?? []);
    setRuns(nextRuns ?? []);
    setActivity(actRows ?? []);

    const runningIds = (nextRuns ?? []).filter((r: any) => r.status === 'running').map((r: any) => r.id);
    if (runningIds.length) {
      const { data: raRows } = await supabase.from('chore_run_assignees').select('chore_run_id, user_id').in('chore_run_id', runningIds);
      const map: Record<string, string[]> = {};
      (raRows ?? []).forEach((row: any) => {
        map[row.chore_run_id] = map[row.chore_run_id] || [];
        map[row.chore_run_id].push(row.user_id);
      });
      setRunAssignees(map);
    } else {
      setRunAssignees({});
    }
  }, [groupId, user]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { 
    setRefreshing(true); 
    await load(); 
    setRefreshing(false); 
  };

  const complete = async (event: EventRow, creditedUserIds?: string[]) => {
    setBusy(event.id);
    const rpcName = event.chore_types?.has_schedule ? 'complete_chore_event' : 'complete_onetime_task';
    try {
      const photoPath = event.chore_types?.requires_photo ? await captureAndUploadChorePhoto(groupId!, event.id) : null;
      if (event.chore_types?.requires_photo && !photoPath) { setBusy(null); return; }
      
      const rpcArgs: any = { p_event_id: event.id, p_photo_url: photoPath };
      if (creditedUserIds && creditedUserIds.length > 0) {
        rpcArgs.p_credited_user_ids = creditedUserIds;
      }
      
      const { error: doneError } = await supabase.rpc(rpcName, rpcArgs);
      if (doneError) { setError(doneError.message); }
      else {
        setSelectedEvent(null);
        triggerEffect();
        load();
        // Fire-and-forget: notify other assignees with pronoun-aware message
        supabase.functions.invoke('notify-completion', {
          body: { eventId: event.id, creditedUserIds: creditedUserIds || [] }
        }).catch(console.warn);
      }
    } catch (err) { 
      setError(err instanceof Error ? err.message : t('Could not complete chore.')); 
    }
    setBusy(null);
  };

  const delayEvent = async (event: EventRow, days: number) => {
    setBusy(event.id);
    try {
      const { error: rpcError } = await supabase.rpc('delay_chore_event', { p_event_id: event.id, p_days: days });
      if (rpcError) setError(rpcError.message); else { setSelectedEvent(null); load(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not delay chore.'));
    }
    setBusy(null);
  };

  const skipEvent = async (event: EventRow) => {
    Alert.alert(
      t("Didn't do it?"),
      t("This turn will disappear from your list. You won't get coins or a leaderboard point for it."),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t("Didn't Do It"),
          style: 'destructive',
          onPress: async () => {
            setBusy(event.id);
            try {
              const { error: rpcError } = await supabase.rpc('skip_chore_event', { p_event_id: event.id });
              if (rpcError) setError(rpcError.message); else { setSelectedEvent(null); load(); }
            } catch (err) {
              setError(err instanceof Error ? err.message : t('Could not skip chore.'));
            }
            setBusy(null);
          },
        },
      ],
    );
  };

  const bump = async (type: any) => { 
    setBusy(type.id); 
    const { error: rpcError } = await supabase.rpc('increment_counter', { p_chore_type_id: type.id, p_amount: 1 }); 
    setBusy(null); 
    if (rpcError) setError(rpcError.message); else load(); 
  };

  const openTimerPicker = (type: any) => {
    setTimerMinutes(String(type.default_timer_minutes || 60));
    setTimerPickerType(type);
  };

  const startTimer = async () => {
    if (!timerPickerType) return;
    const mins = Math.max(1, Number(timerMinutes) || 60);
    setBusy(timerPickerType.id);
    setTimerPickerType(null);
    const { error: rpcError } = await supabase.rpc('start_timer', { p_chore_type_id: timerPickerType.id, p_cycle_minutes: mins, p_assignee_ids: [user?.id] });
    setBusy(null);
    if (rpcError) setError(rpcError.message); else load();
  };

  const finishRun = async (run: any) => { 
    setBusy(run.id); 
    const { error: rpcError } = await supabase.rpc('complete_chore_run', { p_run_id: run.id }); 
    setBusy(null); 
    if (rpcError) setError(rpcError.message); else load(); 
  };

  const nudge = async (event: EventRow) => {
    const assignees: string[] = (event as any).chore_event_assignees?.map((a: any) => a.user_id) || [];
    const others = assignees.filter(id => id !== user?.id);
    if (others.length === 0) return;
    setBusy(event.id);
    try {
      const { error: rpcError } = await supabase.rpc('nudge_assignee', { p_event_id: event.id, p_nudgee_id: others[0] });
      if (rpcError) { setError(rpcError.message); setBusy(null); return; }
      supabase.functions.invoke('notify-nudge', { body: { eventId: event.id, nudgeeId: others[0] } }).catch(console.warn);
      Alert.alert(t('Nudged!'), t('They\'ll get a notification shortly.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not nudge.'));
    }
    setBusy(null);
  };

  const filteredEvents = events.filter(e => filter === 'today' ? e.date <= isoDate() : e.date > isoDate());
  const scheduled = filteredEvents.filter((item) => item.chore_types?.has_schedule); 
  const oneTime = filteredEvents.filter((item) => !item.chore_types?.has_schedule);

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}>
      <Text style={s.date}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      <Notice message={error} error />
      
      <Segment values={[['today', t('Today')], ['upcoming', t('Upcoming')]]} value={filter} onChange={(v) => setFilter(v as 'today' | 'upcoming')} />
      
      <Section title={t('Your rotation')} caption={scheduled.length ? t('{{count}} open', { count: scheduled.length }) : t('All clear')}>
        {scheduled.length ? scheduled.map((event) => <TaskCard key={event.id} event={event} busy={busy === event.id} onPress={() => setSelectedEvent(event)} />) : <Empty text={t('Nothing on your rotation right now.')} />}
      </Section>
      
      <Section title={t('One-time tasks')} caption={oneTime.length ? t('{{count}} open', { count: oneTime.length }) : undefined}>
        {oneTime.length ? oneTime.map((event) => <TaskCard key={event.id} event={event} busy={busy === event.id} onPress={() => setSelectedEvent(event)} />) : <Empty text={t('No one-off tasks waiting on you.')} />}
      </Section>

      {unassignedEvents.length > 0 && (
        <Section title={t('Unassigned')} caption={t('Open for anyone to grab')}>
          {unassignedEvents.map((event) => <TaskCard key={event.id} event={event} busy={busy === event.id} onPress={() => setSelectedEvent(event)} />)}
        </Section>
      )}
      
      <Section title={t('Active cycles')}>
        {runs.length ? runs.map((run) => {
          const names = (runAssignees[run.id] || []).map((uid) => roster.find((r) => r.user_id === uid)?.display_name || t('Someone')).join(', ');
          const status = run.status === 'running' && run.cycle_ends_at
            ? t('{{names}} · Ends {{time}}', { names: names || t('No one'), time: new Date(run.cycle_ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) })
            : t('Hit its limit — first to grab it wins the point.');
          return (
            <View key={run.id} style={s.taskCard}>
              <View style={s.taskIcon}><IconGlyph icon={run.chore_types?.icon} fallback="⏱" /></View>
              <View style={s.taskBody}>
                <Text style={s.taskTitle}>{run.chore_types?.name || t('Cycle')}</Text>
                <Text style={s.taskDue}>{status}</Text>
              </View>
              <Pressable style={[s.checkButton, busy === run.id && s.dim]} onPress={() => finishRun(run)} disabled={busy === run.id}>
                <Ionicons name="checkmark" size={21} color={colors.accentInk} />
              </Pressable>
            </View>
          );
        }) : <Empty text={t('No counter or timer cycle is active.')} />}
      </Section>
      
      <Section title={t('Quick actions')}>
        {types.filter((item) => item.has_counter || item.has_timer).length ? types.filter((item) => item.has_counter || item.has_timer).map((type) => (
          <View key={type.id} style={s.quickRow}>
            <View style={s.taskIcon}><IconGlyph icon={type.icon} /></View>
            <Text style={s.quickName}>{type.name}</Text>
            <Pressable style={s.outlineButton} onPress={() => type.has_counter ? bump(type) : openTimerPicker(type)} disabled={busy === type.id}>
              <Text style={s.outlineText}>{busy === type.id ? '...' : type.has_counter ? '+1' : t('Start')}</Text>
            </Pressable>
          </View>
        )) : <Empty text={t('Counter and timer chores will appear here.')} />}
      </Section>
      
      <Section title={t('Recent activity')}>
        {activity.length ? activity.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}>
            <Text style={[s.muted, { flex: 1 }]}>{a.text}</Text>
            <Text style={s.muted}>{new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
          </View>
        )) : <Empty text={t('Nothing yet.')} />}
      </Section>

      {roster.length > 1 && <Text style={s.footerText}>{t('Shared with {{names}}', { names: roster.map((person) => person.display_name).join(', ') })}</Text>}

      {timerPickerType && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setTimerPickerType(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={[s.taskTitle, { fontSize: 18 }]}>{t('Start timer — {{name}}', { name: timerPickerType.name })}</Text>
                <Pressable onPress={() => setTimerPickerType(null)}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
              </View>
              <Text style={s.muted}>{t('How long should the timer run?')}</Text>
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {[15, 30, 45, 60, 90, 120].map(m => (
                  <Pressable key={m} style={[s.personChip, timerMinutes === String(m) && s.personChipActive]} onPress={() => setTimerMinutes(String(m))}>
                    <Text style={[s.personText, timerMinutes === String(m) && s.personTextActive]}>{m < 60 ? `${m}m` : `${m / 60}h`}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label={t('Custom duration (minutes)')} value={timerMinutes} onChangeText={setTimerMinutes} keyboardType="number-pad" />
              <View style={{ height: 16 }} />
              <Button label={t('Start {{mins}}min timer', { mins: timerMinutes })} onPress={startTimer} disabled={!timerMinutes || Number(timerMinutes) < 1} />
            </View>
          </View>
        </Modal>
      )}

      {selectedEvent && (
        <ChoreDetailModal
          event={selectedEvent}
          roster={roster}
          busy={!!busy}
          onComplete={(creditedIds) => complete(selectedEvent, creditedIds)}
          onDelay={(days) => delayEvent(selectedEvent, days)}
          onSkip={() => skipEvent(selectedEvent)}
          onNudge={nudge}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </ScrollView>
  );
}

function TaskCard({ event, busy, onPress }: { event: EventRow; busy: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const due = event.date === isoDate() ? t('Due today') : event.date < isoDate() ? t('Overdue') : humanDate(event.date);
  
  return (
    <Pressable style={s.taskCard} onPress={onPress} disabled={busy}>
      <View style={s.taskIcon}><IconGlyph icon={event.chore_types?.icon} /></View>
      <View style={s.taskBody}>
        <Text style={s.taskTitle}>{event.chore_types?.name || t('Untitled chore')}</Text>
        <Text style={[s.taskDue, due === t('Overdue') && s.overdue]}>{event.chore_types?.requires_photo ? t('{{due}} · photo required', { due }) : due}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function ChoreDetailModal({ event, roster, busy, onComplete, onDelay, onSkip, onNudge, onClose }: {
  event: EventRow;
  roster: any[];
  busy: boolean;
  onComplete: (creditedIds?: string[]) => void;
  onDelay: (days: number) => void;
  onSkip: () => void;
  onNudge: (event: EventRow) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);
  
  const assignees: string[] = (event as any).chore_event_assignees?.map((a: any) => a.user_id) || [];
  const ct = event.chore_types as any;
  const maxDelays = ct?.max_consecutive_delays;
  const currentDelays = (event as any).consecutive_delays_count ?? 0;
  // max_consecutive_delays === null means unlimited delays (mirrors web's Today.jsx canDelay check) —
  // do not default it to a finite number here, or households configured for unlimited delays get capped.
  const canDelay = !!ct?.is_delayable && (maxDelays === null || maxDelays === undefined || currentDelays < maxDelays);
  const delaysLeft = maxDelays === null || maxDelays === undefined ? Infinity : maxDelays - currentDelays;

  const [mode, setMode] = useState<'actions' | 'delay' | 'together' | 'credit'>('actions');
  const [delayDays, setDelayDays] = useState('1');
  // Whoever is tapping the button is the one crediting it, so default the
  // picker to just them — not the formal assignee list, which may not even
  // include them (e.g. claiming a genuinely unassigned event).
  const [creditedUsers, setCreditedUsers] = useState<string[]>(user?.id ? [user.id] : [...assignees]);

  const toggleCredit = (id: string) => setCreditedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const isOverdue = event.date < isoDate();
  const due = event.date === isoDate() ? t('Due today') : isOverdue ? t('Overdue') : humanDate(event.date);
  // "Didn't do it" only makes sense once the turn is actually overdue, or
  // once delays have run out and the modal would otherwise just say
  // "this chore must be done" with no way forward.
  const canSkip = isOverdue || (canDelay && delaysLeft <= 0);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%' }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <IconGlyph icon={ct?.icon} size={32} photoSize={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.taskTitle, { fontSize: 20 }]}>{ct?.name || t('Chore')}</Text>
                  <Text style={[s.taskDue, due === t('Overdue') && s.overdue]}>{due}</Text>
                </View>
              </View>
              <Pressable onPress={onClose}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
            </View>

            {/* Assignees info */}
            {assignees.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={s.muted}>{t('Assigned to: {{names}}', { names: assignees.map(id => roster.find(r => r.user_id === id)?.display_name || t('Unknown')).join(', ') })}</Text>
              </View>
            )}

            {/* Delay info */}
            {canDelay && currentDelays > 0 && (
              <View style={{ marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: colors.surface }}>
                <Text style={s.taskDue}>{t(currentDelays !== 1 ? 'Delayed {{count}} times' : 'Delayed {{count}} time', { count: currentDelays })}{Number.isFinite(delaysLeft) ? ` (${delaysLeft > 0 ? t('{{count}} left', { count: delaysLeft }) : t('no more delays')})` : ''}</Text>
              </View>
            )}

            {/* Actions mode */}
            {mode === 'actions' && (
              <View style={{ gap: 12 }}>
                <Button label={busy ? t('Working...') : t('Mark Done ✓')} onPress={() => setMode('together')} disabled={busy} />

                {canDelay && delaysLeft > 0 && (
                  <Pressable style={[s.outlineButton, { paddingVertical: 14, alignItems: 'center' }]} onPress={() => setMode('delay')}>
                    <Text style={s.outlineText}>{t('Delay This Chore')}</Text>
                  </Pressable>
                )}

                {canDelay && delaysLeft <= 0 && (
                  <Text style={[s.muted, { textAlign: 'center' }]}>{t('Max delays reached.')}</Text>
                )}

                {canSkip && (
                  <Pressable style={[s.outlineButton, { paddingVertical: 14, alignItems: 'center', borderColor: colors.red }]} onPress={onSkip} disabled={busy}>
                    <Text style={[s.outlineText, { color: colors.red }]}>{t("Didn't Do It")}</Text>
                  </Pressable>
                )}

                {/* Nudge assignees */}
                {assignees.length > 0 && assignees.some(id => id !== user?.id) && (
                  <Pressable 
                    style={[s.outlineButton, { paddingVertical: 14, alignItems: 'center' }]} 
                    onPress={() => onNudge(event)}
                    disabled={busy}
                  >
                    <Text style={s.outlineText}>{t('Nudge Assignee 👋')}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Delay mode */}
            {mode === 'delay' && (
              <View style={{ gap: 12 }}>
                <Text style={s.fieldLabel}>{t('How many days to delay?')}</Text>
                <Field label="" value={delayDays} onChangeText={setDelayDays} keyboardType="number-pad" placeholder="1" />
                <Text style={s.muted}>{t('All future occurrences of this chore will shift forward too, keeping the rotation intact.')}</Text>
                <Button label={busy ? t('Delaying...') : t(Number(delayDays) !== 1 ? 'Delay {{count}} Days' : 'Delay {{count}} Day', { count: delayDays })} onPress={() => onDelay(Number(delayDays) || 1)} disabled={busy} />
                <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setMode('actions')}>
                  <Text style={s.outlineText}>{t('Back')}</Text>
                </Pressable>
              </View>
            )}

            {/* Together mode: alone, or with someone else? Asked for every
                chore type on every completion, not just pre-existing
                multi-person shared chores. */}
            {mode === 'together' && (
              <View style={{ gap: 12 }}>
                <Text style={s.fieldLabel}>{t('Did you do this alone?')}</Text>
                <Button label={busy ? t('Working...') : t('Just me')} onPress={() => onComplete(user?.id ? [user.id] : undefined)} disabled={busy} />
                <Pressable style={[s.outlineButton, { paddingVertical: 14, alignItems: 'center' }]} onPress={() => setMode('credit')} disabled={busy}>
                  <Text style={s.outlineText}>{t('I did this with someone else')}</Text>
                </Pressable>
                <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setMode('actions')}>
                  <Text style={s.outlineText}>{t('Back')}</Text>
                </Pressable>
              </View>
            )}

            {/* Credit mode (shared completion) */}
            {mode === 'credit' && (
              <View style={{ gap: 12 }}>
                <Text style={s.fieldLabel}>{t('Who did this chore?')}</Text>
                <Text style={s.muted}>{t('Select everyone who helped. They\'ll all get credit on the leaderboard.')}</Text>
                <View style={s.people}>
                  {roster.map(person => (
                    <Pressable key={person.user_id} style={[s.personChip, creditedUsers.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => toggleCredit(person.user_id)}>
                      <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />
                      <Text style={[s.personText, creditedUsers.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Button label={busy ? t('Working...') : t('Mark Done ✓')} onPress={() => onComplete(creditedUsers)} disabled={busy || creditedUsers.length === 0} />
                <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setMode('together')}>
                  <Text style={s.outlineText}>{t('Back')}</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

