import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

import { supabase } from '@/lib/supabase';
import { getSignedIconUrl, isIconPhotoPath } from '@/lib/icons';
import { isoDate } from '@/lib/date';
import { UI_LANGUAGE_STORAGE_KEY } from '@/lib/i18n';
import { themes, type ThemeMode } from '@/providers/ThemeProvider';
import { themeLang, type Lang } from '@/lib/themeLabels';

// Same key the main app writes to (see ChoreAppProvider). The widget has no
// React context of its own, so it reads the last-active household straight
// out of storage.
const LAST_GROUP_KEY = 'chores:last-group-id';

export type WidgetChoreItem = {
  id: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  isScheduled: boolean;
  requiresPhoto: boolean;
  isDelayable: boolean;
  overdue: boolean;
};

export type WidgetStockItem = {
  id: string;
  name: string;
};

async function resolveIcon(icon: string | null | undefined): Promise<{ icon: string | null; iconUrl: string | null }> {
  if (!icon) return { icon: null, iconUrl: null };
  if (isIconPhotoPath(icon)) {
    try {
      const url = await getSignedIconUrl(icon);
      return { icon: null, iconUrl: url };
    } catch {
      return { icon: null, iconUrl: null };
    }
  }
  return { icon, iconUrl: null };
}

export async function getActiveGroupId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_GROUP_KEY);
  } catch {
    return null;
  }
}

function isThemeMode(value: string): value is ThemeMode {
  return Object.prototype.hasOwnProperty.call(themes, value);
}

// Mirrors CosmeticsProvider's own fetch of the equipped theme (Rewards →
// Cosmetics) — same RPC, same shape — so the widget matches whatever's
// active in the app.
export async function getEquippedTheme(groupId: string): Promise<ThemeMode> {
  try {
    const { data } = await supabase.rpc('get_user_wallet', { p_group_id: groupId });
    const theme = data?.[0]?.active_cosmetics?.theme;
    return typeof theme === 'string' && isThemeMode(theme) ? theme : 'neutral';
  } catch {
    return 'neutral';
  }
}

// Mirrors lib/i18n.ts's own resolution order: a manually-picked language
// (You → Personal Settings) wins if one's been saved, otherwise fall back
// to the device locale.
export async function getUiLanguage(): Promise<Lang> {
  try {
    const stored = await AsyncStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (stored) return themeLang(stored);
  } catch {
    // ignore, fall through to device locale
  }
  return themeLang(getLocales()[0]?.languageCode ?? undefined);
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// Mirrors TodayScreen's "today" filter: due today or overdue, pending, and
// assigned to the current user.
export async function fetchTodayChores(groupId: string, userId: string): Promise<WidgetChoreItem[]> {
  const { data, error } = await supabase
    .from('chore_event_assignees')
    .select('chore_events!inner(id,date,status,chore_type_id,group_id,chore_types(name,icon,has_schedule,requires_photo,is_delayable))')
    .eq('user_id', userId)
    .eq('chore_events.status', 'pending')
    .eq('chore_events.group_id', groupId);

  if (error) throw error;

  const today = isoDate();
  const events = (data ?? [])
    .map((row: any) => row.chore_events)
    .filter((event: any) => event && event.date <= today)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  const items = await Promise.all(
    events.map(async (event: any) => {
      const ct = event.chore_types;
      const { icon, iconUrl } = await resolveIcon(ct?.icon);
      return {
        id: event.id,
        name: ct?.name || 'Chore',
        icon,
        iconUrl,
        isScheduled: !!ct?.has_schedule,
        requiresPhoto: !!ct?.requires_photo,
        isDelayable: !!ct?.is_delayable,
        overdue: event.date < today,
      } as WidgetChoreItem;
    })
  );

  return items;
}

export async function completeChore(eventId: string, isScheduled: boolean): Promise<void> {
  const rpcName = isScheduled ? 'complete_chore_event' : 'complete_onetime_task';
  const { error } = await supabase.rpc(rpcName, { p_event_id: eventId, p_photo_url: null });
  if (error) throw error;
}

export async function delayChore(eventId: string, days = 1): Promise<void> {
  const { error } = await supabase.rpc('delay_chore_event', { p_event_id: eventId, p_days: days });
  if (error) throw error;
}

export async function fetchOutOfStock(groupId: string): Promise<WidgetStockItem[]> {
  const { data, error } = await supabase
    .from('stock_items')
    .select('id,name')
    .eq('group_id', groupId)
    .eq('status', 'out')
    .order('flagged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item: any) => ({ id: item.id, name: item.name }));
}

export async function resolveStockItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_stock_item', { p_item_id: itemId });
  if (error) throw error;
}
