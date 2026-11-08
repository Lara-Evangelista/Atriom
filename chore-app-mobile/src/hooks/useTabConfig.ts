import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_TAB_IDS, MAX_CUSTOM_TABS, MIN_CUSTOM_TABS, TAB_CATALOG, TAB_ORDER_STORAGE_KEY } from '@/lib/tabConfig';
import type { TabPage } from '@/lib/tabConfig';

// Saved on-device only (like the last-selected household), so it's a
// per-device preference rather than a synced account setting for now.
export function useTabConfig() {
  const [tabIds, setTabIdsState] = useState<TabPage[]>(DEFAULT_TAB_IDS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TAB_ORDER_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const validIds = new Set(TAB_CATALOG.map((c) => c.id));
        const clean = Array.isArray(parsed) ? parsed.filter((id) => validIds.has(id)) : [];
        if (clean.length > 0) setTabIdsState(clean);
      })
      .catch(console.warn)
      .finally(() => setLoaded(true));
  }, []);

  const persist = useCallback((next: TabPage[]) => {
    setTabIdsState(next);
    AsyncStorage.setItem(TAB_ORDER_STORAGE_KEY, JSON.stringify(next)).catch(console.warn);
  }, []);

  const addTab = useCallback((id: TabPage) => {
    persist([...tabIds, id].slice(0, MAX_CUSTOM_TABS));
  }, [tabIds, persist]);

  const removeTab = useCallback((id: TabPage) => {
    if (tabIds.length <= MIN_CUSTOM_TABS) return;
    persist(tabIds.filter((t) => t !== id));
  }, [tabIds, persist]);

  const moveTab = useCallback((id: TabPage, direction: -1 | 1) => {
    const index = tabIds.indexOf(id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= tabIds.length) return;
    const next = [...tabIds];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    persist(next);
  }, [tabIds, persist]);

  // Drag-to-reorder within the bar: move the tab at its current index to
  // `toIndex`, shifting everything between the two positions over by one.
  const reorderTab = useCallback((id: TabPage, toIndex: number) => {
    const from = tabIds.indexOf(id);
    const to = Math.max(0, Math.min(tabIds.length - 1, toIndex));
    if (from < 0 || from === to) return;
    const next = [...tabIds];
    next.splice(from, 1);
    next.splice(to, 0, id);
    persist(next);
  }, [tabIds, persist]);

  // Drag-from-More: if there's a free slot, insert at the dropped index;
  // if the bar is already full, swap out whatever's currently at that
  // index instead (the swapped-out page just goes back to being reachable
  // from More, same as anything else not on the bar).
  const insertOrSwap = useCallback((id: TabPage, atIndex: number) => {
    if (tabIds.includes(id)) return;
    const index = Math.max(0, Math.min(tabIds.length, atIndex));
    const next = [...tabIds];
    if (next.length < MAX_CUSTOM_TABS) {
      next.splice(index, 0, id);
    } else {
      next.splice(Math.min(index, next.length - 1), 1, id);
    }
    persist(next);
  }, [tabIds, persist]);

  const resetTabs = useCallback(() => persist(DEFAULT_TAB_IDS), [persist]);

  return { tabIds, loaded, addTab, removeTab, moveTab, reorderTab, insertOrSwap, resetTabs };
}
