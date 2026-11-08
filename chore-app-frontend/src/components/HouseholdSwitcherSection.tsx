import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section, Segment } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { humanDate, isoDate, monthLabel } from '@/lib/date';

/*
 * Mobile counterpart to web's HouseholdSwitcher.jsx + MyChoresAcrossGroups.jsx.
 * Web reaches this as a modal from the sidebar; mobile surfaces the same
 * capabilities inline inside Settings > "Your households": switch/reorder
 * households, join/create another one, and see chores or a calendar
 * spanning every household you belong to.
 */

type View = 'households' | 'today' | 'calendar';

export function HouseholdSwitcherSection() {
  const { t } = useTranslation();
  const { memberships, groupId, setGroupId, reorderMemberships, createGroup, joinGroup } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [view, setView] = useState<View>('households');
  const [addMode, setAddMode] = useState<'join' | 'create' | null>(null);
  const [reorderError, setReorderError] = useState('');

  const showTabs = memberships.length > 1;

  const goToGroup = (gid: string) => setGroupId(gid);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= memberships.length) return;
    const next = [...memberships];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setReorderError('');
    reorderMemberships(next).catch((err) => setReorderError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <Section title={t('Your households')}>
      {showTabs && !addMode && (
        <Segment
          values={[
            ['households', t('Households')],
            ['today', t("Today's chores")],
            ['calendar', t('Calendar')],
          ]}
          value={view}
          onChange={(v) => setView(v as View)}
        />
      )}

      {addMode ? (
        <AddHouseholdForm
          mode={addMode}
          onCancel={() => setAddMode(null)}
          onCreate={createGroup}
          onJoin={joinGroup}
          onDone={() => setAddMode(null)}
        />
      ) : view === 'today' ? (
        <MyChoresAcrossGroups onOpenGroup={goToGroup} />
      ) : view === 'calendar' ? (
        <MyCalendarAcrossGroups onOpenGroup={goToGroup} />
      ) : (
        <View>
          <Text style={[s.taskDue, { marginBottom: 8 }]}>{t('Tap to switch. Use the arrows to reorder.')}</Text>
          <Notice message={reorderError} error />
          {memberships.map((membership, index) => (
            <Pressable key={membership.group_id} style={s.moreRow} onPress={() => goToGroup(membership.group_id)}>
              <View style={[s.radio, membership.group_id === groupId && s.radioActive]} />
              <IconGlyph icon={membership.groups?.icon} fallback="🏠" size={16} photoSize={22} />
              <Text style={[s.taskTitle, { flex: 1 }]}>{membership.groups?.name || t('Household')}</Text>
              <Pressable hitSlop={8} disabled={index === 0} onPress={() => move(index, -1)}>
                <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.line : colors.muted} />
              </Pressable>
              <Pressable hitSlop={8} disabled={index === memberships.length - 1} onPress={() => move(index, 1)}>
                <Ionicons name="chevron-down" size={18} color={index === memberships.length - 1 ? colors.line : colors.muted} />
              </Pressable>
            </Pressable>
          ))}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button label={t('Enter a household')} secondary onPress={() => setAddMode('join')} />
            <Button label={t('Create new')} secondary onPress={() => setAddMode('create')} />
          </View>
        </View>
      )}
    </Section>
  );
}

