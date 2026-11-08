import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const LAST_GROUP_KEY = "chore-app:last-group-id";

export function useGroup(user) {
  const [memberships, setMemberships] = useState([]); // [{group_id, display_name, role, groups:{name, invite_code}}]
  const [groupId, setGroupId] = useState(() => localStorage.getItem(LAST_GROUP_KEY) || null);
  const [roster, setRoster] = useState([]); // all members of the current group
  const [loading, setLoading] = useState(true);

  const refreshMemberships = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("memberships")
      .select("id, group_id, display_name, role, avatar_url, pronouns, notification_hour, notification_preferences, is_paused, active_cosmetics, sort_order, groups(id, name, icon, invite_code, allow_anyone_to_edit_chores, notification_language, nudge_policy, rewards_enabled, max_coin_reward, cosmetics_unlocked_for_all, restrict_coins_to_admins, allow_self_assigned_coins, weekly_leaderboard_prize_coins, monthly_leaderboard_prize_coins, yearly_leaderboard_prize_coins)")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true });
    if (!error && data) {
      setMemberships(data);
      const stillValid = data.some((m) => m.group_id === groupId);
      if (!stillValid) {
        const next = data[0]?.group_id || null;
        setGroupId(next);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, groupId]);

  useEffect(() => {
    refreshMemberships();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (groupId) localStorage.setItem(LAST_GROUP_KEY, groupId);
  }, [groupId]);

  const refreshRoster = useCallback(async () => {
    if (!groupId) {
      setRoster([]);
      return;
    }
    const { data, error } = await supabase
      .from("memberships")
      .select("user_id, display_name, role, avatar_url")
      .eq("group_id", groupId)
      .order("display_name");
    if (!error) setRoster(data || []);
  }, [groupId]);

  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);

  const currentMembership = memberships.find((m) => m.group_id === groupId) || null;

  const createGroup = useCallback(
    async (name, displayName) => {
      const { data, error } = await supabase.rpc("create_group", {
        p_name: name,
        p_display_name: displayName,
      });
      if (error) throw error;
      await refreshMemberships();
      setGroupId(data);
      return data;
    },
    [refreshMemberships]
  );

  const joinGroup = useCallback(
    async (inviteCode, displayName) => {
      const { data, error } = await supabase.rpc("join_group", {
        p_invite_code: inviteCode,
        p_display_name: displayName,
      });
      if (error) throw error;
      await refreshMemberships();
      setGroupId(data);
      return data;
    },
    [refreshMemberships]
  );

  const leaveGroup = useCallback(
    async (gid) => {
      const { error } = await supabase.rpc("leave_group", { p_group_id: gid });
      if (error) throw error;
      if (gid === groupId) {
        localStorage.removeItem(LAST_GROUP_KEY);
        setGroupId(null);
      }
      await refreshMemberships();
    },
    [groupId, refreshMemberships]
  );

  // Persist a new drag-and-drop order for the switcher list. Takes the
  // memberships array in its new order and writes sort_order 0..n-1 for
  // each — only touches this user's own rows (RLS: "members can update
  // own row"), so it never affects anyone else's list.
  const reorderMemberships = useCallback(
    async (orderedMemberships) => {
      setMemberships(orderedMemberships); // optimistic
      const updates = orderedMemberships.map((m, i) =>
        supabase.from("memberships").update({ sort_order: i }).eq("id", m.id)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
    },
    []
  );

  const setDisplayName = useCallback(
    async (newName) => {
      const { error } = await supabase.rpc("set_display_name", {
        p_group_id: groupId,
        p_new_name: newName,
      });
      if (error) throw error;
      await refreshMemberships();
      await refreshRoster();
    },
    [groupId, refreshMemberships, refreshRoster]
  );

  return {
    memberships,
    groupId,
    setGroupId,
    currentMembership,
    roster,
    refreshRoster,
    refreshMemberships,
    loading,
    createGroup,
    joinGroup,
    leaveGroup,
    reorderMemberships,
    setDisplayName,
  };
}
