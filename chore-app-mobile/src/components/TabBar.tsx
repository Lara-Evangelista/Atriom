import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import type { Page } from '@/types/navigation';
import type { TabPage } from '@/lib/tabConfig';

export const NAV_SLOT_WIDTH = 68;

export type NavTabItem = { id: TabPage; icon: keyof typeof Ionicons.glyphMap; label: string };
export type TabBarBounds = { pageX: number; pageY: number; width: number; height: number; slotWidth: number; count: number };

type TabBarProps = {
  tabs: NavTabItem[];
  pinned: NavTabItem;
  activePage: Page;
  onSelect: (page: Page) => void;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  onReorder: (id: TabPage, toIndex: number) => void;
  onRemove: (id: TabPage) => void;
  onBoundsChange: (bounds: TabBarBounds) => void;
};

export function TabBar({ tabs, pinned, activePage, onSelect, editMode, onEditModeChange, onReorder, onRemove, onBoundsChange }: TabBarProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const rowRef = useRef<View>(null);
  const total = tabs.length + 1;

  const measure = useCallback(() => {
    rowRef.current?.measureInWindow((x, y, width, height) => {
      if (typeof x === 'number') onBoundsChange({ pageX: x, pageY: y, width, height, slotWidth: NAV_SLOT_WIDTH, count: total });
    });
  }, [total, onBoundsChange]);

  useEffect(() => {
    const id = setTimeout(measure, 60);
    return () => clearTimeout(id);
  }, [measure, editMode]);

  return (
    <View style={s.nav}>
      {editMode && (
        <Pressable style={s.navDonePill} onPress={() => onEditModeChange(false)}>
          <Text style={s.navDonePillText}>{t('Done')}</Text>
        </Pressable>
      )}
      <View ref={rowRef} onLayout={measure} style={{ flexDirection: 'row', flex: 1, justifyContent: 'space-evenly' }}>
        {tabs.map((tab, index) => (
          <DraggableTabItem
            key={tab.id}
            tab={tab}
            index={index}
            count={tabs.length}
            active={activePage === tab.id}
            editMode={editMode}
            onSelect={() => onSelect(tab.id)}
            onEnterEdit={() => onEditModeChange(true)}
            onRemove={() => onRemove(tab.id)}
            onReorder={(toIndex) => onReorder(tab.id, toIndex)}
          />
        ))}
        <View style={{ width: NAV_SLOT_WIDTH, alignItems: 'center' }}>
          <Pressable
            style={s.navItem}
            onPress={() => onSelect(pinned.id)}
            onLongPress={() => onEditModeChange(true)}
          >
            <Ionicons
              name={activePage === pinned.id && !editMode ? (pinned.icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap) : pinned.icon}
              size={24}
              color={activePage === pinned.id && !editMode ? colors.accent : colors.muted}
            />
            <Text style={[s.navLabel, activePage === pinned.id && !editMode && s.navLabelActive]}>{pinned.label}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function DraggableTabItem({
  tab, index, count, active, editMode, onSelect, onEnterEdit, onRemove, onReorder,
}: {
  tab: NavTabItem; index: number; count: number; active: boolean; editMode: boolean;
  onSelect: () => void; onEnterEdit: () => void; onRemove: () => void; onReorder: (toIndex: number) => void;
}) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  const translateX = useSharedValue(0);
  const wiggle = useSharedValue(0);
  const lift = useSharedValue(0);

  useEffect(() => {
    // The user requested: "they shouldn't shake". So we remove the wiggle.
    wiggle.value = 0;
  }, [editMode, index, wiggle]);

  const pan = Gesture.Pan()
    .enabled(editMode)
    .onStart(() => {
      lift.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const rawTarget = index + e.translationX / NAV_SLOT_WIDTH;
      const droppedOnMore = rawTarget >= count - 0.4;
      translateX.value = withTiming(0, { duration: 160 });
      lift.value = withTiming(0, { duration: 160 });
      if (droppedOnMore) {
        runOnJS(onRemove)();
      } else {
        const target = Math.max(0, Math.min(count - 1, Math.round(rawTarget)));
        if (target !== index) runOnJS(onReorder)(target);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${wiggle.value * 3}deg` },
      { scale: 1 + lift.value * 0.12 },
    ],
    zIndex: lift.value > 0 ? 50 : 0,
    elevation: lift.value > 0 ? 50 : 0,
  }));

  return (
    <View style={{ width: NAV_SLOT_WIDTH, alignItems: 'center' }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={animatedStyle}>
          <Pressable
            style={s.navItem}
            disabled={editMode}
            onPress={onSelect}
            onLongPress={onEnterEdit}
          >
            <Ionicons
              name={active && !editMode ? (tab.icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap) : tab.icon}
              size={24}
              color={active && !editMode ? colors.accent : colors.muted}
            />
            <Text style={[s.navLabel, active && !editMode && s.navLabelActive]}>{tab.label}</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
      {editMode && (
        <Pressable style={s.navEditBadge} onPress={onRemove} hitSlop={10}>
          <Text style={s.navEditBadgeText}>{'\u2212'}</Text>
        </Pressable>
      )}
    </View>
  );
}
