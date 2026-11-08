import { createContext, useContext, useMemo } from 'react';
import { useCosmetics } from '@/providers/CosmeticsProvider';

// These palettes mirror the web app's [data-theme] CSS variables 1:1 (see
// index.css on web) so a theme purchased/equipped in Rewards > Cosmetics
// looks the same on both platforms. `blue` has no web equivalent (used only
// for link-style text on mobile) so it borrows each theme's warn hue for a
// bit of variety instead of just reusing the accent everywhere.
//
// `fontRegular`/`fontBold` are the mobile counterpart to web's per-theme
// `--font` CSS variable. Unlike web, React Native can't fall back through a
// font-family stack of fonts the OS already has installed — Consolas,
// Georgia, Comic Sans MS etc. either don't exist on Android at all or render
// inconsistently between iOS/Android, so each themed font here is an
// open-source, metric-similar Google Font bundled into the app (loaded in
// src/app/_layout.tsx) instead of the literal web font. `undefined` means
// "use the OS default", matching the themes whose web `--font` is just the
// system font stack (neutral, minimalist, cosmic).
export const themes = {
  neutral: { ink: '#20231D', muted: '#6E746B', paper: '#F7F7F2', surface: '#FFFFFF', line: '#E4E7DE', accent: '#E7623E', accentInk: '#FFFFFF', green: '#2E7A59', blue: '#9A6825', red: '#BD4545', fontRegular: undefined, fontBold: undefined },
  minimalist: { ink: '#202020', muted: '#737373', paper: '#F7F7F5', surface: '#FFFFFF', line: '#D9D9D5', accent: '#202020', accentInk: '#FFFFFF', green: '#336B4E', blue: '#8A5A20', red: '#A84034', fontRegular: undefined, fontBold: undefined },
  cutesy: { ink: '#6B3F5C', muted: '#B98AA8', paper: '#FFF3F8', surface: '#FFFFFF', line: '#FBD3E6', accent: '#FF6FA5', accentInk: '#FFFFFF', green: '#58C48A', blue: '#FFA24D', red: '#FF6161', fontRegular: 'Quicksand_400Regular', fontBold: 'Quicksand_700Bold' },
  cyberpunk: { ink: '#FFFFFF', muted: '#00F0FF', paper: '#0D0D1A', surface: '#1A1A2E', line: '#00F0FF', accent: '#FF00E6', accentInk: '#FFFFFF', green: '#00FF9D', blue: '#FFDD00', red: '#FF003C', fontRegular: 'JetBrainsMono_400Regular', fontBold: 'JetBrainsMono_700Bold' },
  fantasy: { ink: '#4A3A22', muted: '#8B7355', paper: '#F5ECD7', surface: '#FDF9EE', line: '#D5C299', accent: '#C8A95A', accentInk: '#4A3A22', green: '#5B8246', blue: '#D98C00', red: '#B43333', fontRegular: 'EBGaramond_400Regular', fontBold: 'EBGaramond_700Bold' },
  corporate: { ink: '#1F2937', muted: '#6B7280', paper: '#F0F2F5', surface: '#FFFFFF', line: '#CCD1D9', accent: '#2B4C7E', accentInk: '#FFFFFF', green: '#059669', blue: '#D97706', red: '#DC2626', fontRegular: 'Arimo_400Regular', fontBold: 'Arimo_700Bold' },
  victorian: { ink: '#3B2218', muted: '#7D6453', paper: '#F5EDE3', surface: '#FBF7F2', line: '#C4A882', accent: '#8B1A1A', accentInk: '#F5E6D0', green: '#556B2F', blue: '#B8860B', red: '#8B0000', fontRegular: 'CormorantGaramond_400Regular', fontBold: 'CormorantGaramond_700Bold' },
  wonderland: { ink: '#2C3E50', muted: '#7F8C8D', paper: '#F0F7FF', surface: '#FFFFFF', line: '#A8D4F2', accent: '#E74C3C', accentInk: '#FFFFFF', green: '#27AE60', blue: '#F39C12', red: '#C0392B', fontRegular: 'ComicNeue_400Regular', fontBold: 'ComicNeue_700Bold' },
  steampunk: { ink: '#3D2B1F', muted: '#7A6248', paper: '#E8DCC8', surface: '#F5EDDF', line: '#B8976A', accent: '#CD7F32', accentInk: '#1A0F08', green: '#6B8E23', blue: '#DAA520', red: '#8B4513', fontRegular: 'CourierPrime_400Regular', fontBold: 'CourierPrime_700Bold' },
  enchanted: { ink: '#1B3A1B', muted: '#5A8A5A', paper: '#E8F3E8', surface: '#F5FAF5', line: '#8FBC8F', accent: '#9B59B6', accentInk: '#FFFFFF', green: '#228B22', blue: '#DAA520', red: '#B22222', fontRegular: 'Comfortaa_400Regular', fontBold: 'Comfortaa_700Bold' },
  cosmic: { ink: '#E8E6FF', muted: '#8B88B0', paper: '#0B0E17', surface: '#141829', line: '#2E3555', accent: '#7C4DFF', accentInk: '#FFFFFF', green: '#69F0AE', blue: '#FFD54F', red: '#FF5252', fontRegular: undefined, fontBold: undefined },
  retro: { ink: '#4A2C0A', muted: '#9B7340', paper: '#FFF5E6', surface: '#FFFAF2', line: '#E8C59A', accent: '#E85D04', accentInk: '#FFFFFF', green: '#38A169', blue: '#D4A017', red: '#E53E3E', fontRegular: 'Baloo2_400Regular', fontBold: 'Baloo2_700Bold' },
} as const;

export type ThemeMode = keyof typeof themes;
// Shared shape for a theme's palette. Every theme in `themes` has this same
// set of keys — widening from `typeof themes.neutral` (which pins every key
// to that one theme's literal hex strings, e.g. `ink: "#20231D"`) to this
// structural type lets any theme's colors flow into `createStyles` and any
// other consumer without a type mismatch. Purely a typing change — the
// values themselves are untouched.
export type Colors = {
  [K in keyof typeof themes.neutral as K extends 'fontRegular' | 'fontBold' ? never : K]: string;
} & {
  fontRegular?: string;
  fontBold?: string;
};
type ThemeState = { mode: ThemeMode; colors: Colors };
const ThemeContext = createContext<ThemeState | null>(null);

function isThemeMode(value: string): value is ThemeMode {
  return Object.prototype.hasOwnProperty.call(themes, value);
}

// Theme is not a separate mobile-only preference: exactly like web, the
// active theme comes from whichever theme cosmetic is equipped (Rewards >
// Cosmetics). This provider must render inside CosmeticsProvider.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { cosmetics } = useCosmetics();
  const mode: ThemeMode = isThemeMode(cosmetics.theme) ? cosmetics.theme : 'neutral';
  const value = useMemo(() => ({ mode, colors: themes[mode] }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}
