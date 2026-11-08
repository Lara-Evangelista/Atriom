import type { Ionicons } from '@expo/vector-icons';
import type { Page } from '@/types/navigation';

// 'groups' is a special pre-group-only tab that ChoreMobileApp injects
// itself (it disappears forever once you've created/joined a household),
// so it's excluded from the customizable catalog entirely.
export type TabPage = Exclude<Page, 'groups'>;

export type TabCatalogEntry = {
  id: TabPage;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  // Only offered as an option when the household has rewards/cosmetics on
  // — mirrors the same check MoreScreen uses for its Rewards row.
  rewardsOnly?: boolean;
};

// Icons/labels mirror what MoreScreen already uses for these pages, so a
// page looks the same whether it's reached from a tab or from More.
export const TAB_CATALOG: TabCatalogEntry[] = [
  { id: 'habits', icon: 'flame-outline', labelKey: 'Habits' },
  { id: 'today', icon: 'checkmark-circle-outline', labelKey: 'Your Tasks' },
  { id: 'create', icon: 'add-circle-outline', labelKey: 'Create' },
  { id: 'stock', icon: 'basket-outline', labelKey: 'Stock' },
  { id: 'calendar', icon: 'calendar-outline', labelKey: 'Calendar' },
  { id: 'manage', icon: 'list-outline', labelKey: 'Manage Chores' },
  { id: 'trades', icon: 'swap-horizontal-outline', labelKey: 'Trades' },
  { id: 'board', icon: 'trophy-outline', labelKey: 'Leaderboard' },
  { id: 'rewards', icon: 'gift-outline', labelKey: 'Rewards', rewardsOnly: true },
  { id: 'you', icon: 'person-outline', labelKey: 'Your profile' },
  { id: 'settings', icon: 'settings-outline', labelKey: 'Settings' },
  { id: 'more', icon: 'menu-outline', labelKey: 'More' },
];

// 'more' is always pinned as the last tab and isn't part of the
// customizable list — it's the catch-all menu that lists every page, so
// keeping it guarantees nothing ever becomes unreachable no matter what
// the person removes from their custom bar.
export const PINNED_TAB: TabPage = 'more';

export const DEFAULT_TAB_IDS: TabPage[] = ['habits', 'today', 'create', 'stock'];

// Bottom nav has room for about 5 icons comfortably; one slot is the
// pinned "More" tab, leaving 4 customizable slots.
export const MAX_CUSTOM_TABS = 4;
export const MIN_CUSTOM_TABS = 0;

export const TAB_ORDER_STORAGE_KEY = 'chores:tab-order';
