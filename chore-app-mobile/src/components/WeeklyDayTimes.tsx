import React, { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles, themedFontFamily } from '@/styles/theme';

/**
 * Selected days of the week -> optional time of day.
 *
 * A day being present as a key means "selected". Its value is "HH:MM" when a
 * time was chosen, or null when the chore only cares about the day. This
 * matches the single "Due Time (Optional)" field: a time is never forced.
 */
export type WeeklyMap = { [dayKey: string]: string | null };

// The value written for a selected day that has no time. Kept in one place so
// it is trivial to change if the backend expects a different "no time" value.
export const NO_TIME: null = null;

// Keys follow the RRULE-style numbering already used by advanced_schedule
// (1 = Monday .. 7 = Sunday). Labels come from i18n day.* keys.
export const WEEK_DAYS = [
  { k: '1', l: 'day.mon' },
  { k: '2', l: 'day.tue' },
  { k: '3', l: 'day.wed' },
  { k: '4', l: 'day.thu' },
  { k: '5', l: 'day.fri' },
  { k: '6', l: 'day.sat' },
  { k: '7', l: 'day.sun' },
];

/** Normalise whatever is stored (missing / '' / 'HH:MM' / 'HH:MM:SS') to WeeklyMap. */
export function normalizeWeekly(raw: any): WeeklyMap {
  const out: WeeklyMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v) ? v.slice(0, 5) : NO_TIME;
  }
  return out;
}

/** What to send to the backend: same shape, empty times become NO_TIME. */
export function serializeWeekly(weekly: WeeklyMap): WeeklyMap {
  const out: WeeklyMap = {};
  for (const [k, v] of Object.entries(weekly)) out[k] = v ? v : NO_TIME;
  return out;
}

const toDate = (hhmm: string | null) => {
  const d = new Date();
  if (hhmm) {
    const [h, m] = hhmm.split(':');
    d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  }
  return d;
};
const toHHMM = (d: Date) => d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');

export function WeeklyDayTimes({ value, onChange }: { value: WeeklyMap; onChange: (next: WeeklyMap) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [pickerDay, setPickerDay] = useState<string | null>(null);

  const isSelected = (k: string) => value[k] !== undefined;

  const toggleDay = (k: string) => {
    const next = { ...value };
    if (isSelected(k)) delete next[k];
    else next[k] = NO_TIME; // time is optional: start without one
    onChange(next);
  };
  const setTime = (k: string, hhmm: string | null) => onChange({ ...value, [k]: hhmm });

  return (
    <View style={s.form}>
      <Text style={s.fieldLabel}>{t('Select days and times:')}</Text>
      <Text style={[s.taskDue, { marginBottom: 8 }]}>{t('Pick the days. A time for each day is optional.')}</Text>

      {WEEK_DAYS.map(day => {
        const selected = isSelected(day.k);
        const time = value[day.k] ?? null;
        return (
          <View key={day.k} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable style={[s.personChip, selected && s.personChipActive]} onPress={() => toggleDay(day.k)}>
                <Text
                  style={[s.personText, selected && s.personTextActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {t(day.l)}
                </Text>
              </Pressable>

              {selected && (
                <View style={{ flex: 1, marginLeft: 12 }}>
                  {Platform.OS === 'ios' && time ? (
                    <DateTimePicker
                      value={toDate(time)}
                      mode="time"
                      display="default"
                      onChange={(_e: any, date: any) => date && setTime(day.k, toHHMM(date))}
                    />
                  ) : (
                    <Pressable
                      style={s.input}
                      onPress={() => {
                        if (Platform.OS === 'ios') setTime(day.k, toHHMM(new Date()));
                        else setPickerDay(day.k);
                      }}
                    >
                      <Text style={{ color: time ? colors.ink : colors.muted }}>{time || t('No time set')}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {selected && time ? (
              <Pressable onPress={() => setTime(day.k, NO_TIME)} style={{ marginTop: 4, marginLeft: 4 }}>
                <Text style={{ color: colors.accent, fontSize: 12, fontFamily: themedFontFamily(colors) }}>{t('Clear time')}</Text>
              </Pressable>
            ) : null}

            {Platform.OS !== 'ios' && pickerDay === day.k && (
              <DateTimePicker
                value={toDate(time)}
                mode="time"
                display="default"
                onChange={(_e: any, date: any) => {
                  setPickerDay(null);
                  if (date) setTime(day.k, toHHMM(date));
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
