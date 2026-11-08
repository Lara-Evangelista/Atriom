import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

/*
 * Mirrors web's CompletionEffects.jsx / THEME_FX 1:1 so a purchased effect +
 * equipped theme combo looks the same on both platforms: "confetti" renders
 * as rose petals in Victorian, playing cards in Wonderland, sparks in
 * Cyberpunk, etc. "shake" is handled separately in CosmeticsProvider (it
 * shakes the whole screen, not an overlay), so this component never renders
 * for effect === 'shake'.
 */
export type ThemeFx = { colors: string[]; glyphs: string[] | null };

export const THEME_FX: Record<string, ThemeFx> = {
  neutral: { colors: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899'], glyphs: null },
  minimalist: { colors: ['#111111', '#555555', '#999999'], glyphs: null },
  corporate: { colors: ['#4b5563', '#6b7280', '#9ca3af'], glyphs: null },
  cutesy: { colors: ['#ff6fa5', '#ffc1e3', '#ffe066', '#b5f2ea'], glyphs: ['🌸', '💖', '⭐', '🧁'] },
  cyberpunk: { colors: ['#00f0ff', '#ff00e6', '#00ff9d'], glyphs: ['◈', '⟐', '⌁', '⬡'] },
  fantasy: { colors: ['#c8a95a', '#8b1a1a', '#2f6f4e'], glyphs: ['⚔️', '🛡️', '✨', '🐉'] },
  victorian: { colors: ['#8b1a1a', '#c8a95a', '#2b2b2b'], glyphs: ['🥀', '❦', '✠', '🕯️'] },
  wonderland: { colors: ['#e74c3c', '#2c3e50', '#f1c40f'], glyphs: ['♠️', '♥️', '♣️', '♦️'] },
  steampunk: { colors: ['#cd7f32', '#8b5a2b', '#3a3a3a'], glyphs: ['⚙️', '🔩', '🧭', '⏱️'] },
  enchanted: { colors: ['#9b59b6', '#2ecc71', '#f8e6ff'], glyphs: ['🍃', '🧚', '🦋', '✨'] },
  cosmic: { colors: ['#7c4dff', '#00e5ff', '#ffd700'], glyphs: ['⭐', '💫', '🪐', '☄️'] },
  retro: { colors: ['#e85d04', '#ffb703', '#8ecae6'], glyphs: ['🌈', '✌️', '📻', '🕹️'] },
};

export function getFx(theme: string): ThemeFx {
  return THEME_FX[theme] || THEME_FX.neutral;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CENTER_X = SCREEN_W / 2;
const CENTER_Y = SCREEN_H / 2;

// ---- confetti ---------------------------------------------------------

function ConfettiParticle({ fx, index }: { fx: ThemeFx; index: number }) {
  const progress = useSharedValue(0);

  const cfg = useMemo(() => {
    const angle = Math.random() * 360;
    const dist = 50 + Math.random() * 200;
    const size = fx.glyphs ? 18 + Math.random() * 10 : 10;
    const rad = (angle * Math.PI) / 180;
    return {
      dx: Math.cos(rad) * dist,
      dy: Math.sin(rad) * dist,
      size,
      color: fx.colors[Math.floor(Math.random() * fx.colors.length)],
      glyph: fx.glyphs ? fx.glyphs[index % fx.glyphs.length] : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) });
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * cfg.dx },
      { translateY: progress.value * cfg.dy },
      { scale: progress.value * 1.5 },
      { rotate: `${progress.value * 720}deg` },
    ],
    opacity: 1 - progress.value,
  }));

  return (
    <Animated.View
      style={[
        styles.centeredParticle,
        { width: cfg.size, height: cfg.size, left: CENTER_X - cfg.size / 2, top: CENTER_Y - cfg.size / 2 },
        style,
      ]}>
      {cfg.glyph ? (
        <Text style={{ fontSize: cfg.size, lineHeight: cfg.size }}>{cfg.glyph}</Text>
      ) : (
        <View style={{ width: '100%', height: '100%', backgroundColor: cfg.color, borderRadius: 2 }} />
      )}
    </Animated.View>
  );
}

function ConfettiLayer({ fx }: { fx: ThemeFx }) {
  const count = 40;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ConfettiParticle key={i} fx={fx} index={i} />
      ))}
    </>
  );
}

// ---- fireworks ----------------------------------------------------------

const BURSTS = 4;
const SPARKS_PER_BURST = 12;

