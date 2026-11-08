import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, Modal, ScrollView } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useCosmetics } from '@/providers/CosmeticsProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles, themedFontFamily } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section, Segment } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { IconPickerField } from '@/components/ui/IconPickerField';

// Cosmetics catalog names, per theme/effect, kept in-flavor for each language
// rather than run through the general t() dictionary — mirrors web's Rewards.jsx
// CATALOG_NAMES (a plain t() lookup would flatten "Enchanted Forest" and
// "Floresta Encantada" to a single literal key).
const CATALOG_NAMES: Record<'en' | 'pt', Record<string, string>> = {
  en: {
    neutral: '✨ Default', none: '🚫 None',
    cutesy: '🌸 Cutesy', minimalist: '◻️ Minimalist', cyberpunk: '🌃 Cyberpunk', fantasy: '⚔️ Fantasy RPG',
    corporate: '💼 Corporate', victorian: '🎩 Victorian', wonderland: '🐰 Wonderland', steampunk: '⚙️ Steampunk',
    enchanted: '🧚 Enchanted Forest', cosmic: '🌌 Cosmic Galaxy', retro: '📻 Retro',
    confetti: '🎊 Confetti', fireworks: '🎆 Fireworks', sparkles: '✨ Sparkles', wave: '🌊 Wave Ripple', shake: '📳 Screen Shake',
  },
  pt: {
    neutral: '✨ Padrão', none: '🚫 Nenhum',
    cutesy: '🌸 Fofo', minimalist: '◻️ Minimalista', cyberpunk: '🌃 Cyberpunk', fantasy: '⚔️ Fantasia RPG',
    corporate: '💼 Corporativo', victorian: '🎩 Vitoriano', wonderland: '🐰 País das Maravilhas', steampunk: '⚙️ Steampunk',
    enchanted: '🧚 Floresta Encantada', cosmic: '🌌 Galáxia Cósmica', retro: '📻 Retro',
    confetti: '🎊 Confetes', fireworks: '🎆 Fogo de Artifício', sparkles: '✨ Brilhos', wave: '🌊 Onda', shake: '📳 Tremor de Ecrã',
  },
};

