import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section } from '@/components/ui/primitives';
import { useTranslation } from 'react-i18next';

export function ShoppingListScreen() {
  const { t } = useTranslation();
  const { groupId, user, roster } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    setError('');
    const { data, error: fetchError } = await supabase
      .from('shopping_items')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (fetchError) setError(fetchError.message);
    else setItems(data || []);
  }, [groupId]);

  useEffect(() => { load(); }, [load]);
  
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const add = async () => {
    if (!groupId || !name.trim()) return;
    setBusy(true); setError('');
    const { error: insertError } = await supabase.from('shopping_items').insert({
      group_id: groupId,
      name: name.trim(),
      quantity: quantity.trim() || null,
      added_by: user?.id
    });
    setBusy(false);
    if (insertError) setError(insertError.message);
    else { setName(''); setQuantity(''); load(); }
  };

  const markBought = async (item: any) => {
    setBusy(true); setError('');
    const { error: updateError } = await supabase.from('shopping_items').update({
      status: 'bought',
      bought_by: user?.id,
      updated_at: new Date().toISOString()
    }).eq('id', item.id);
    setBusy(false);
    if (updateError) setError(updateError.message);
    else load();
  };

  const nameFor = (id: string) => roster.find(person => person.user_id === id)?.display_name || t('Someone');

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}>
      <Notice message={error} error />
      
      <View style={s.form}>
        <Field label={t('Add to list')} value={name} onChangeText={setName} placeholder={t('Toothpaste, apples...')} />
        <Field label={t('Quantity (Optional)')} value={quantity} onChangeText={setQuantity} placeholder={t('e.g. 2, 500g, 1 box')} />
        <Button label={t('Add item')} onPress={add} disabled={busy || !name.trim()} />
      </View>

      <Section title={t('To Buy')}>
        {items.length === 0 ? <Empty text={t('The shopping list is empty.')} /> : null}
        
        {items.map(item => (
          <View key={item.id} style={s.taskCard}>
            <View style={s.taskIcon}><Text style={s.emoji}>🛒</Text></View>
            <View style={s.taskBody}>
              <Text style={s.taskTitle}>{item.name}</Text>
              <Text style={s.taskDue}>{item.quantity ? `${item.quantity} · ` : ''}{t('Added by {{name}}', { name: nameFor(item.added_by) })}</Text>
            </View>
            <Pressable style={s.checkButton} onPress={() => markBought(item)} disabled={busy}>
              <Ionicons name="checkmark" size={21} color={colors.accentInk} />
            </Pressable>
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}
