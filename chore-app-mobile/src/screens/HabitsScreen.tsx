import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { themeLabel, themeLang } from '@/lib/themeLabels';
import { Button, Empty, Notice, Section } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { IconPickerField } from '@/components/ui/IconPickerField';
import { isoDate } from '@/lib/date';

// Habits are personal — not scoped to any group. Every RPC here reads
// auth.uid() server-side, so no groupId is ever passed. Mirrors the web
// implementation's RPC contract exactly.

const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Reminder = { day_of_week: number | null; time_local: string };

export function HabitsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, mode } = useTheme();
  const s = createStyles(colors);

  const [habits, setHabits] = useState<any[]>([]);
  const [settings, setSettings] = useState<{ week_end_day: number }>({ week_end_day: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<any | null>(null); // habit row, or {} for new
  const [historyFor, setHistoryFor] = useState<any | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const [{ data: h, error: hErr }, { data: st }] = await Promise.all([
      supabase.from('habit_summaries').select('*').eq('archived', false).order('sort_order').order('created_at'),
      supabase.from('user_settings').select('*').maybeSingle(),
    ]);
    if (hErr) setMessage(hErr.message);
    setHabits(h ?? []);
    if (st) setSettings(st);
  }, []);

  useEffect(() => {
    load();
    // Keep the server's idea of "where you are" fresh, silently, so the
    // reminder cron's local-hour math uses the right timezone.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) supabase.rpc('touch_my_timezone', { p_timezone: tz });
    } catch {
      /* Intl not available on this device — server falls back to UTC */
    }

    const ch = supabase
      .channel('habits-own-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_completions' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const toggleToday = async (habit: any) => {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('toggle_habit_today', { p_habit_id: habit.id, p_local_date: isoDate() });
      if (error) throw error;
      await load();
    } catch (err: any) {
      setMessage(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const askArchive = (habit: any) => {
    Alert.alert(t('Delete {{name}}?', { name: habit.name }), t('Your streak and history stay, this just hides it from the list.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const { error } = await supabase.rpc('archive_habit', { p_habit_id: habit.id, p_archived: true });
            if (error) throw error;
            await load();
          } catch (err: any) {
            setMessage(err?.message || String(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Notice message={message} error />

      <View style={s.screenHeadRow}>
        <Pressable style={s.roundIconButton} onPress={() => setShowSettings(true)}>
          <Ionicons name="settings-outline" size={18} color={colors.ink} />
        </Pressable>
        <Pressable
          style={[s.roundIconButton, { backgroundColor: colors.accent, borderColor: colors.accent }]}
          onPress={() => setEditing({})}
        >
          <Ionicons name="add" size={20} color={colors.accentInk} />
        </Pressable>
      </View>

      <Section title={themeLabel(themeLang(i18n.language), mode, 'habits', t('Habits'))}>
        {habits.length === 0 ? (
          <Empty text={t('No habits yet — add one you want to build.')} />
        ) : (
          habits.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              busy={busy}
              t={t}
              colors={colors}
              s={s}
              onToggle={() => toggleToday(h)}
              onEdit={() => setEditing(h)}
              onHistory={() => setHistoryFor(h)}
              onArchive={() => askArchive(h)}
            />
          ))
        )}
      </Section>

      {editing && (
        <HabitEditor
          habit={editing}
          t={t}
          colors={colors}
          s={s}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {historyFor && (
        <HabitHistory habit={historyFor} t={t} colors={colors} s={s} onClose={() => setHistoryFor(null)} />
      )}

      {showSettings && (
        <HabitSettingsModal
          settings={settings}
          t={t}
          colors={colors}
          s={s}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false);
            await load();
          }}
        />
      )}
    </ScrollView>
  );
}

function HabitRow({ habit, busy, t, colors, s, onToggle, onEdit, onHistory, onArchive }: any) {
  const isWeekly = habit.frequency === 'weekly';
  const remaining = isWeekly ? Math.max(0, habit.weekly_target - (habit.this_week_count || 0)) : null;
  const isDone = isWeekly ? (habit.this_week_count || 0) >= habit.weekly_target : habit.done_today;

  // Once the weekly target is met, further taps are blocked — except
  // undoing *today's own* completion, which is always allowed.
  const canTap = habit.done_today || !isWeekly || (habit.this_week_count || 0) < habit.weekly_target;

  return (
    <View style={[s.habitRow, isDone && s.habitRowDone]}>
      <View style={s.habitIconWrap}>
        <IconGlyph icon={habit.icon} fallback="✅" size={19} />
      </View>
      <View style={s.habitBody}>
        <Text style={[s.habitName, isDone && s.habitNameDone]} numberOfLines={1}>
          {habit.name}
        </Text>
        <Text style={s.habitFreq}>
          {isWeekly ? t('{{count}}x / week', { count: habit.weekly_target }) : t('Daily')}
        </Text>
      </View>

      {habit.current_streak > 0 && (
        <View style={s.streakBadge}>
          <Ionicons name="flame" size={13} color={colors.accent} />
          <Text style={s.streakText}>{habit.current_streak}</Text>
        </View>
      )}

      {isWeekly && !isDone && (
        <View style={s.remainingBadge}>
          <Text style={s.remainingText}>{remaining}</Text>
        </View>
      )}

      <Pressable style={s.iconButtonSmall} onPress={onHistory}>
        <Ionicons name="time-outline" size={16} color={colors.muted} />
      </Pressable>
      <Pressable style={s.iconButtonSmall} onPress={onEdit}>
        <Ionicons name="pencil-outline" size={16} color={colors.muted} />
      </Pressable>
      <Pressable
        style={[s.toggleCircle, isDone && s.toggleCircleDone]}
        disabled={busy || !canTap}
        onPress={onToggle}
      >
        <Ionicons name="checkmark" size={17} color={isDone ? colors.accentInk : colors.muted} />
      </Pressable>
      <Pressable style={s.iconButtonSmall} onPress={onArchive}>
        <Ionicons name="trash-outline" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

function HabitEditor({ habit, t, colors, s, onClose, onSaved }: any) {
  const isNew = !habit.id;
  const [name, setName] = useState(habit.name || '');
  const [icon, setIcon] = useState(habit.icon || '');
  const [frequency, setFrequency] = useState(habit.frequency || 'daily');
  const [weeklyTarget, setWeeklyTarget] = useState(String(habit.weekly_target || 3));
  const [notificationsEnabled, setNotificationsEnabled] = useState(habit.notifications_enabled ?? true);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  // Daily habits only: a single shared time (day_of_week: null) vs one
  // time per day of the week. Weekly habits always use the per-day form.
  const [dailyMode, setDailyMode] = useState<'same' | 'different'>('same');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isNew) {
      supabase
        .from('habit_reminders')
        .select('*')
        .eq('habit_id', habit.id)
        .then(({ data }) => {
          const loaded: Reminder[] = (data || []).map((r: any) => ({
            day_of_week: r.day_of_week,
            time_local: r.time_local?.slice(0, 5) || '09:00',
          }));
          setReminders(loaded);
          if (habit.frequency === 'daily' && loaded.some((r) => r.day_of_week !== null)) {
            setDailyMode('different');
          }
        });
    }
  }, [habit.id, isNew, habit.frequency]);

  function toggleDay(dow: number) {
    setReminders((rs) => {
      const has = rs.find((r) => r.day_of_week === dow);
      if (has) return rs.filter((r) => r.day_of_week !== dow);
      return [...rs, { day_of_week: dow, time_local: '09:00' }];
    });
  }

  function setDayTime(dow: number | null, time: string) {
    setReminders((rs) => rs.map((r) => (r.day_of_week === dow ? { ...r, time_local: time } : r)));
  }

  function switchDailyMode(next: 'same' | 'different') {
    setDailyMode(next);
    if (next === 'same') {
      const shared = reminders.find((r) => r.day_of_week !== null)?.time_local || '09:00';
      setReminders([{ day_of_week: null, time_local: shared }]);
    } else {
      const existingByDay = Object.fromEntries(reminders.map((r) => [r.day_of_week, r.time_local]));
      const sharedTime = reminders.find((r) => r.day_of_week === null)?.time_local || '09:00';
      setReminders(DAY_LABELS_SHORT.map((_, dow) => ({ day_of_week: dow, time_local: existingByDay[dow] || sharedTime })));
    }
  }

  const dailyReminder = reminders.find((r) => r.day_of_week === null);
  const weeklyReminderDayCount = reminders.filter((r) => r.day_of_week !== null).length;
  const weeklyDayCountMismatch =
    frequency === 'weekly' &&
    weeklyReminderDayCount > 0 &&
    Number(weeklyTarget) > 0 &&
    weeklyReminderDayCount !== Number(weeklyTarget);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      let habitId = habit.id;
      if (isNew) {
        const { data, error } = await supabase.rpc('create_habit', {
          p_name: name.trim(),
          p_icon: icon || null,
          p_frequency: frequency,
          p_weekly_target: frequency === 'weekly' ? Number(weeklyTarget) : null,
          p_notifications_enabled: notificationsEnabled,
        });
        if (error) throw error;
        habitId = data;
      } else {
        const { error } = await supabase.rpc('update_habit', {
          p_habit_id: habit.id,
          p_name: name.trim(),
          p_icon: icon || null,
          p_weekly_target: frequency === 'weekly' ? Number(weeklyTarget) : null,
          p_notifications_enabled: notificationsEnabled,
        });
        if (error) throw error;
      }

      const { error: remErr } = await supabase.rpc('set_habit_reminders', {
        p_habit_id: habitId,
        p_reminders: reminders,
      });
      if (remErr) throw remErr;

      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <ScrollView contentContainerStyle={s.modalContent}>
            <View style={s.modalHeadRow}>
              <Text style={s.modalTitle}>{isNew ? t('New habit') : t('Edit habit')}</Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <Notice message={error} error />

            <View style={s.field}>
              <Text style={s.fieldLabel}>{t('Name')}</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder={t('e.g. Read, Stretch, Call mom')}
                placeholderTextColor="#9AA097"
              />
            </View>

            <IconPickerField label={t('Icon')} value={icon} onChange={setIcon} groupId={null} />

            {isNew && (
              <View style={s.freqRow}>
                {(['daily', 'weekly'] as const).map((f) => (
                  <Pressable
                    key={f}
                    style={[s.choicePill, frequency === f && s.choicePillActive]}
                    onPress={() => setFrequency(f)}
                  >
                    <Text style={[s.choicePillText, frequency === f && s.choicePillTextActive]}>
                      {f === 'daily' ? t('Every day') : t('X times a week')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {frequency === 'weekly' && (
              <View style={s.field}>
                <Text style={s.fieldLabel}>{t('Times per week')}</Text>
                <TextInput
                  style={[s.input, { width: 96 }]}
                  keyboardType="number-pad"
                  value={weeklyTarget}
                  onChangeText={setWeeklyTarget}
                />
              </View>
            )}

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>{t('Notifications for this habit')}</Text>
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ true: colors.accent }}
              />
            </View>

            {notificationsEnabled && (
              <View style={{ gap: 10 }}>
                <Text style={s.fieldLabel}>{frequency === 'daily' ? t('Reminder time') : t('Remind me on')}</Text>

                {frequency === 'daily' ? (
                  <View style={{ gap: 10 }}>
                    <View style={s.freqRow}>
                      {([
                        ['same', t('Same time every day')],
                        ['different', t('Different time per day')],
                      ] as const).map(([key, label]) => (
                        <Pressable
                          key={key}
                          style={[s.choicePill, dailyMode === key && s.choicePillActive]}
                          onPress={() => switchDailyMode(key)}
                        >
                          <Text style={[s.choicePillText, dailyMode === key && s.choicePillTextActive]}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {dailyMode === 'same' ? (
                      <TextInput
                        style={s.timeInput}
                        value={dailyReminder?.time_local || '09:00'}
                        onChangeText={(v) => setReminders([{ day_of_week: null, time_local: v }])}
                        placeholder="09:00"
                      />
                    ) : (
                      <View style={{ gap: 8 }}>
                        {DAY_LABELS_SHORT.map((lbl, dow) => (
                          <View key={dow} style={s.reminderTimeRow}>
                            <Text style={s.reminderDayLabel}>{t(lbl)}</Text>
                            <TextInput
                              style={s.timeInput}
                              value={reminders.find((r) => r.day_of_week === dow)?.time_local || '09:00'}
                              onChangeText={(v) => setDayTime(dow, v)}
                              placeholder="09:00"
                            />
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <View style={s.dayGrid}>
                      {DAY_LABELS_SHORT.map((lbl, dow) => {
                        const on = reminders.some((r) => r.day_of_week === dow);
                        return (
                          <Pressable key={dow} style={[s.dayChip, on && s.dayChipActive]} onPress={() => toggleDay(dow)}>
                            <Text style={[s.dayChipText, on && s.dayChipTextActive]}>{t(lbl)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {reminders
                      .filter((r) => r.day_of_week !== null)
                      .sort((a, b) => (a.day_of_week as number) - (b.day_of_week as number))
                      .map((r) => (
                        <View key={r.day_of_week} style={s.reminderTimeRow}>
                          <Text style={s.reminderDayLabel}>{t(DAY_LABELS_SHORT[r.day_of_week as number])}</Text>
                          <TextInput
                            style={s.timeInput}
                            value={r.time_local}
                            onChangeText={(v) => setDayTime(r.day_of_week, v)}
                            placeholder="09:00"
                          />
                        </View>
                      ))}
                    {weeklyDayCountMismatch && (
                      <View style={s.warnBanner}>
                        <Text style={s.warnBannerText}>
                          {t(
                            "You've set this habit to {{target}}x a week but picked {{days}} reminder day(s) — just making sure that's not an accident.",
                            { target: weeklyTarget, days: weeklyReminderDayCount }
                          )}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            <Button label={t('Save')} onPress={save} disabled={busy || !name.trim()} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function HabitHistory({ habit, t, colors, s, onClose }: any) {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('week');
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => {
    const today = new Date();
    const toStr = isoDate(today);
    const fromDate = new Date(today);
    if (range === 'week') fromDate.setDate(fromDate.getDate() - 7);
    else if (range === 'month') fromDate.setMonth(fromDate.getMonth() - 1);
    else fromDate.setFullYear(fromDate.getFullYear() - 1);
    return { from: isoDate(fromDate), to: toStr };
  }, [range]);

  useEffect(() => {
    setLoading(true);
    supabase
      .rpc('get_habit_history', { p_habit_id: habit.id, p_from: from, p_to: to })
      .then(({ data }: any) => {
        setDates((data || []).map((r: any) => r.completed_date));
        setLoading(false);
      });
  }, [habit.id, from, to]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <ScrollView contentContainerStyle={s.modalContent}>
            <View style={s.modalHeadRow}>
              <Text style={s.modalTitle}>
                {t('History')} · {habit.name}
              </Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <View style={s.freqRow}>
              {([
                ['week', t('Last week')],
                ['month', t('Last month')],
                ['year', t('Last year')],
              ] as const).map(([key, label]) => (
                <Pressable key={key} style={[s.choicePill, range === key && s.choicePillActive]} onPress={() => setRange(key)}>
                  <Text style={[s.choicePillText, range === key && s.choicePillTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
              <Text style={s.muted}>{t('Loading...')}</Text>
            ) : dates.length === 0 ? (
              <Empty text={t('Nothing logged in this period.')} />
            ) : (
              <View style={{ gap: 6 }}>
                {dates.map((d) => (
                  <View key={d} style={s.historyDateRow}>
                    <Ionicons name="checkmark" size={14} color={colors.accent} />
                    <Text style={s.historyDateText}>
                      {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function HabitSettingsModal({ settings, t, colors, s, onClose, onSaved }: any) {
  const [weekEndDay, setWeekEndDay] = useState(settings.week_end_day ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    const { error } = await supabase.rpc('update_my_habit_settings', { p_week_end_day: Number(weekEndDay) });
    setBusy(false);
    if (error) setError(error.message);
    else await onSaved();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <ScrollView contentContainerStyle={s.modalContent}>
            <View style={s.modalHeadRow}>
              <Text style={s.modalTitle}>{t('Habit settings')}</Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <Notice message={error} error />

            <Text style={s.muted}>
              {t(
                "Applies to all your habits, across every group you're in. Notifications are set per habit — edit a habit to choose when it reminds you."
              )}
            </Text>

            <View style={s.field}>
              <Text style={s.fieldLabel}>{t('My week ends on')}</Text>
              <View style={s.dayGrid}>
                {DAY_LABELS_SHORT.map((lbl, i) => (
                  <Pressable
                    key={i}
                    style={[s.dayChip, Number(weekEndDay) === i && s.dayChipActive]}
                    onPress={() => setWeekEndDay(i)}
                  >
                    <Text style={[s.dayChipText, Number(weekEndDay) === i && s.dayChipTextActive]}>{t(lbl)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Button label={t('Save')} onPress={save} disabled={busy} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