export default function RewardsScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const names = CATALOG_NAMES[lang];
  const { groupId, user, roster, currentMembership } = useChoreApp();
  const { cosmetics, setCosmetics } = useCosmetics();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;
  const cosmeticsUnlockedForAll = !!currentMembership?.groups?.cosmetics_unlocked_for_all;

  const [activeTab, setActiveTab] = useState<'group' | 'cosmetics'>(rewardsEnabled ? 'group' : 'cosmetics');
  const [wallet, setWallet] = useState<{ coin_balance: number; unlocked_cosmetics: any[] }>({ coin_balance: 0, unlocked_cosmetics: [] });
  const [rewards, setRewards] = useState<any[]>([]);
  const [error, setError] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [newReward, setNewReward] = useState({ name: '', description: '', cost: '10', icon: '🎁', color_theme: 'teal' });
  const [busy, setBusy] = useState(false);

  const isAdmin = roster.find((r) => r.user_id === user?.id)?.role !== 'member';

  useEffect(() => { if (groupId) fetchData(); }, [groupId]);

  const fetchData = async () => {
    setError('');
    const { data: walletData, error: walletError } = await supabase.rpc('get_user_wallet', { p_group_id: groupId });
    if (walletError) { setError(walletError.message); return; }
    if (walletData && walletData[0]) setWallet(walletData[0]);

    const { data: rewardsData, error: rewardsError } = await supabase.from('rewards').select('*').eq('group_id', groupId).eq('archived', false).order('cost', { ascending: true });
    if (rewardsError) { setError(rewardsError.message); return; }
    setRewards(rewardsData ?? []);
  };

  const handleCreateReward = async () => {
    if (!newReward.name.trim()) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_reward', {
      p_group_id: groupId,
      p_name: newReward.name.trim(),
      p_description: newReward.description.trim(),
      p_cost: parseInt(newReward.cost, 10) || 10,
      p_icon: newReward.icon,
      p_color_theme: newReward.color_theme,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setShowAddModal(false);
    setNewReward({ name: '', description: '', cost: '10', icon: '🎁', color_theme: 'teal' });
    fetchData();
  };

  const purchaseReward = (reward: any) => {
    if (wallet.coin_balance < reward.cost) { Alert.alert(t('Not enough coins!')); return; }
    Alert.alert(t('Redeem Reward'), t('Redeem {{name}} for {{cost}} coins?', { name: reward.name, cost: reward.cost }), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Redeem'), onPress: async () => {
          const { error: rpcError } = await supabase.rpc('purchase_reward', { p_reward_id: reward.id });
          if (rpcError) Alert.alert(t('Error'), rpcError.message);
          else { Alert.alert(t('Purchased successfully!')); fetchData(); }
        }
      }
    ]);
  };

  const isUnlocked = (type: string, value: string) => {
    if (cosmeticsUnlockedForAll) return true;
    if (type === 'theme' && value === 'neutral') return true;
    if (type === 'effect' && value === 'none') return true;
    return wallet.unlocked_cosmetics?.some((c) => c.type === type && c.data === value);
  };

  const purchaseCosmetic = (item: { type: string; value: string; name: string; cost: number }) => {
    if (cosmeticsUnlockedForAll) return;
    if (wallet.coin_balance < item.cost) { Alert.alert(t('Not enough coins!')); return; }
    Alert.alert(t('Buy Cosmetic'), t('Buy {{name}} for {{cost}} coins?', { name: item.name, cost: item.cost }), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Buy'), onPress: async () => {
          const newBalance = wallet.coin_balance - item.cost;
          const newUnlocks = [...(wallet.unlocked_cosmetics || []), { type: item.type, data: item.value, name: item.name }];
          const { error: updateError } = await supabase.from('memberships').update({
            coin_balance: newBalance,
            unlocked_cosmetics: newUnlocks,
          }).eq('group_id', groupId).eq('user_id', user?.id);
          if (updateError) setError(updateError.message);
          else fetchData();
        }
      }
    ]);
  };

  const equipCosmetic = (type: string, value: string) => setCosmetics({ [type]: value } as any);

  const catalog = [
    { type: 'theme', value: 'neutral', name: names.neutral, cost: 0 },
    { type: 'theme', value: 'cutesy', name: names.cutesy, cost: 50 },
    { type: 'theme', value: 'minimalist', name: names.minimalist, cost: 50 },
    { type: 'theme', value: 'cyberpunk', name: names.cyberpunk, cost: 100 },
    { type: 'theme', value: 'fantasy', name: names.fantasy, cost: 100 },
    { type: 'theme', value: 'corporate', name: names.corporate, cost: 25 },
    { type: 'theme', value: 'victorian', name: names.victorian, cost: 120 },
    { type: 'theme', value: 'wonderland', name: names.wonderland, cost: 150 },
    { type: 'theme', value: 'steampunk', name: names.steampunk, cost: 120 },
    { type: 'theme', value: 'enchanted', name: names.enchanted, cost: 130 },
    { type: 'theme', value: 'cosmic', name: names.cosmic, cost: 140 },
    { type: 'theme', value: 'retro', name: names.retro, cost: 80 },
    { type: 'effect', value: 'none', name: names.none, cost: 0 },
    { type: 'effect', value: 'confetti', name: names.confetti, cost: 30 },
    { type: 'effect', value: 'fireworks', name: names.fireworks, cost: 50 },
    { type: 'effect', value: 'sparkles', name: names.sparkles, cost: 40 },
    { type: 'effect', value: 'wave', name: names.wave, cost: 30 },
    { type: 'effect', value: 'shake', name: names.shake, cost: 20 },
  ];

  return (
    <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>
      {rewardsEnabled && (
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Text style={s.muted}>{t('Your Balance')}</Text>
          <Text style={{ fontSize: 40, fontWeight: '800', color: colors.accent, fontFamily: themedFontFamily(colors, '800') }}>🪙 {wallet.coin_balance}</Text>
        </View>
      )}

      {cosmeticsUnlockedForAll && (
        <View style={[s.status, s.statusDone, { alignSelf: 'center', paddingHorizontal: 14 }]}>
          <Text style={s.statusText}>{t('An admin unlocked every theme and effect for everyone — equip whatever you like, free.')}</Text>
        </View>
      )}

      <Notice message={error} error />

      {rewardsEnabled && (
        <Segment
          values={[['group', t('Group Rewards')], ['cosmetics', t('Cosmetics')]]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'group' | 'cosmetics')}
        />
      )}

      {activeTab === 'group' && rewardsEnabled && (
        <Section title={t('Group Rewards')}>
          {isAdmin && (
            <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14 }]} onPress={() => setShowAddModal(true)}>
              <Text style={s.outlineText}>{t('Add New Reward')}</Text>
            </Pressable>
          )}

          {rewards.length === 0 ? (
            <Empty text={t('No group rewards created yet.')} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {rewards.map((r) => (
                <View key={r.id} style={{ width: '48%', borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface }}>
                  <View style={{ padding: 16, alignItems: 'center', gap: 6, backgroundColor: colors.paper }}>
                    <IconGlyph icon={r.icon} fallback="🎁" size={32} photoSize={40} />
                    <Text style={[s.taskTitle, { textAlign: 'center' }]}>{r.name}</Text>
                    {r.description ? <Text style={[s.taskDue, { textAlign: 'center' }]}>{r.description}</Text> : null}
                  </View>
                  <View style={{ padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '800', color: colors.accent, fontFamily: themedFontFamily(colors, '800') }}>🪙 {r.cost}</Text>
                    {wallet.coin_balance >= r.cost ? (
                      <Pressable style={s.checkButton} onPress={() => purchaseReward(r)}>
                        <Text style={{ color: colors.accentInk, fontWeight: '700', fontSize: 11, fontFamily: themedFontFamily(colors, '700') }}>{t('Redeem')}</Text>
                      </Pressable>
                    ) : (
                      <Text style={[s.muted, { fontSize: 11 }]}>{t('Need {{count}}', { count: r.cost - wallet.coin_balance })}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>
      )}

      {activeTab === 'cosmetics' && (
        <>
          <Section title={t('UI Themes')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {catalog.filter((c) => c.type === 'theme').map((item) => (
                <CosmeticCard key={item.value} item={item} unlocked={isUnlocked(item.type, item.value)} equipped={cosmetics?.theme === item.value} onEquip={() => equipCosmetic(item.type, item.value)} onBuy={() => purchaseCosmetic(item)} s={s} colors={colors} t={t} />
              ))}
            </View>
          </Section>
          <Section title={t('Completion Effects')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {catalog.filter((c) => c.type === 'effect').map((item) => (
                <CosmeticCard key={item.value} item={item} unlocked={isUnlocked(item.type, item.value)} equipped={cosmetics?.effect === item.value} onEquip={() => equipCosmetic(item.type, item.value)} onBuy={() => purchaseCosmetic(item)} s={s} colors={colors} t={t} />
              ))}
            </View>
          </Section>
        </>
      )}

      {showAddModal && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setShowAddModal(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <KeyboardAwareScrollView style={{ backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }} contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 14 }} enableOnAndroid={true} extraScrollHeight={20}>
              <Text style={[s.taskTitle, { fontSize: 20 }]}>{t('Create Group Reward')}</Text>
              <Field label={t('Name')} value={newReward.name} onChangeText={(v) => setNewReward({ ...newReward, name: v })} placeholder={t('e.g. Trip to the movies')} />
              <Field label={t('Description (optional)')} value={newReward.description} onChangeText={(v) => setNewReward({ ...newReward, description: v })} />
              <Field label={t('Cost')} value={newReward.cost} onChangeText={(v) => setNewReward({ ...newReward, cost: v })} keyboardType="number-pad" />
              <IconPickerField label={t('Icon (emoji or photo)')} value={newReward.icon} onChange={(v) => setNewReward({ ...newReward, icon: v })} groupId={groupId} />
              <View style={s.field}>
                <Text style={s.fieldLabel}>{t('Background Color')}</Text>
                <View style={s.people}>
                  {(['teal', 'pink'] as const).map((c) => (
                    <Pressable key={c} style={[s.personChip, newReward.color_theme === c && s.personChipActive]} onPress={() => setNewReward({ ...newReward, color_theme: c })}>
                      <Text style={[s.personText, newReward.color_theme === c && s.personTextActive]}>{c === 'teal' ? t('Teal') : t('Pink')}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={s.buttonRow}>
                <Button label={t('Cancel')} onPress={() => setShowAddModal(false)} secondary />
                <Button label={busy ? t('Working...') : t('Create')} onPress={handleCreateReward} disabled={busy || !newReward.name.trim()} />
              </View>
            </KeyboardAwareScrollView>
          </View>
        </Modal>
      )}
    </KeyboardAwareScrollView>
  );
}

function CosmeticCard({ item, unlocked, equipped, onEquip, onBuy, s, colors, t }: {
  item: { type: string; value: string; name: string; cost: number };
  unlocked: boolean;
  equipped: boolean;
  onEquip: () => void;
  onBuy: () => void;
  s: any;
  colors: any;
  t: any;
}) {
  return (
    <View style={{ width: '48%', borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.surface, padding: 14, alignItems: 'center', gap: 10 }}>
      <Text style={[s.taskTitle, { textAlign: 'center' }]}>{item.name}</Text>
      {unlocked ? (
        equipped ? (
          <View style={[s.status, s.statusDone]}><Text style={s.statusText}>{t('Equipped')}</Text></View>
        ) : (
          <Pressable style={s.outlineButton} onPress={onEquip}><Text style={s.outlineText}>{t('Equip')}</Text></Pressable>
        )
      ) : (
        <Pressable style={[s.button, s.buttonCompact]} onPress={onBuy}>
          <Text style={s.buttonText}>🪙 {item.cost}</Text>
        </Pressable>
      )}
    </View>
  );
}