function AddHouseholdForm({
  mode,
  onCancel,
  onCreate,
  onJoin,
  onDone,
}: {
  mode: 'join' | 'create';
  onCancel: () => void;
  onCreate: (name: string, displayName: string) => Promise<void>;
  onJoin: (code: string, displayName: string) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (mode === 'create') await onCreate(name.trim(), displayName.trim());
      else await onJoin(invite.trim(), displayName.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not join that household.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Pressable onPress={onCancel} style={{ marginBottom: 10 }}>
        <Text style={s.back}>{t('Back')}</Text>
      </Pressable>
      {mode === 'create' ? (
        <Field label={t('Household name')} value={name} onChangeText={setName} placeholder={t('Maple Street')} />
      ) : (
        <Field label={t('Invite code')} value={invite} onChangeText={(v) => setInvite(v.toUpperCase())} autoCapitalize="characters" />
      )}
      <Field label={t('Your name')} value={displayName} onChangeText={setDisplayName} placeholder={t('How everyone knows you')} />
      <Notice message={error} error />
      <Button
        label={busy ? t('Working...') : mode === 'create' ? t('Create household') : t('Join household')}
        onPress={submit}
        disabled={busy || !displayName || (mode === 'create' ? !name : !invite)}
      />
    </View>
  );
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Everything assigned to the current user across every household they
// belong to, not scoped to whichever one is "current" — mirrors web's
// MyChoresAcrossGroups.jsx. Quick actions reuse the same per-event RPCs
// as the in-household Today screen.
function MyChoresAcrossGroups({ onOpenGroup }: { onOpenGroup: (gid: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState<'today' | 'upcoming'>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('get_my_chores', { p_since: null, p_until: null });
      if (rpcError) throw rpcError;
      setTasks(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markDone = async (task: any) => {
    if (task.requires_photo) {
      // Photo proof has to happen inside the household itself.
      onOpenGroup(task.group_id);
      return;
    }
    setBusyId(task.event_id);
    try {
      const { error: rpcError } = await supabase.rpc('complete_chore_event', { p_event_id: task.event_id, p_photo_url: null });
      if (rpcError) throw rpcError;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const delay = async (task: any, days: number) => {
    setBusyId(task.event_id);
    try {
      const { error: rpcError } = await supabase.rpc('delay_chore_event', { p_event_id: task.event_id, p_days: days });
      if (rpcError) throw rpcError;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const today = isoToday();
  const filtered = filter === 'today' ? tasks.filter((task) => task.date <= today) : tasks.filter((task) => task.date > today);

  return (
    <View>
      <Notice message={error} error />
      <Segment values={[['today', t('Today & overdue')], ['upcoming', t('Upcoming')]]} value={filter} onChange={(v) => setFilter(v as 'today' | 'upcoming')} />

      {loading ? (
        <Text style={[s.muted, { textAlign: 'center', paddingVertical: 16 }]}>{t('Loading…')}</Text>
      ) : filtered.length === 0 ? (
        <Empty text={filter === 'today' ? t('Nothing due across your households right now.') : t('Nothing coming up yet.')} />
      ) : (
        filtered.map((task) => {
          const overdue = task.date < today;
          const delaysLeft = task.is_delayable ? Math.max(0, (task.max_consecutive_delays || 0) - (task.consecutive_delays_count || 0)) : 0;
          return (
            <View key={task.event_id} style={[s.historyRow, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }} onPress={() => onOpenGroup(task.group_id)}>
                  <IconGlyph icon={task.group_icon} fallback="🏠" size={13} photoSize={18} />
                  <Text style={[s.taskDue, { flex: 1 }]} numberOfLines={1}>{task.group_name}</Text>
                </Pressable>
                <Text style={overdue ? s.overdue : s.taskDue}>
                  {overdue ? t('Overdue') : task.date === today ? t('Today') : task.date}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <IconGlyph icon={task.icon} fallback="📋" />
                <Text style={[s.taskTitle, { flex: 1 }]} numberOfLines={1}>{task.name}</Text>
                {task.requires_photo && <Ionicons name="camera-outline" size={15} color={colors.muted} />}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[s.button, s.buttonCompact]} disabled={busyId === task.event_id} onPress={() => markDone(task)}>
                  <Text style={s.buttonText}>{task.requires_photo ? t('Open to complete') : t('Done')}</Text>
                </Pressable>
                {task.is_delayable && delaysLeft > 0 && (
                  <Pressable style={[s.button, s.buttonCompact, s.buttonSecondary]} disabled={busyId === task.event_id} onPress={() => delay(task, 1)}>
                    <Text style={s.buttonSecondaryText}>{t('Delay a day')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

// A month calendar spanning every household the user belongs to, backed by
// get_my_calendar_month, with quick mark-done / delay / open-household
// actions for the selected day — mirrors web's MyCalendarAcrossGroups.
function MyCalendarAcrossGroups({ onOpenGroup }: { onOpenGroup: (gid: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_my_calendar_month', { p_year: year, p_month: month });
    if (rpcError) setError(rpcError.message);
    else setItems((data ?? {}) as Record<string, any[]>);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelectedDate(null);
    setSelected(null);
  };

  const markDone = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const { error: rpcError } = await supabase.rpc('complete_chore_event', { p_event_id: selected.id, p_photo_url: null });
      if (rpcError) throw rpcError;
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const delay = async (days: number) => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const { error: rpcError } = await supabase.rpc('delay_chore_event', { p_event_id: selected.id, p_days: days });
      if (rpcError) throw rpcError;
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const days = Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
  const offset = new Date(year, month - 1, 1).getDay();
  const dayItems = selectedDate ? items[selectedDate] ?? [] : [];

  return (
    <View>
      <Notice message={error} error />
      <View style={s.monthHeader}>
        <Pressable style={s.monthArrow} onPress={() => shift(-1)}>
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>
        <Text style={s.monthTitle}>{monthLabel(year, month)}</Text>
        <Pressable style={s.monthArrow} onPress={() => shift(1)}>
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </Pressable>
      </View>

      <View style={s.calendar}>
        <View style={s.week}>
          {[t('cal.sun'), t('cal.mon'), t('cal.tue'), t('cal.wed'), t('cal.thu'), t('cal.fri'), t('cal.sat')].map((day, index) => (
            <Text key={`${day}-${index}`} style={s.weekday}>{day}</Text>
          ))}
        </View>
        <View style={s.grid}>
          {Array.from({ length: offset }).map((_, i) => <View key={`blank-${i}`} style={s.dayCell} />)}
          {days.map((day) => {
            const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const count = items[key]?.length ?? 0;
            const isSelected = selectedDate === key;
            return (
              <Pressable key={key} style={[s.dayCell, isSelected && s.daySelected]} onPress={() => { setSelectedDate(key); setSelected(null); }}>
                <Text style={[s.dayNumber, key === isoDate() && s.todayNumber]}>{day}</Text>
                {count > 0 && (
                  <View style={s.dotRow}>
                    {Array.from({ length: Math.min(count, 3) }).map((_, i) => <View key={i} style={s.dot} />)}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Section title={selectedDate ? humanDate(selectedDate) : t('Pick a day')}>
        {!selectedDate ? (
          <Empty text={t('Tap a date to see its chores.')} />
        ) : dayItems.length === 0 ? (
          <Empty text={t('Nothing scheduled for this day.')} />
        ) : (
          dayItems.map((item) => (
            <Pressable key={item.id} style={s.calendarItem} onPress={() => setSelected(item)}>
              <IconGlyph icon={item.icon} fallback="📋" />
              <View style={s.taskBody}>
                <Text style={s.taskTitle}>{item.name}</Text>
                <Pressable onPress={() => onOpenGroup(item.group_id)}>
                  <Text style={s.taskDue}>{item.group_name}</Text>
                </Pressable>
              </View>
              <View style={[s.status, item.status === 'done' && s.statusDone]}>
                <Text style={s.statusText}>{item.status === 'done' ? t('Done') : t('To do')}</Text>
              </View>
            </Pressable>
          ))
        )}

        {selected && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {selected.status === 'pending' && (
              selected.requires_photo ? (
                <Pressable style={[s.button, s.buttonCompact]} onPress={() => onOpenGroup(selected.group_id)}>
                  <Text style={s.buttonText}>{t('Open to complete')}</Text>
                </Pressable>
              ) : (
                <Pressable style={[s.button, s.buttonCompact]} disabled={busy} onPress={markDone}>
                  <Text style={s.buttonText}>{t('Done')}</Text>
                </Pressable>
              )
            )}
            {selected.status === 'pending' && selected.is_delayable && (
              <Pressable style={[s.button, s.buttonCompact, s.buttonSecondary]} disabled={busy} onPress={() => delay(1)}>
                <Text style={s.buttonSecondaryText}>{t('Delay a day')}</Text>
              </Pressable>
            )}
            <Pressable style={[s.button, s.buttonCompact, s.buttonSecondary, { paddingHorizontal: 14 }]} onPress={() => setSelected(null)}>
              <Ionicons name="close" size={16} color={colors.ink} />
            </Pressable>
          </View>
        )}
      </Section>
    </View>
  );
}
