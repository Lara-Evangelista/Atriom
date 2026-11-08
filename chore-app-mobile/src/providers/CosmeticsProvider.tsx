import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { CompletionEffects } from '../components/CompletionEffects';

type Cosmetics = { theme: string; effect: string };

type CosmeticsContextValue = {
  cosmetics: Cosmetics;
  setCosmetics: (newCosmetics: Partial<Cosmetics>) => Promise<void>;
  triggerEffect: () => void;
};

const defaultCosmetics: Cosmetics = { theme: 'neutral', effect: 'none' };

export const CosmeticsContext = createContext<CosmeticsContextValue>({
  cosmetics: defaultCosmetics,
  setCosmetics: async () => {},
  triggerEffect: () => {},
});

export const CosmeticsProvider = ({
  children,
  groupId,
  user,
}: {
  children: ReactNode;
  groupId?: string | null;
  user?: { id: string } | null;
}) => {
  const [cosmetics, setCosmeticsState] = useState<Cosmetics>(defaultCosmetics);
  const [showEffect, setShowEffect] = useState(false);
  const [triggerId, setTriggerId] = useState(0);

  // "shake" rattles the whole screen rather than showing an overlay, so it's
  // driven by transforming a wrapper around `children` instead of by
  // CompletionEffects. Timings mirror web's `screen-shake` keyframes
  // (0%/100% center, 25%/75% -10px/-1deg, 50% +10px/+1deg, over 0.5s).
  const shakeX = useSharedValue(0);
  const shakeRotate = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { rotate: `${shakeRotate.value}deg` }],
  }));

  useEffect(() => {
    if (!groupId || !user) return;
    const fetchWallet = async () => {
      const { data } = await supabase.rpc('get_user_wallet', { p_group_id: groupId });
      if (data && data[0] && data[0].active_cosmetics) {
        setCosmeticsState((prev) => ({ ...prev, ...data[0].active_cosmetics }));
      }
    };
    fetchWallet();
  }, [groupId, user]);

  const setCosmetics = async (newCosmetics: Partial<Cosmetics>) => {
    const updated = { ...cosmetics, ...newCosmetics };
    setCosmeticsState(updated);
    if (groupId) {
      await supabase.rpc('update_active_cosmetics', { p_group_id: groupId, p_active_cosmetics: updated });
    }
  };

  const triggerEffect = () => {
    if (!cosmetics.effect || cosmetics.effect === 'none') return;

    if (cosmetics.effect === 'shake') {
      shakeX.value = withSequence(
        withTiming(-10, { duration: 125 }),
        withTiming(10, { duration: 125 }),
        withTiming(-10, { duration: 125 }),
        withTiming(0, { duration: 125 })
      );
      shakeRotate.value = withSequence(
        withTiming(-1, { duration: 125 }),
        withTiming(1, { duration: 125 }),
        withTiming(-1, { duration: 125 }),
        withTiming(0, { duration: 125 })
      );
      return;
    }

    setTriggerId((id) => id + 1);
    setShowEffect(true);
    setTimeout(() => setShowEffect(false), 2500);
  };

  return (
    <CosmeticsContext.Provider value={{ cosmetics, setCosmetics, triggerEffect }}>
      <Animated.View style={[styles.shakeWrapper, shakeStyle]}>{children}</Animated.View>
      <CompletionEffects effect={cosmetics.effect} theme={cosmetics.theme} active={showEffect} triggerId={triggerId} />
    </CosmeticsContext.Provider>
  );
};

const styles = StyleSheet.create({
  shakeWrapper: {
    flex: 1,
  },
});

export const useCosmetics = () => useContext(CosmeticsContext);
