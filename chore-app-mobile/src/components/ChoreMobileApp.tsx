import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, Pressable, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import type { Page } from '@/types/navigation';

import { AuthGate, HouseholdGate } from '@/screens/AuthGate';
import { HabitsScreen } from '@/screens/HabitsScreen';
import { TodayScreen } from '@/screens/TodayScreen';
import { CalendarScreen } from '@/screens/CalendarScreen';
import { CreateScreen } from '@/screens/CreateScreen';
import { StockScreen } from '@/screens/StockScreen';
import { TradesScreen } from '@/screens/TradesScreen';
import { BoardScreen } from '@/screens/BoardScreen';
import { YouScreen } from '@/screens/YouScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { MoreScreen } from '@/screens/MoreScreen';
import { ManageChoresScreen } from '@/screens/ManageChoresScreen';
import RewardsScreen from '@/screens/RewardsScreen';
import { subscribeNotificationNavigation } from '@/lib/notificationEvents';
import { Loading } from '@/components/ui/primitives';
import { IconGlyph } from '@/components/ui/IconGlyph';
import { ThemeDecorator } from '@/components/ThemeDecorator';

import { TabBar } from '@/components/TabBar';
import type { TabBarBounds } from '@/components/TabBar';
import { useTabConfig } from '@/hooks/useTabConfig';
import { PINNED_TAB, TAB_CATALOG } from '@/lib/tabConfig';
import type { TabPage } from '@/lib/tabConfig';
import { themeLabel, themeLang } from '@/lib/themeLabels';