function FireworkSpark({ fx, burstIndex, sparkIndex }: { fx: ThemeFx; burstIndex: number; sparkIndex: number }) {
  const progress = useSharedValue(0);
  const visibility = useSharedValue(0);

  const cfg = useMemo(() => {
    const burstAngle = (burstIndex / BURSTS) * 360 + Math.random() * 40;
    const burstDist = 40 + Math.random() * 90;
    const burstX = Math.cos((burstAngle * Math.PI) / 180) * burstDist;
    const burstY = Math.sin((burstAngle * Math.PI) / 180) * burstDist;
    const a = (sparkIndex / SPARKS_PER_BURST) * 360;
    const d = 20 + Math.random() * 40;
    const size = fx.glyphs ? 14 : 6;
    return {
      burstX,
      burstY,
      dx: Math.cos((a * Math.PI) / 180) * d,
      dy: Math.sin((a * Math.PI) / 180) * d,
      size,
      delay: burstIndex * 180,
      color: fx.colors[sparkIndex % fx.colors.length],
      glyph: fx.glyphs ? fx.glyphs[sparkIndex % fx.glyphs.length] : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    visibility.value = withDelay(cfg.delay, withTiming(1, { duration: 0 }));
    progress.value = withDelay(cfg.delay, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
  }, [cfg.delay, progress, visibility]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: cfg.burstX + progress.value * cfg.dx },
      { translateY: cfg.burstY + progress.value * cfg.dy },
      { scale: 1 - progress.value * 0.7 },
    ],
    opacity: visibility.value * (1 - progress.value),
  }));

  return (
    <Animated.View
      style={[
        styles.centeredParticle,
        { width: cfg.size, height: cfg.size, left: CENTER_X - cfg.size / 2, top: CENTER_Y - cfg.size / 2 },
        style,
      ]}>
      {cfg.glyph ? (
        <Text style={{ fontSize: cfg.size, lineHeight: cfg.size }}>{cfg.glyph}</Text>
      ) : (
        <View style={{ width: '100%', height: '100%', backgroundColor: cfg.color, borderRadius: cfg.size / 2 }} />
      )}
    </Animated.View>
  );
}

function FireworksLayer({ fx }: { fx: ThemeFx }) {
  const items: { burst: number; spark: number }[] = [];
  for (let burst = 0; burst < BURSTS; burst++) {
    for (let spark = 0; spark < SPARKS_PER_BURST; spark++) items.push({ burst, spark });
  }
  return (
    <>
      {items.map(({ burst, spark }) => (
        <FireworkSpark key={`${burst}-${spark}`} fx={fx} burstIndex={burst} sparkIndex={spark} />
      ))}
    </>
  );
}

// ---- sparkles -------------------------------------------------------------

function SparkleParticle({ fx, index }: { fx: ThemeFx; index: number }) {
  const progress = useSharedValue(0);

  const cfg = useMemo(
    () => ({
      top: Math.random() * SCREEN_H,
      left: Math.random() * SCREEN_W,
      delay: Math.random() * 500,
      duration: 800 + Math.random() * 1000,
      color: fx.colors[index % fx.colors.length],
      glyph: fx.glyphs ? fx.glyphs[index % fx.glyphs.length] : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    progress.value = withDelay(cfg.delay, withTiming(1, { duration: cfg.duration, easing: Easing.inOut(Easing.quad) }));
  }, [cfg.delay, cfg.duration, progress]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const half = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;
    return {
      transform: [{ scale: half * 1.2 }, { rotate: `${p * 360}deg` }],
      opacity: half,
    };
  });

  return (
    <Animated.View style={[styles.sparkleBase, { top: cfg.top, left: cfg.left }, style]}>
      {cfg.glyph ? (
        <Text style={{ fontSize: 16 }}>{cfg.glyph}</Text>
      ) : (
        <View
          style={{
            width: 15,
            height: 15,
            backgroundColor: cfg.color,
            borderRadius: 3,
            transform: [{ rotate: '45deg' }],
          }}
        />
      )}
    </Animated.View>
  );
}

function SparklesLayer({ fx }: { fx: ThemeFx }) {
  const count = 20;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SparkleParticle key={i} fx={fx} index={i} />
      ))}
    </>
  );
}

// ---- wave -----------------------------------------------------------------

function WaveRing({ fx }: { fx: ThemeFx }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) });
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value * 4 }],
    opacity: 0.5 * (1 - progress.value),
  }));

  return (
    <View style={styles.waveContainer}>
      <Animated.View style={[styles.waveRing, { borderColor: fx.colors[0] }, style]} />
    </View>
  );
}

// ---- entry point ------------------------------------------------------------

export function CompletionEffects({
  effect,
  theme,
  active,
  triggerId,
}: {
  effect: string;
  theme: string;
  active: boolean;
  triggerId: number;
}) {
  const fx = getFx(theme);

  if (!active || effect === 'none' || effect === 'shake') return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {effect === 'confetti' && <ConfettiLayer key={triggerId} fx={fx} />}
      {effect === 'fireworks' && <FireworksLayer key={triggerId} fx={fx} />}
      {effect === 'sparkles' && <SparklesLayer key={triggerId} fx={fx} />}
      {effect === 'wave' && <WaveRing key={triggerId} fx={fx} />}
    </View>
  );
}

const styles = StyleSheet.create({
  centeredParticle: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleBase: {
    position: 'absolute',
    width: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 10,
  },
});

export default CompletionEffects;
