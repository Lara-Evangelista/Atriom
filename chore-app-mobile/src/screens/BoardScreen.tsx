import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isoDate } from '@/lib/date';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles, themedFontFamily } from '@/styles/theme';
import { Empty, Notice, Section, Segment } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';

function getBounds(range: string) {
  const now = new Date();
  let since = "", until = "";
  if (range === "week") {
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    since = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    until = sunday.toISOString().slice(0, 10);
  } else if (range === "month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    since = firstDay.toISOString().slice(0, 10);
    until = lastDay.toISOString().slice(0, 10);
  } else if (range === "year") {
    const firstDay = new Date(now.getFullYear(), 0, 1);
    const lastDay = new Date(now.getFullYear(), 11, 31);
    since = firstDay.toISOString().slice(0, 10);
    until = lastDay.toISOString().slice(0, 10);
  }
  return { since, until };
}

export function BoardScreen({ onSelectPerson }: { onSelectPerson?: (userId: string, name: string) => void }) {
  const { t, i18n } = useTranslation();
  const { groupId, currentMembership } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStr = `${t('Week')} ${monday.getDate().toString().padStart(2, '0')}/${(monday.getMonth()+1).toString().padStart(2, '0')} - ${sunday.getDate().toString().padStart(2, '0')}/${(sunday.getMonth()+1).toString().padStart(2, '0')}`;
  const monthStr = now.toLocaleString(i18n.language, { month: 'long' });
  const yearStr = now.getFullYear().toString();

  const RANGES = [
    { id: "week", label: weekStr, prizeKey: 'weekly_leaderboard_prize_coins' },
    { id: "month", label: monthStr.charAt(0).toUpperCase() + monthStr.slice(1), prizeKey: 'monthly_leaderboard_prize_coins' },
    { id: "year", label: yearStr, prizeKey: 'yearly_leaderboard_prize_coins' },
  ];

  const [range, setRange] = useState('month'); 
  const [rows, setRows] = useState<any[]>([]); 
  const [message, setMessage] = useState('');

  const currentPrizeAmount = currentMembership?.groups?.[RANGES.find(r => r.id === range)?.prizeKey ?? ''];
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;

  useEffect(() => { 
    if (!groupId) return; 
    const { since, until } = getBounds(range);
    supabase.rpc('get_leaderboard', { p_group_id: groupId, p_since: since, p_until: until }).then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setRows(data ?? []);
    }); 
  }, [groupId, range]);

  const max = Math.max(1, ...rows.map((row) => Number(row.points)));

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Segment values={RANGES.map(r => [r.id, r.label]) as any} value={range} onChange={setRange} />
      {rewardsEnabled && currentPrizeAmount > 0 && (
        <View style={[s.card, { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 }]}>
          <Text style={s.muted}>{t("Prize for topping this leaderboard:")}</Text>
          <Text style={{ fontWeight: '800', color: colors.accent, fontFamily: themedFontFamily(colors, '800') }}>🪙 {currentPrizeAmount}</Text>
        </View>
      )}
      <Notice message={message} error />
      <Section title={t('Household board')}>
        {rows.length ? rows.map((row, index) => (
          <Pressable key={row.user_id} style={s.boardRow} onPress={() => onSelectPerson?.(row.user_id, row.display_name)}>
            <Text style={s.rank}>{index + 1}</Text>
            <IconGlyph icon={row.avatar_url} fallback="👤" photoSize={24} />
            <View style={s.boardName}>
              <Text style={s.taskTitle}>{row.display_name}</Text>
              <View style={s.progress}>
                <View style={[s.progressFill, { width: `${(Number(row.points) / max) * 100}%` }]} />
              </View>
            </View>
            <Text style={s.points}>{row.points}</Text>
          </Pressable>
        )) : <Empty text={t('No completed chores in this range yet.')} />}
      </Section>
    </ScrollView>
  );
}