export function ChoreMobileApp() {
  const { t, i18n } = useTranslation();
  const { session, groupId, loadingGroup, currentMembership } = useChoreApp();
  const { colors, mode } = useTheme();
  const s = createStyles(colors);
  const { tabIds: customTabIds, reorderTab, removeTab, insertOrSwap } = useTabConfig();
  const lang = themeLang(i18n.language);
  // Themed page names (mobile counterpart to web's THEME_LABELS in
  // App.jsx) — falls back to the plain translated labelKey text for
  // themes with no themed vocabulary (neutral/minimalist/corporate).
  const tl = (id: TabPage, fallback: string) => themeLabel(lang, mode, id, fallback);

  const [page, setPage] = useState<Page>('habits');
  const [pageInitialized, setPageInitialized] = useState(false);
  const [viewingPerson, setViewingPerson] = useState<{ userId: string; name: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragGhost, setDragGhost] = useState<{ icon: keyof typeof Ionicons.glyphMap; label: string; x: number; y: number } | null>(null);
  const navBoundsRef = useRef<TabBarBounds | null>(null);

  const goViewPerson = (uid: string, name: string) => {
    setViewingPerson({ userId: uid, name });
    setPage('you');
  };

  // Habits work with zero groups. Land people who haven't joined/created a
  // group yet on Habits instead of a dead-end tab that doesn't exist for
  // them — but only decide this once, right after the group provider
  // finishes loading, so it never overrides a manual tab switch. Once
  // there's a group, land on whatever their custom bar's first tab is
  // (defaulting to Habits if that's somehow empty), since a hardcoded
  // page like "today" might not even be in their customized bar.
  useEffect(() => {
    if (!pageInitialized && !loadingGroup) {
      setPage(groupId ? (customTabIds[0] || 'habits') : 'habits');
      setPageInitialized(true);
    }
  }, [loadingGroup, groupId, pageInitialized, customTabIds]);

  // Once someone creates/joins their first group, the "Groups" tab they
  // were just sitting on disappears (it only exists pre-group) — send
  // them somewhere that still exists instead of leaving `page` dangling.
  useEffect(() => {
    if (page === 'groups' && groupId) setPage(customTabIds[0] || 'habits');
  }, [page, groupId]);

  useEffect(() => {
    return subscribeNotificationNavigation((data) => {
      const type = data?.type as string | undefined;
      if (type === 'chore_due') setPage('today');
      else if (type === 'trade_request') setPage('trades');
      const page = data?.page as Page | undefined;
      if (page) setPage(page);
    });
  }, []);

  const handleBoundsChange = useCallback((bounds: TabBarBounds) => {
    navBoundsRef.current = bounds;
  }, []);

  const handleDragUpdate = useCallback((payload: { icon: keyof typeof Ionicons.glyphMap; label: string; x: number; y: number }) => {
    setDragGhost(payload);
  }, []);

  const handleDragEnd = useCallback((payload: { id: TabPage; x: number; y: number }) => {
    setDragGhost(null);
    const bounds = navBoundsRef.current;
    if (!bounds) return;
    const withinX = payload.x >= bounds.pageX - 20 && payload.x <= bounds.pageX + bounds.width + 20;
    const withinY = payload.y >= bounds.pageY - 24 && payload.y <= bounds.pageY + bounds.height + 24;
    if (!withinX || !withinY) return;
    const rawIndex = Math.round((payload.x - bounds.pageX) / bounds.slotWidth - 0.5);
    insertOrSwap(payload.id, rawIndex);
  }, [insertOrSwap]);

  const backTargets: Partial<Record<Page, Page>> = {
    calendar: 'more',
    manage: 'more',
    trades: 'more',
    board: 'more',
    you: 'more',
    settings: 'more',
    rewards: 'more',
  };
  const goBack = () => setPage(backTargets[page] ?? 'more');

  useEffect(() => {
    const onBackPress = () => {
      if (page in backTargets) {
        goBack();
        return true; // prevent default (exit app)
      }
      return false; // let default happen
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [page]);

  if (loadingGroup) return <Loading label={t('Loading...')} />;
  if (!session) return <AuthGate />;

  // Habits is shared across every group you're in (and needs none at all).
  // Before there's a group, the only other thing to do is create or join
  // one, so the bar isn't customizable yet. Once there's a group, the bar
  // is whatever the person picked in Settings > Customize tab bar, with
  // "More" always pinned last so every page stays reachable.
  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;
  const cosmeticsUnlockedForAll = !!currentMembership?.groups?.cosmetics_unlocked_for_all;
  const showRewards = rewardsEnabled || cosmeticsUnlockedForAll;

  const tabs: { id: TabPage; icon: keyof typeof Ionicons.glyphMap; label: string }[] = customTabIds
    .map((id) => TAB_CATALOG.find((c) => c.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry && (!entry.rewardsOnly || showRewards))
    .map((entry) => ({ id: entry.id, icon: entry.icon, label: tl(entry.id, t(entry.labelKey)) }));

  const pinnedEntry = TAB_CATALOG.find((c) => c.id === PINNED_TAB)!;
  const pinnedTabItem = { id: pinnedEntry.id, icon: pinnedEntry.icon, label: tl(pinnedEntry.id, t(pinnedEntry.labelKey)) };

  const headerTitles: Record<string, string> = {
    habits: tl('habits', t('Habits')),
    groups: t('Your household'),
    trades: tl('trades', t('Trades')),
    board: tl('board', t('Leaderboard')),
    you: viewingPerson?.name || tl('you', t('You')),
    settings: tl('settings', t('Settings')),
    rewards: tl('rewards', t('Rewards')),
    calendar: tl('calendar', t('Calendar')),
    manage: tl('manage', t('Manage Chores')),
  };



  const showBackHeader = ['trades', 'board', 'you', 'settings', 'rewards', 'calendar', 'manage'].includes(page);
  const showHomeHeader = groupId && (page === 'today' || page === 'create' || page === 'stock' || page === 'more');
  const navVisiblePages = groupId ? [...tabs.map((t) => t.id), pinnedTabItem.id] : ['habits', 'groups'];
  const showNav = navVisiblePages.includes(page as TabPage);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={s.app}>
        <ThemeDecorator />
        {showBackHeader ? (
          <View style={s.topbar}>
            <Pressable onPress={goBack}><Text style={s.back}>{t('Back')}</Text></Pressable>
            <Text style={s.eyebrow}>{(headerTitles[page] || page).toUpperCase()}</Text>
            <View style={{ width: 34 }} />
          </View>
        ) : showHomeHeader ? (
          <View style={s.topbar}>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }} onPress={() => setPage('settings')}>
              <IconGlyph icon={currentMembership?.groups?.icon} fallback="🏠" size={30} photoSize={38} />
              <View>
                <Text style={s.eyebrow}>{t('YOUR HOUSEHOLD')}</Text>
                <Text style={s.groupName}>{currentMembership?.groups?.name || t('Home')}</Text>
              </View>
            </Pressable>
            <Pressable style={[s.avatar, { overflow: 'hidden' }]} onPress={() => setPage('you')}>
              <IconGlyph icon={currentMembership?.avatar_url} fallback={currentMembership?.display_name?.slice(0, 1).toUpperCase() || 'U'} size={18} photoSize={36} />
            </Pressable>
          </View>
        ) : (
          <View style={s.topbar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <IconGlyph icon={undefined} fallback="🔥" size={26} photoSize={38} />
              <View>
                <Text style={s.eyebrow}>{t('PERSONAL')}</Text>
                <Text style={s.groupName}>{headerTitles[page] || t('Chores')}</Text>
              </View>
            </View>
          </View>
        )}
        <View style={s.main}>
          {page === 'habits' && <HabitsScreen />}
          {page === 'groups' && <HouseholdGate />}
          {page === 'today' && <TodayScreen />}
          {page === 'calendar' && <CalendarScreen />}
          {page === 'create' && <CreateScreen onCreated={() => setPage('today')} />}
          {page === 'stock' && <StockScreen />}
          {page === 'trades' && <TradesScreen />}
          {page === 'board' && <BoardScreen onSelectPerson={goViewPerson} />}
          {page === 'you' && <YouScreen viewing={viewingPerson} onClearViewing={() => setViewingPerson(null)} onSelectPerson={goViewPerson} />}
          {page === 'settings' && <SettingsScreen onSelectPerson={goViewPerson} />}
          {page === 'manage' && <ManageChoresScreen />}
          {page === 'rewards' && <RewardsScreen />}
          {page === 'more' && (
            <MoreScreen
              onOpen={setPage}
              editMode={editMode}
              tabIds={customTabIds}
              onEnterEditMode={() => setEditMode(true)}
              onDragUpdate={handleDragUpdate}
              onDragEnd={handleDragEnd}
            />
          )}
        </View>

        {showNav && (
          groupId ? (
            <TabBar
              tabs={tabs}
              pinned={pinnedTabItem}
              activePage={page}
              onSelect={setPage}
              editMode={editMode}
              onEditModeChange={setEditMode}
              onReorder={reorderTab}
              onRemove={removeTab}
              onBoundsChange={handleBoundsChange}
            />
          ) : (
            <View style={s.nav}>
              {[{ id: 'habits' as const, icon: 'flame-outline' as const, label: t('Habits') }, { id: 'groups' as const, icon: 'people-outline' as const, label: t('Groups') }].map((tab) => (
                <Pressable key={tab.id} style={[s.navItem, { flex: 1 }]} onPress={() => setPage(tab.id)}>
                  <Ionicons name={page === tab.id ? (tab.icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap) : tab.icon} size={24} color={page === tab.id ? colors.accent : colors.muted} />
                  <Text style={[s.navLabel, page === tab.id && s.navLabelActive]}>{tab.label}</Text>
                </Pressable>
              ))}
            </View>
          )
        )}
      </SafeAreaView>

      {dragGhost && (
        <View pointerEvents="none" style={[s.dragGhost, { left: dragGhost.x - 34, top: dragGhost.y - 32 }]}>
          <Ionicons name={dragGhost.icon} size={20} color={colors.accent} />
          <Text style={s.taskTitle}>{dragGhost.label}</Text>
          <Text style={s.dragHandleHint}>{t('Release to add')}</Text>
        </View>
      )}
    </View>
  );
}
