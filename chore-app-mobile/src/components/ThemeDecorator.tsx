import React, { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/ThemeProvider';

/*
 * Mobile counterpart to web's ThemeDecorator.jsx: immersive, theme-specific
 * floating decorations behind the app content. Purely cosmetic — the whole
 * tree is pointerEvents="none" so it never intercepts touches.
 */

type Deco = {
  floaters: string[];
  corner: { en: string; pt: string };
  watermark: string;
  glowColor: string;
};

const DECORATIONS: Record<string, Deco> = {
  cyberpunk: {
    floaters: ['⌁', '◈', '⬡', '⟐', '◬'],
    corner: { en: '// SYSTEM ONLINE', pt: '// SISTEMA ONLINE' },
    watermark: '> _',
    glowColor: 'rgba(0, 240, 255, 0.15)',
  },
  fantasy: {
    floaters: ['⚔️', '🛡️', '🗡️', '📜', '🏰'],
    corner: { en: '⚜ Quest Log ⚜', pt: '⚜ Diário de Demandas ⚜' },
    watermark: '🐉',
    glowColor: 'rgba(200, 169, 90, 0.1)',
  },
  victorian: {
    floaters: ['🎩', '🕯️', '⚜', '🔑', '📿'],
    corner: { en: '❦ Est. 1885 ❦', pt: '❦ Fund. 1885 ❦' },
    watermark: '✠',
    glowColor: 'rgba(139, 26, 26, 0.08)',
  },
  wonderland: {
    floaters: ['🐰', '🍄', '🫖', '♠️', '♥️', '♣️', '♦️', '🎪'],
    corner: { en: '"Curiouser and curiouser!"', pt: '"Cada vez mais estranho!"' },
    watermark: '🐱',
    glowColor: 'rgba(231, 76, 60, 0.08)',
  },
  steampunk: {
    floaters: ['⚙️', '🔩', '🔧', '⏱️', '🧭'],
    corner: { en: '⚙ STEAM POWERED ⚙', pt: '⚙ A VAPOR ⚙' },
    watermark: '⚙',
    glowColor: 'rgba(205, 127, 50, 0.1)',
  },
  enchanted: {
    floaters: ['🧚', '🌿', '🍃', '✨', '🦋', '🌸'],
    corner: { en: '~ Enchanted ~', pt: '~ Encantado ~' },
    watermark: '🌙',
    glowColor: 'rgba(155, 89, 182, 0.08)',
  },
  cosmic: {
    floaters: ['⭐', '🪐', '🌙', '☄️', '💫', '🛸'],
    corner: { en: '★ STARDATE 2026.09 ★', pt: '★ DATA ESTELAR 2026.09 ★' },
    watermark: '🌌',
    glowColor: 'rgba(124, 77, 255, 0.1)',
  },
  retro: {
    floaters: ['📻', '🕹️', '📼', '💾', '🎸', '🌈'],
    corner: { en: '~ Groovy ~', pt: '~ Fixe ~' },
    watermark: '✌️',
    glowColor: 'rgba(232, 93, 4, 0.08)',
  },
  cutesy: {
    floaters: ['🌸', '💖', '🎀', '🧁', '🌈', '⭐'],
    corner: { en: '♡ cute mode ♡', pt: '♡ modo fofo ♡' },
    watermark: '🦄',
    glowColor: 'rgba(255, 111, 165, 0.08)',
  },
};

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function ThemeDecorator() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const { mode, colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const deco = DECORATIONS[mode];

  if (!deco) return null; // neutral, minimalist, corporate have no decorations

  const glowSize = Math.min(width, height) * 1.1;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {/* Floating emoji decorations */}
        {deco.floaters.map((emoji, i) => (
          <Floater
            key={i}
            emoji={emoji}
            index={i}
            count={deco.floaters.length}
            width={width}
            height={height}
          />
        ))}

        {/* Large watermark */}
        <Text
          style={{
            position: 'absolute',
            bottom: -10,
            right: -10,
            fontSize: Math.min(width, height) * 0.42,
            opacity: 0.03,
            color: colors.ink,
            transform: [{ rotate: '-15deg' }],
          }}
        >
          {deco.watermark}
        </Text>
      </View>

      {/* Corner label */}
      <Text
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          fontSize: 10,
          opacity: 0.25,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: colors.muted,
          fontFamily: colors.fontRegular,
        }}
      >
        {deco.corner[lang]}
      </Text>
    </View>
  );
}

function Floater({
  emoji,
  index,
  count,
  width,
  height,
}: {
  emoji: string;
  index: number;
  count: number;
  width: number;
  height: number;
}) {
  // Place floaters on a jittered grid (rather than pure random x/y) so a
  // handful of emojis can't randomly land on top of one another — each one
  // gets its own cell and only wanders a bit within it.
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  const jitterX = (seededRandom(index * 13 + 3) - 0.5) * cellW * 0.5;
  const jitterY = (seededRandom(index * 7 + 1) - 0.5) * cellH * 0.5;
  const top = row * cellH + cellH / 2 + jitterY;
  const left = col * cellW + cellW / 2 + jitterX;
  const size = 16 + seededRandom(index * 3 + 5) * 20;
  const opacity = 0.16 + seededRandom(index * 9 + 2) * 0.18;
  const baseRotation = seededRandom(index * 11 + 7) * 360;
  const durationMs = (10 + seededRandom(index * 5 + 1) * 20) * 1000; // half-cycle
  const driftY = 10 + seededRandom(index * 17 + 4) * 14;
  const driftRotate = 6 + seededRandom(index * 19 + 6) * 10;

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * -300,
      withRepeat(
        withSequence(
          withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: durationMs, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -driftY / 2 + progress.value * driftY },
      { rotate: `${baseRotation - driftRotate / 2 + progress.value * driftRotate}deg` },
    ],
  }));

  return (
    <Animated.Text
      style={[
        {
          position: 'absolute',
          top,
          left,
          fontSize: size,
          opacity,
        },
        style,
      ]}
    >
      {emoji}
    </Animated.Text>
  );
}
