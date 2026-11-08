import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { humanDate, isoDate, monthLabel } from '@/lib/date';
import { supabase } from '@/lib/supabase';
import { captureAndUploadChorePhoto } from '@/lib/photos';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useCosmetics } from '@/providers/CosmeticsProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Notice, Section } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/lib/errors';

export function CalendarScreen() {
  const { t } = useTranslation();
  const { groupId, user, roster } = useChoreApp();
  const { triggerEffect } = useCosmetics();
  const { colors } = useTheme();
  const s = createStyles(colors);
  
  const now = new Date(); 
  const [year, setYear] = useState(now.getFullYear()); 
  const [month, setMonth] = useState(now.getMonth() + 1); 
  const [items, setItems] = useState<Record<string, any[]>>({}); 
  const [error, setError] = useState(''); 
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Did you do this alone?" step, shown before every completion here too --
  // matches the Today screen so this isn't a completion path that skips
  // asking who to credit.
  const [creditItem, setCreditItem] = useState<any | null>(null);
  const [creditMode, setCreditMode] = useState<'together' | 'credit'>('together');
  const [creditedUsers, setCreditedUsers] = useState<string[]>([]);
  const toggleCredit = (id: string) => setCreditedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const load = useCallback(async () => { 
    if (!groupId) return; 
    const { data, error: rpcError } = await supabase.rpc('get_calendar_month', { p_group_id: groupId, p_year: year, p_month: month }); 
    if (rpcError) setError(getErrorMessage(rpcError));
    else setItems((data ?? {}) as Record<string, any[]>); 
  }, [groupId, month, year]);

  useEffect(() => { load(); }, [load]);

  const doMarkDone = async (item: any, creditedIds?: string[]) => {
    setBusyId(item.id);
    setError('');
    try {
      const photoPath = item.requires_photo ? await captureAndUploadChorePhoto(groupId!, item.id) : null;
      if (item.requires_photo && !photoPath) { setBusyId(null); return; }
      // Note: unlike TodayScreen, the calendar API doesn't tell us whether
      // an item came from a scheduled chore type or a one-time task, so it
      // can't branch on chore_types.has_schedule the way TodayScreen does.
      // complete_chore_event has no has_schedule guard in its body, so it
      // already completes either kind correctly -- this matches the RPC
      // this screen was already calling before this change.
      const rpcArgs: any = { p_event_id: item.id, p_photo_url: photoPath };
      if (creditedIds && creditedIds.length > 0) rpcArgs.p_credited_user_ids = creditedIds;
      const { error: rpcError } = await supabase.rpc('complete_chore_event', rpcArgs);
      if (rpcError) throw rpcError;
      triggerEffect();
      setCreditItem(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const markDone = (item: any) => {
    // Same "did you do this alone?" step as the Today screen, for every
    // chore type -- this surface used to skip straight to completing.
    setCreditedUsers(user?.id ? [user.id] : []);
    setCreditMode('together');
    setCreditItem(item);
  };

  const shift = (delta: number) => { 
    const next = new Date(year, month - 1 + delta, 1); 
    setYear(next.getFullYear()); 
    setMonth(next.getMonth() + 1); 
    setSelected(null); 
  };

  const days = Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1); 
  const offset = new Date(year, month - 1, 1).getDay(); 
  const selectedItems = selected ? items[selected] ?? [] : [];

  return (
    <ScrollView contentContainerStyle={s.scroll}>
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
          {[t('day.sun'), t('day.mon'), t('day.tue'), t('day.wed'), t('day.thu'), t('day.fri'), t('day.sat')].map((day, index) => <Text key={`${day}-${index}`} style={s.weekday} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{day}</Text>)}
        </View>
        <View style={s.grid}>
          {Array.from({ length: offset }).map((_, i) => <View key={`blank-${i}`} style={s.dayCell} />)}
          {days.map((day) => { 
            const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; 
            const count = items[key]?.length ?? 0; 
            const isSelected = selected === key; 
            return (
              <Pressable key={key} style={[s.dayCell, isSelected && s.daySelected]} onPress={() => setSelected(key)}>
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

      <Section title={selected ? humanDate(selected) : t('Pick a day')}>
        {selected ? selectedItems.length ? selectedItems.map((item) => (
          <View key={item.id} style={s.calendarItem}>
            <IconGlyph icon={item.icon} />
            <View style={s.taskBody}>
              <Text style={s.taskTitle}>{item.name}</Text>
              <Text style={s.taskDue}>{item.display_name || t('Unassigned')}</Text>
            </View>
            {item.status === 'pending' ? (
              <Pressable style={s.outlineButton} onPress={() => markDone(item)} disabled={busyId === item.id}>
                {item.requires_photo ? (
                  <Ionicons name="camera" size={16} color={colors.ink} />
                ) : (
                  <Ionicons name="checkmark" size={16} color={colors.ink} />
                )}
              </Pressable>
            ) : (
              <View style={[s.status, item.status === 'done' && s.statusDone]}>
                <Text style={s.statusText}>{item.status}</Text>
              </View>
            )}
          </View>
        )) : <Empty text={t('Nothing scheduled for this day.')} /> : <Empty text={t('Tap a date to see its chores.')} />}
      </Section>

      <Modal transparent animationType="slide" visible={!!creditItem} onRequestClose={() => setCreditItem(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            {creditItem && !creditItem.display_name && (
              <Text style={[s.muted, { marginBottom: 12 }]}>{t("It isn't assigned to anyone yet. Marking it done will credit it to you.")}</Text>
            )}

            {creditMode === 'together' && (
              <View style={{ gap: 12 }}>
                <Text style={s.fieldLabel}>{t('Did you do this alone?')}</Text>
                <Button label={busyId === creditItem?.id ? t('Working...') : t('Just me')} onPress={() => creditItem && doMarkDone(creditItem, user?.id ? [user.id] : undefined)} disabled={busyId === creditItem?.id} />
                <Pressable style={[s.outlineButton, { paddingVertical: 14, alignItems: 'center' }]} onPress={() => setCreditMode('credit')} disabled={busyId === creditItem?.id}>
                  <Text style={s.outlineText}>{t('I did this with someone else')}</Text>
                </Pressable>
                <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setCreditItem(null)}>
                  <Text style={s.outlineText}>{t('Back')}</Text>
                </Pressable>
              </View>
            )}

            {creditMode === 'credit' && (
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
                <Button label={busyId === creditItem?.id ? t('Working...') : t('Mark Done ✓')} onPress={() => creditItem && doMarkDone(creditItem, creditedUsers)} disabled={busyId === creditItem?.id || creditedUsers.length === 0} />
                <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setCreditMode('together')}>
                  <Text style={s.outlineText}>{t('Back')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
