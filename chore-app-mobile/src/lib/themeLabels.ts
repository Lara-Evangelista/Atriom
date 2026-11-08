import type { TabPage } from './tabConfig';
import type { ThemeMode } from '@/providers/ThemeProvider';

export type Lang = 'en' | 'pt';

// Mobile counterpart to web's `THEME_LABELS` in App.jsx: each equipped
// theme swaps in its own vocabulary for page names (a chore tracker
// becomes a "Quest Board" in Fantasy, a "Bridge" in Cosmic, etc), kept as
// parallel en/pt dictionaries for the same reason web does — so each
// language keeps its own vibe instead of a literal word-for-word mapping.
//
// `habits` and `manage` have no web equivalent (mobile-only pages, since
// web has no separate "Manage Chores" screen and Habits isn't themed
// there), so their wording here is this port's own extrapolation in the
// same spirit as the rest of the theme — adjust freely if it doesn't land.
//
// Themes not listed (neutral, minimalist, corporate) intentionally fall
// through to the plain labelKey text, mirroring web's THEME_LABELS, which
// leaves those same three themes un-themed.
const THEME_LABELS: Record<Lang, Partial<Record<ThemeMode, Partial<Record<TabPage, string>>>>> = {
  en: {
    cyberpunk: { habits: 'Routines', today: 'Missions', create: 'Upload', manage: 'Directives', trades: 'Swap', stock: 'Inventory', calendar: 'Timeline', board: 'Rankings', rewards: 'Loot', you: 'Profile', settings: 'Config' },
    fantasy: { habits: 'Rituals', today: 'Quests', create: 'Forge', manage: 'Decrees', trades: 'Barter', stock: 'Armory', calendar: 'Chronicle', board: 'Hall of Fame', rewards: 'Treasury', you: 'Hero', settings: 'Spellbook' },
    victorian: { habits: 'Customs', today: 'Duties', create: 'Compose', manage: 'Ledger', trades: 'Exchange', stock: 'Provisions', calendar: 'Almanac', board: 'Honours', rewards: 'Parlour', you: 'Profile', settings: 'Registry' },
    wonderland: { habits: 'Wonders', today: 'Adventures', create: 'Brew', manage: 'Rulebook', trades: 'Swap', stock: 'Pantry', calendar: 'Tea Time', board: 'Croquet', rewards: 'Curiosities', you: 'You', settings: 'Looking Glass' },
    steampunk: { habits: 'Routines', today: 'Operations', create: 'Engineer', manage: 'Blueprints', trades: 'Exchange', stock: 'Depot', calendar: 'Clockwork', board: 'Meters', rewards: 'Workshop', you: 'Operator', settings: 'Controls' },
    enchanted: { habits: 'Rituals', today: 'Whispers', create: 'Grow', manage: 'Tending', trades: 'Trade', stock: 'Grove', calendar: 'Seasons', board: 'Spirits', rewards: 'Treasures', you: 'You', settings: 'Roots' },
    cosmic: { habits: 'Cycles', today: 'Missions', create: 'Launch', manage: 'Command', trades: 'Warp', stock: 'Cargo', calendar: 'Star Chart', board: 'Orbit', rewards: 'Space Store', you: 'Crew', settings: 'Bridge' },
    retro: { habits: 'Reruns', today: 'To-Do', create: 'Record', manage: 'Playlist', trades: 'Swap', stock: 'Stash', calendar: 'Schedule', board: 'High Score', rewards: 'Arcade', you: 'You', settings: 'Dial' },
    cutesy: { habits: 'Sparkles', today: 'My Tasks', create: 'Create', manage: 'To-Dos', trades: 'Swap', stock: 'Pantry', calendar: 'Planner', board: 'Stars', rewards: 'Goodies', you: 'Me', settings: 'Settings' },
  },
  pt: {
    cyberpunk: { habits: 'Rotinas', today: 'Missões', create: 'Upload', manage: 'Diretivas', trades: 'Troca', stock: 'Inventário', calendar: 'Timeline', board: 'Rankings', rewards: 'Loot', you: 'Perfil', settings: 'Config' },
    fantasy: { habits: 'Rituais', today: 'Demandas', create: 'Forja', manage: 'Éditos', trades: 'Escambo', stock: 'Armaria', calendar: 'Crónica', board: 'Salão da Fama', rewards: 'Tesouro', you: 'Herói', settings: 'Grimório' },
    victorian: { habits: 'Costumes', today: 'Deveres', create: 'Redigir', manage: 'Livro-Razão', trades: 'Permuta', stock: 'Provisões', calendar: 'Almanaque', board: 'Honras', rewards: 'Salão', you: 'Perfil', settings: 'Registo' },
    wonderland: { habits: 'Maravilhas', today: 'Aventuras', create: 'Poção', manage: 'Regulamento', trades: 'Troca', stock: 'Despensa', calendar: 'Hora do Chá', board: 'Croquet', rewards: 'Curiosidades', you: 'Tu', settings: 'Espelho' },
    steampunk: { habits: 'Rotinas', today: 'Operações', create: 'Engenharia', manage: 'Plantas', trades: 'Câmbio', stock: 'Depósito', calendar: 'Engrenagens', board: 'Medidores', rewards: 'Oficina', you: 'Operador', settings: 'Comandos' },
    enchanted: { habits: 'Rituais', today: 'Sussurros', create: 'Cultivar', manage: 'Cuidado', trades: 'Troca', stock: 'Bosque', calendar: 'Estações', board: 'Espíritos', rewards: 'Tesouros', you: 'Tu', settings: 'Raízes' },
    cosmic: { habits: 'Ciclos', today: 'Missões', create: 'Lançamento', manage: 'Comando', trades: 'Dobra', stock: 'Carga', calendar: 'Carta Estelar', board: 'Órbita', rewards: 'Loja Espacial', you: 'Tripulação', settings: 'Ponte de Comando' },
    retro: { habits: 'Reprises', today: 'A Fazer', create: 'Gravar', manage: 'Playlist', trades: 'Troca', stock: 'Reserva', calendar: 'Horário', board: 'Recorde', rewards: 'Arcade', you: 'Tu', settings: 'Sintonizador' },
    cutesy: { habits: 'Brilhos', today: 'As Minhas Tarefas', create: 'Criar', manage: 'Tarefas', trades: 'Troca', stock: 'Despensa', calendar: 'Planeador', board: 'Estrelas', rewards: 'Mimos', you: 'Eu', settings: 'Definições' },
  },
};

export function themeLang(bcp47: string | undefined): Lang {
  return bcp47?.startsWith('pt') ? 'pt' : 'en';
}

// Looks up the themed word for a page, falling back to the plain
// (translated) label when the active theme has no entry for that page —
// i.e. neutral/minimalist/corporate, or a page id we haven't mapped.
export function themeLabel(lang: Lang, mode: ThemeMode, id: TabPage, fallback: string): string {
  return THEME_LABELS[lang]?.[mode]?.[id] ?? fallback;
}
