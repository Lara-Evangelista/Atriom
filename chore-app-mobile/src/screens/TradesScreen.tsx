import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { humanDate } from '@/lib/date';
import { supabase } from '@/lib/supabase';
import { notifyHousehold } from '@/lib/notify';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Notice, Section } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { useTranslation } from 'react-i18next';

export function TradesScreen() {
  const { t } = useTranslation();
  const { groupId, user, roster } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [mine, setMine] = useState<any[]>([]); 
  const [candidates, setCandidates] = useState<any[]>([]); 
  const [trades, setTrades] = useState<any[]>([]); 
  const [from, setFrom] = useState(''); 
  const [to, setTo] = useState(''); 
  const [message, setMessage] = useState(''); 
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { 
    if (!groupId || !user) return; 
    const [
      { data: events, error: eventError }, 
      { data: nextTrades, error: tradeError }
    ] = await Promise.all([
      supabase.from('chore_events').select('id,date,chore_type_id,assigned_user_id,chore_types(name,icon,has_schedule)').eq('group_id', groupId).eq('status', 'pending').order('date'), 
      supabase.from('trades').select('id,status,from_user_id,to_user_id,from_event:from_event_id(id,date,chore_types(name,icon)),to_event:to_event_id(id,date,chore_types(name,icon))').eq('group_id', groupId).order('created_at', { ascending: false })
    ]); 
    if (eventError || tradeError) {
      setMessage(eventError?.message ?? tradeError?.message ?? t('Could not load trades.')); 
    } else { 
      const list = events ?? []; 
      setMine(list.filter((event: any) => event.assigned_user_id === user.id && event.chore_types?.has_schedule)); 
      setCandidates(list.filter((event: any) => event.assigned_user_id !== user.id && event.chore_types?.has_schedule)); 
      setTrades(nextTrades ?? []); 
    } 
  }, [groupId, user]);

  useEffect(() => { load(); }, [load]);

  const nameFor = (id: string) => roster.find((person) => person.user_id === id)?.display_name || t('Someone');

  const request = async () => { 
    if (!groupId || !from || !to) return; 
    setBusy(true); 
    setMessage(''); 
    const { data, error } = await supabase.rpc('request_trade', { p_from_event_id: from, p_to_event_id: to }); 
    setBusy(false); 
    if (error) { setMessage(error.message); return; } 
    
    const target = candidates.find((event) => event.id === to); 
    const given = mine.find((event) => event.id === from); 
    if (target?.assigned_user_id) {
      notifyHousehold([target.assigned_user_id], groupId, t('Trade request'), t('{{chore}} was offered for your turn.', { chore: given?.chore_types?.name || t('A chore') }), { type: 'trade', tradeId: data }).catch(() => {}); 
    }
    setFrom(''); setTo(''); load(); 
  };

  const respond = async (trade: any, accept: boolean) => { 
    if (!groupId) return; 
    setBusy(true); 
    const { error } = await supabase.rpc('respond_trade', { p_trade_id: trade.id, p_accept: accept }); 
    setBusy(false); 
    if (error) { setMessage(error.message); return; } 
    notifyHousehold([trade.from_user_id], groupId, accept ? t('Trade accepted') : t('Trade declined'), accept ? t('Your chore swap was accepted.') : t('Your chore swap was declined.'), { type: 'trade', tradeId: trade.id }).catch(() => {}); 
    load(); 
  };

  const incoming = trades.filter((trade) => trade.status === 'pending' && trade.to_user_id === user?.id); 
  const outgoing = trades.filter((trade) => trade.status === 'pending' && trade.from_user_id === user?.id);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Notice message={message} error />
      <Section title={t('Propose a swap')}>
        <View style={s.form}>
          <Text style={s.fieldLabel}>{t('Your turn')}</Text>
          <View style={s.people}>
            {mine.map((event) => (
              <Pressable key={event.id} style={[s.personChip, from === event.id && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => setFrom(event.id)}>
                <IconGlyph icon={event.chore_types?.icon} size={14} photoSize={16} />
                <Text style={[s.personText, from === event.id && s.personTextActive]}>{event.chore_types?.name} · {humanDate(event.date)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.fieldLabel}>{t('Their turn')}</Text>
          <View style={s.people}>
            {candidates.filter((event) => !from || event.chore_type_id === mine.find((mineEvent) => mineEvent.id === from)?.chore_type_id).map((event) => (
              <Pressable key={event.id} style={[s.personChip, to === event.id && s.personChipActive]} onPress={() => setTo(event.id)}>
                <Text style={[s.personText, to === event.id && s.personTextActive]}>{nameFor(event.assigned_user_id)} · {humanDate(event.date)}</Text>
              </Pressable>
            ))}
          </View>
          <Button label={busy ? t('Working...') : t('Propose swap')} onPress={request} disabled={busy || !from || !to} />
        </View>
      </Section>
      <Section title={t('Waiting on you')}>
        {incoming.length ? incoming.map((trade) => (
          <View key={trade.id} style={s.tradeRow}>
            <View style={s.taskBody}>
              <Text style={s.taskTitle}>{t('{{name}} offered a swap', { name: nameFor(trade.from_user_id) })}</Text>
              <Text style={s.taskDue}>{t('{{from}} for {{to}}', { from: trade.from_event?.chore_types?.name, to: trade.to_event?.chore_types?.name })}</Text>
            </View>
            <Pressable style={s.checkButton} onPress={() => respond(trade, true)}>
              <Ionicons name="checkmark" size={19} color={colors.accentInk} />
            </Pressable>
            <Pressable style={s.outlineButton} onPress={() => respond(trade, false)}>
              <Ionicons name="close" size={19} color={colors.ink} />
            </Pressable>
          </View>
        )) : <Empty text={t('No trade requests need your answer.')} />}
      </Section>
      <Section title={t('You proposed')}>
        {outgoing.length ? outgoing.map((trade) => (
          <View key={trade.id} style={s.tradeRow}>
            <Text style={s.taskTitle}>{t('Waiting for {{name}}', { name: nameFor(trade.to_user_id) })}</Text>
            <Text style={s.taskDue}>{t('{{from}} for {{to}}', { from: trade.from_event?.chore_types?.name, to: trade.to_event?.chore_types?.name })}</Text>
          </View>
        )) : <Empty text={t('You have no outstanding swap requests.')} />}
      </Section>
    </ScrollView>
  );
}
