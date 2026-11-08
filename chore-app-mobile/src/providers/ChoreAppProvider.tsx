import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { registerPushIfPermitted } from '@/lib/push';

type Membership = {
  id?: string;
  user_id?: string;
  group_id: string;
  display_name: string;
  role: string;
  avatar_url?: string | null;
  notification_hour?: number;
  notification_preferences?: any;
  pronouns?: string;
  is_paused?: boolean;
  sort_order?: number;
  groups?: { name: string; invite_code: string; icon?: string | null; timezone?: string; allow_anyone_to_edit_chores?: boolean; nudge_policy?: string; notification_language?: string; rewards_enabled?: boolean; max_coin_reward?: number; restrict_coins_to_admins?: boolean; allow_self_assigned_coins?: boolean; cosmetics_unlocked_for_all?: boolean; } | null;
};
type Member = { user_id: string; display_name: string; role: string; avatar_url?: string | null };

type ChoreAppState = {
  session: Session | null | undefined;
  user: User | null;
  memberships: Membership[];
  roster: Member[];
  groupId: string | null;
  groupName: string;
  currentMembership: Membership | null;
  loadingGroup: boolean;
  setGroupId: (id: string) => void;
  refresh: () => Promise<void>;
  refreshRoster: () => Promise<void>;
  createGroup: (name: string, displayName: string) => Promise<void>;
  joinGroup: (code: string, displayName: string) => Promise<void>;
  leaveGroup: (groupIdToLeave: string) => Promise<void>;
  reorderMemberships: (orderedMemberships: Membership[]) => Promise<void>;
  signOut: () => Promise<void>;
};

const ChoreAppContext = createContext<ChoreAppState | null>(null);
const LAST_GROUP_KEY = 'chores:last-group-id';

export function ChoreAppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [roster, setRoster] = useState<Member[]>([]);
  const [groupId, setGroupIdState] = useState<string | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) registerPushIfPermitted();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) registerPushIfPermitted();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Roster is per-group and was previously only fetched when groupId changed,
  // so anything that changed a member (e.g. making someone admin) never showed
  // up until the app was restarted.
  const loadRoster = useCallback(async (gid: string | null) => {
    if (!gid) { setRoster([]); return; }
    const { data, error } = await supabase
      .from('memberships')
      .select('user_id, display_name, role, avatar_url')
      .eq('group_id', gid)
      .order('display_name');
    if (error) { console.warn(error); return; }
    setRoster((data ?? []) as Member[]);
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setMemberships([]);
      setRoster([]);
      setLoadingGroup(false);
      return;
    }
    setLoadingGroup(true);
    const savedGroup = await AsyncStorage.getItem(LAST_GROUP_KEY);
    const { data: nextMemberships, error } = await supabase
      .from('memberships')
      .select('id, user_id, group_id, display_name, role, avatar_url, notification_hour, notification_preferences, pronouns, is_paused, sort_order, groups(name, invite_code, icon, timezone, allow_anyone_to_edit_chores, nudge_policy, notification_language, rewards_enabled, max_coin_reward, restrict_coins_to_admins, allow_self_assigned_coins, cosmetics_unlocked_for_all, weekly_leaderboard_prize_coins, monthly_leaderboard_prize_coins, yearly_leaderboard_prize_coins)')
      .eq('user_id', session.user.id)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    const available = (nextMemberships ?? []).map((row) => ({
      ...row,
      groups: Array.isArray(row.groups) ? row.groups[0] ?? null : row.groups,
    })) as Membership[];
    setMemberships(available);
    const chosen = available.some((item) => item.group_id === groupId)
      ? groupId
      : available.some((item) => item.group_id === savedGroup)
        ? savedGroup
        : available[0]?.group_id ?? null;
    setGroupIdState(chosen);
    if (chosen) await AsyncStorage.setItem(LAST_GROUP_KEY, chosen);
    await loadRoster(chosen);
    setLoadingGroup(false);
  }, [groupId, session?.user, loadRoster]);

  const refreshRoster = useCallback(() => loadRoster(groupId), [groupId, loadRoster]);

  useEffect(() => {
    refresh().catch(console.warn);
  }, [refresh]);

  useEffect(() => {
    loadRoster(groupId).catch(console.warn);
  }, [groupId, loadRoster]);

  const setGroupId = useCallback((id: string) => {
    setGroupIdState(id);
    AsyncStorage.setItem(LAST_GROUP_KEY, id).catch(console.warn);
  }, []);

  const createGroup = useCallback(async (name: string, displayName: string) => {
    const { data, error } = await supabase.rpc('create_group', { p_name: name, p_display_name: displayName });
    if (error) throw error;
    setGroupId(String(data));
    await refresh();
  }, [refresh, setGroupId]);

  const joinGroup = useCallback(async (code: string, displayName: string) => {
    const { data, error } = await supabase.rpc('join_group', { p_invite_code: code, p_display_name: displayName });
    if (error) throw error;
    setGroupId(String(data));
    await refresh();
  }, [refresh, setGroupId]);

  const leaveGroup = useCallback(async (groupIdToLeave: string) => {
    const { error } = await supabase.rpc('leave_group', { p_group_id: groupIdToLeave });
    if (error) throw error;
    if (groupIdToLeave === groupId) {
      await AsyncStorage.removeItem(LAST_GROUP_KEY);
      setGroupIdState(null);
    }
    await refresh();
  }, [groupId, refresh]);

  // Persist a new order for the household switcher list. Mirrors web's
  // useGroup.js: only writes sort_order 0..n-1 on this user's own rows
  // (RLS scopes updates to "members can update own row"), so it never
  // touches anyone else's list.
  const reorderMemberships = useCallback(async (orderedMemberships: Membership[]) => {
    setMemberships(orderedMemberships); // optimistic
    const updates = orderedMemberships.map((m, i) =>
      supabase.from('memberships').update({ sort_order: i }).eq('id', m.id)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(LAST_GROUP_KEY);
    await supabase.auth.signOut();
  }, []);

  const currentMembership = memberships.find((item) => item.group_id === groupId) ?? null;
  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    memberships,
    roster,
    groupId,
    groupName: currentMembership?.groups?.name ?? 'Chores',
    currentMembership,
    loadingGroup,
    setGroupId,
    refresh,
    refreshRoster,
    createGroup,
    joinGroup,
    leaveGroup,
    reorderMemberships,
    signOut,
  }), [session, memberships, roster, groupId, currentMembership, loadingGroup, setGroupId, refresh, refreshRoster, createGroup, joinGroup, leaveGroup, reorderMemberships, signOut]);

  return <ChoreAppContext.Provider value={value}>{children}</ChoreAppContext.Provider>;
}

export function useChoreApp() {
  const state = useContext(ChoreAppContext);
  if (!state) throw new Error('useChoreApp must be used inside ChoreAppProvider');
  return state;
}
