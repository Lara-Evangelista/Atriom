import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCosmetics } from '../contexts/CosmeticsProvider';

/*
 * ThemeDecorator renders immersive, theme-specific floating decorations
 * that appear in the background of the app. These are purely cosmetic
 * and use pointer-events: none so they never block interaction.
 */

const DECORATIONS = {
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

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export default function ThemeDecorator() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const { cosmetics } = useCosmetics();
  const theme = cosmetics?.theme || 'neutral';
  const deco = DECORATIONS[theme];

  if (!deco) return null; // neutral, minimalist, corporate have no decorations

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {/* Floating emoji decorations */}
      {deco.floaters.map((emoji, i) => {
        const top = seededRandom(i * 7 + 1) * 90 + 5;
        const left = seededRandom(i * 13 + 3) * 90 + 5;
        const size = 16 + seededRandom(i * 3 + 5) * 20;
        const opacity = 0.08 + seededRandom(i * 9 + 2) * 0.12;
        const rotation = seededRandom(i * 11 + 7) * 360;
        const animDuration = 20 + seededRandom(i * 5 + 1) * 40;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: `${top}%`,
              left: `${left}%`,
              fontSize: `${size}px`,
              opacity,
              transform: `rotate(${rotation}deg)`,
              animation: `float-drift ${animDuration}s ease-in-out infinite alternate`,
              animationDelay: `${i * -3}s`,
            }}
          >
            {emoji}
          </div>
        );
      })}

      {/* Corner label */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          fontSize: '10px',
          fontFamily: 'var(--font)',
          opacity: 0.2,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {deco.corner[lang]}
      </div>

      {/* Large watermark */}
      <div
        style={{
          position: 'absolute',
          bottom: -20,
          right: -20,
          fontSize: '200px',
          opacity: 0.03,
          transform: 'rotate(-15deg)',
          userSelect: 'none',
        }}
      >
        {deco.watermark}
      </div>

      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${deco.glowColor}, transparent 70%)`,
        }}
      />
    </div>
  );
}

/*
 * ThemeSectionHeader renders themed decorative section headers.
 * Use instead of plain <h2> in screens.
 */
export function ThemeSectionHeader({ children }) {
  const { cosmetics } = useCosmetics();
  const theme = cosmetics?.theme || 'neutral';

  const prefixes = {
    cyberpunk: '> ',
    fantasy: '⚔ ',
    victorian: '❧ ',
    wonderland: '🂡 ',
    steampunk: '⚙ ',
    enchanted: '✿ ',
    cosmic: '★ ',
    retro: '✦ ',
    cutesy: '♡ ',
  };

  const suffixes = {
    cyberpunk: ' _',
    fantasy: ' ⚔',
    victorian: ' ❧',
    wonderland: ' 🂡',
    steampunk: ' ⚙',
    enchanted: ' ✿',
    cosmic: ' ★',
    retro: ' ✦',
    cutesy: ' ♡',
  };

  return (
    <h2 className="text-xl font-bold mb-4 flex items-center">
      {prefixes[theme] || ''}{children}{suffixes[theme] || ''}
    </h2>
  );
}

/*
 * ThemeAppTitle renders the app name with theme-appropriate flair.
 */
export function ThemeAppTitle() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const { cosmetics } = useCosmetics();
  const theme = cosmetics?.theme || 'neutral';

  const titles = {
    en: {
      neutral: { emoji: '✨', name: 'TaskMaster' },
      minimalist: { emoji: '▪', name: 'TaskMaster' },
      cutesy: { emoji: '🌸', name: 'TaskMaster' },
      cyberpunk: { emoji: '⌁', name: 'TASK//MASTER' },
      fantasy: { emoji: '⚔️', name: 'Quest Board' },
      corporate: { emoji: '📋', name: 'TaskMaster' },
      victorian: { emoji: '🎩', name: 'The Task Registry' },
      wonderland: { emoji: '🐰', name: 'Down the Rabbit Hole' },
      steampunk: { emoji: '⚙️', name: 'The Taskwork' },
      enchanted: { emoji: '🧚', name: 'The Glade' },
      cosmic: { emoji: '🚀', name: 'Mission Control' },
      retro: { emoji: '📻', name: 'TaskMaster FM' },
    },
    pt: {
      neutral: { emoji: '✨', name: 'TaskMaster' },
      minimalist: { emoji: '▪', name: 'TaskMaster' },
      cutesy: { emoji: '🌸', name: 'TaskMaster' },
      cyberpunk: { emoji: '⌁', name: 'TASK//MESTRE' },
      fantasy: { emoji: '⚔️', name: 'Quadro de Demandas' },
      corporate: { emoji: '📋', name: 'TaskMaster' },
      victorian: { emoji: '🎩', name: 'O Registo de Tarefas' },
      wonderland: { emoji: '🐰', name: 'Pelo Buraco do Coelho' },
      steampunk: { emoji: '⚙️', name: 'A Oficina' },
      enchanted: { emoji: '🧚', name: 'A Clareira' },
      cosmic: { emoji: '🚀', name: 'Controlo de Missão' },
      retro: { emoji: '📻', name: 'TaskMaster FM' },
    },
  };

  const t = titles[lang][theme] || titles[lang].neutral;

  return (
    <h1 className="text-2xl font-black tracking-tight flex items-center">
      <span className="mr-2">{t.emoji}</span> {t.name}
    </h1>
  );
}
