import React, { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/ThemeProvider';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { createStyles } from '@/styles/theme';
import { themeLabel, themeLang } from '@/lib/themeLabels';
import type { Page } from '@/types/navigation';
import type { TabPage } from '@/lib/tabConfig';

type DragPayload = { id: TabPage; icon: keyof typeof Ionicons.glyphMap; label: string; x: number; y: number };

export function MoreScreen({
  onOpen,
  editMode = false,
  tabIds = [],
  onEnterEditMode,
  onDragUpdate,
  onDragEnd,
}: {
  onOpen: (page: Page) => void;
  editMode?: boolean;
  tabIds?: TabPage[];
  onEnterEditMode?: () => void;
  onDragUpdate?: (payload: DragPayload) => void;
  onDragEnd?: (payload: { id: TabPage; x: number; y: number }) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, mode } = useTheme();
  const s = createStyles(colors);
  const { currentMembership } = useChoreApp();
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;
  const cosmeticsUnlockedForAll = !!currentMembership?.groups?.cosmetics_unlocked_for_all;
  const showRewards = rewardsEnabled || cosmeticsUnlockedForAll;
  const lang = themeLang(i18n.language);
  const tl = (id: TabPage, fallback: string) => themeLabel(lang, mode, id, fallback);

  const items: [TabPage, string, keyof typeof Ionicons.glyphMap, string][] = [
    ['habits', tl('habits', t('Habits')), 'flame-outline', t('Your personal streaks and daily goals')],
    ['today', tl('today', t('Your Tasks')), 'checkmark-circle-outline', t('What you need to do today')],
    ['create', tl('create', t('Create')), 'add-circle-outline', t('Create a new chore or task')],
    ['stock', tl('stock', t('Stock')), 'basket-outline', t('Shopping list and inventory')],
    ['calendar', tl('calendar', t('Calendar')), 'calendar-outline', t('See what\'s scheduled this month')],
    ['manage', tl('manage', t('Manage Chores')), 'list-outline', t('Edit or delete existing chores')],
    ['trades', tl('trades', t('Trades')), 'swap-horizontal-outline', t('Offer or respond to a chore swap')],
    ['board', tl('board', t('Leaderboard')), 'trophy-outline', t('See who has been getting things done')],
    ...(showRewards ? [['rewards', tl('rewards', t('Rewards')), 'gift-outline', t('Spend coins on rewards and cosmetics')] as [TabPage, string, keyof typeof Ionicons.glyphMap, string]] : []),
    ['you', tl('you', t('Your profile')), 'person-outline', t('Name, roster, and your history')],
    ['settings', tl('settings', t('Settings')), 'settings-outline', t('Household access and account')]
  ];

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.moreIntro}>
        <Text style={s.lead}>{editMode ? t('Drag a page down onto the tab bar to add it there.') : t('The household, at a glance.')}</Text>
      </View>
      {items.map(([id, label, icon, caption]) => {
        const alreadyPinned = tabIds.includes(id);
        return (
          <MoreRow
            key={id}
            id={id}
            label={label}
            icon={icon}
            caption={caption}
            editMode={editMode}
            draggable={editMode && !alreadyPinned}
            alreadyPinned={alreadyPinned}
            onPress={() => onOpen(id)}
            onLongPress={onEnterEditMode}
            onDragUpdate={onDragUpdate}
            onDragEnd={onDragEnd}
          />
        );
      })}
    </ScrollView>
  );
}

function MoreRow({
  id, label, icon, caption, editMode, draggable, alreadyPinned, onPress, onLongPress, onDragUpdate, onDragEnd,
}: {
  id: TabPage; label: string; icon: keyof typeof Ionicons.glyphMap; caption: string;
  editMode: boolean; draggable: boolean; alreadyPinned: boolean;
  onPress: () => void; onLongPress?: () => void;
  onDragUpdate?: (payload: DragPayload) => void;
  onDragEnd?: (payload: { id: TabPage; x: number; y: number }) => void;
}) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lift = useSharedValue(0);

  useEffect(() => {
    if (!editMode) { translateX.value = 0; translateY.value = 0; lift.value = 0; }
  }, [editMode, translateX, translateY, lift]);

  const reportUpdate = (x: number, y: number) => onDragUpdate?.({ id, icon, label, x, y });
  const reportEnd = (x: number, y: number) => onDragEnd?.({ id, x, y });

  const pan = Gesture.Pan()
    .enabled(draggable)
    .onStart(() => {
      lift.value = withTiming(1, { duration: 100 });
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      if (onDragUpdate) runOnJS(reportUpdate)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      translateX.value = withTiming(0, { duration: 160 });
      translateY.value = withTiming(0, { duration: 160 });
      lift.value = withTiming(0, { duration: 160 });
      if (onDragEnd) runOnJS(reportEnd)(e.absoluteX, e.absoluteY);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: 1 + lift.value * 0.05 },
    ],
    opacity: 1 - lift.value * 0.15,
    zIndex: lift.value > 0 ? 50 : 0,
    elevation: lift.value > 0 ? 50 : 0,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable style={s.moreRow} onPress={onPress} onLongPress={onLongPress}>
        <View style={s.moreIcon}>
          <Ionicons name={icon} color={colors.blue} size={20} />
        </View>
        <View style={s.taskBody}>
          <Text style={s.taskTitle}>{label}</Text>
          <Text style={s.taskDue}>{alreadyPinned ? '\u2713 ' + caption : caption}</Text>
        </View>
        {draggable ? (
          <GestureDetector gesture={pan}>
            <View hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
              <Ionicons name="reorder-two-outline" color={colors.muted} size={24} />
            </View>
          </GestureDetector>
        ) : (
          <Ionicons name="chevron-forward" color={colors.muted} size={18} />
        )}
      </Pressable>
    </Animated.View>
  );
}
