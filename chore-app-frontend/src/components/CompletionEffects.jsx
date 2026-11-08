import React, { useEffect, useState } from 'react';
import { useCosmetics } from '../contexts/CosmeticsProvider';

/*
 * Per-theme flavor for completion effects. Each theme swaps in its own
 * glyphs/colors so "confetti" reads as sparks in Cyberpunk, rose petals
 * in Victorian, playing cards in Wonderland, etc. rather than the same
 * generic colored squares everywhere.
 */
const THEME_FX = {
  neutral:    { colors: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899'], glyphs: null },
  minimalist: { colors: ['#111111', '#555555', '#999999'],            glyphs: null },
  corporate:  { colors: ['#4b5563', '#6b7280', '#9ca3af'],            glyphs: null },
  cutesy:     { colors: ['#ff6fa5', '#ffc1e3', '#ffe066', '#b5f2ea'], glyphs: ['🌸', '💖', '⭐', '🧁'] },
  cyberpunk:  { colors: ['#00f0ff', '#ff00e6', '#00ff9d'],            glyphs: ['◈', '⟐', '⌁', '⬡'] },
  fantasy:    { colors: ['#c8a95a', '#8b1a1a', '#2f6f4e'],            glyphs: ['⚔️', '🛡️', '✨', '🐉'] },
  victorian:  { colors: ['#8b1a1a', '#c8a95a', '#2b2b2b'],            glyphs: ['🥀', '❦', '✠', '🕯️'] },
  wonderland: { colors: ['#e74c3c', '#2c3e50', '#f1c40f'],            glyphs: ['♠️', '♥️', '♣️', '♦️'] },
  steampunk:  { colors: ['#cd7f32', '#8b5a2b', '#3a3a3a'],            glyphs: ['⚙️', '🔩', '🧭', '⏱️'] },
  enchanted:  { colors: ['#9b59b6', '#2ecc71', '#f8e6ff'],            glyphs: ['🍃', '🧚', '🦋', '✨'] },
  cosmic:     { colors: ['#7c4dff', '#00e5ff', '#ffd700'],            glyphs: ['⭐', '💫', '🪐', '☄️'] },
  retro:      { colors: ['#e85d04', '#ffb703', '#8ecae6'],            glyphs: ['🌈', '✌️', '📻', '🕹️'] },
};

function getFx(theme) {
  return THEME_FX[theme] || THEME_FX.neutral;
}

const CompletionEffects = ({ effect, visible, onComplete }) => {
  const { cosmetics } = useCosmetics();
  const theme = cosmetics?.theme || 'neutral';
  const fx = getFx(theme);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (visible) {
      setActive(true);
      if (effect === 'shake') {
        document.body.style.animation = 'screen-shake 0.5s ease-in-out';
        setTimeout(() => {
          document.body.style.animation = '';
          setActive(false);
          onComplete && onComplete();
        }, 500);
      } else {
        setTimeout(() => {
          setActive(false);
          onComplete && onComplete();
        }, 2500); // 2.5 seconds for visual effects
      }
    }
  }, [visible, effect]);

  if (!active || effect === 'none' || effect === 'shake') return null;

  const renderParticles = (count, baseClass, styleFn, glyphFn) => {
    return Array.from({ length: count }).map((_, i) => {
      const style = styleFn(i);
      const glyph = glyphFn ? glyphFn(i) : null;
      if (glyph) {
        return (
          <div key={i} style={{ ...style, backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {glyph}
          </div>
        );
      }
      return <div key={i} className={baseClass} style={style} />;
    });
  };

  const getStyle = () => {
    switch (effect) {
      case 'confetti':
        return {
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden',
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        };
      case 'fireworks':
      case 'sparkles':
      case 'wave':
        return {
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        };
      default:
        return {};
    }
  };

  return (
    <div style={getStyle()}>
      {effect === 'confetti' && renderParticles(
        50,
        'confetti-particle',
        (i) => {
          const angle = Math.random() * 360;
          const dist = 50 + Math.random() * 200;
          const size = fx.glyphs ? 18 + Math.random() * 10 : 10;
          return {
            position: 'absolute',
            width: `${size}px`, height: `${size}px`,
            fontSize: `${size}px`, lineHeight: 1,
            backgroundColor: fx.colors[Math.floor(Math.random() * fx.colors.length)],
            animation: 'confetti-burst 1.5s ease-out forwards',
            transformOrigin: `${Math.cos(angle * Math.PI / 180) * dist}px ${Math.sin(angle * Math.PI / 180) * dist}px`,
          };
        },
        fx.glyphs ? (i) => fx.glyphs[i % fx.glyphs.length] : null
      )}

      {effect === 'fireworks' && Array.from({ length: 4 }).map((_, burst) => {
        const angle = (burst / 4) * 360 + Math.random() * 40;
        const dist = 40 + Math.random() * 90;
        const delay = burst * 0.18;
        return (
          <div
            key={burst}
            style={{
              position: 'absolute',
              left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * dist}px)`,
              top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * dist}px)`,
              animation: `firework-burst 0.9s ease-out ${delay}s forwards`,
              opacity: 0,
            }}
          >
            {renderParticles(
              14,
              'confetti-particle',
              (i) => {
                const a = (i / 14) * 360;
                const d = 20 + Math.random() * 40;
                const size = fx.glyphs ? 14 : 6;
                return {
                  position: 'absolute',
                  width: `${size}px`, height: `${size}px`,
                  fontSize: `${size}px`, lineHeight: 1, borderRadius: '50%',
                  backgroundColor: fx.colors[i % fx.colors.length],
                  animation: `firework-spark 0.7s ease-out ${delay}s forwards`,
                  '--spark-x': `${Math.cos(a * Math.PI / 180) * d}px`,
                  '--spark-y': `${Math.sin(a * Math.PI / 180) * d}px`,
                };
              },
              fx.glyphs ? (i) => fx.glyphs[i % fx.glyphs.length] : null
            )}
          </div>
        );
      })}

      {effect === 'sparkles' && renderParticles(
        20,
        'sparkle',
        (i) => ({
          position: 'absolute',
          top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
          width: '15px', height: '15px',
          fontSize: fx.glyphs ? '16px' : undefined,
          backgroundColor: fx.glyphs ? 'transparent' : fx.colors[i % fx.colors.length],
          clipPath: fx.glyphs ? 'none' : 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
          animation: `sparkle-shine ${0.8 + Math.random()}s ease-in-out forwards ${Math.random() * 0.5}s`,
        }),
        fx.glyphs ? (i) => fx.glyphs[i % fx.glyphs.length] : null
      )}

      {effect === 'wave' && (
        <div style={{
          width: '100px', height: '100px', borderRadius: '50%',
          border: `10px solid ${fx.colors[0]}`,
          opacity: 0,
          animation: 'wave-ripple 1.5s ease-out forwards'
        }} />
      )}
    </div>
  );
};

export default CompletionEffects;
