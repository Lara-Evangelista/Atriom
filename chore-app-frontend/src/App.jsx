import React, { useEffect, useState } from "react";
import { 
  ListChecks, PlusCircle, ArrowLeftRight, PackageSearch, CalendarDays, Trophy, User, Settings as SettingsIcon, Gift,
  Terminal, Cpu, Zap, Activity as CyberActivity, Hexagon,
  Sword, Scroll, Shield, Crown, Castle,
  BookOpen, Feather, Pocket, Hourglass, Gem,
  Spade, Heart, Club, Cherry, Smile,
  Wrench, Compass, Anchor, Settings2, Hammer,
  Leaf, Flower, Trees, Moon, Sparkles,
  Star, Rocket, Globe2, Telescope, Orbit,
  Radio, Tv, CassetteTape, Music, Camera,
  Flame, Users
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./hooks/useAuth";
import { useGroup } from "./hooks/useGroup";
import { useTranslation } from "react-i18next";
import { CosmeticsProvider, useCosmetics } from "./contexts/CosmeticsProvider";

import Auth from "./screens/Auth";
import Household from "./screens/Household";
import Habits from "./screens/Habits";
import Today from "./screens/Today";
import CreateChore from "./screens/CreateChore";
import Trades from "./screens/Trades";
import Stock from "./screens/Stock";
import CalendarScreen from "./screens/Calendar";
import Leaderboard from "./screens/Leaderboard";
import You from "./screens/You";
import Settings from "./screens/Settings";
import Rewards from "./screens/Rewards";
import ThemeDecorator, { ThemeAppTitle } from "./components/ThemeDecorator";
import HouseholdSwitcher from "./components/HouseholdSwitcher";
import { IconGlyph } from "./components/UI";

const CenteredNote = ({ children }) => (
  <div className="flex h-full items-center justify-center p-4 text-center app-muted app-bg">
    {children}
  </div>
);

function AppInner({ group, user, authLoading, t }) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const { cosmetics } = useCosmetics();
  const currentTheme = cosmetics?.theme || 'neutral';
  const [tab, setTab] = useState("today");
  const [tabInitialized, setTabInitialized] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  // Habits work with zero groups. Land people who haven't joined/created a
  // group yet on Habits instead of a dead-end "today" tab that doesn't
  // exist for them — but only decide this once, right after the group
  // hook finishes loading, so it never overrides a manual tab switch.
  useEffect(() => {
    if (!tabInitialized && !group.loading) {
      setTab(group.groupId ? "today" : "habits");
      setTabInitialized(true);
    }
  }, [group.loading, group.groupId, tabInitialized]);

  // Once someone creates/joins their first group, the "Groups" tab they
  // were just sitting on disappears (it only exists pre-group) — send
  // them somewhere that still exists instead of leaving `tab` dangling.
  useEffect(() => {
    if (tab === "groups" && group.groupId) {
      setTab("today");
    }
  }, [tab, group.groupId]);

  const getThemeIcons = () => {
    switch(currentTheme) {
      case 'cyberpunk': return { today: Terminal, create: Cpu, trades: ArrowLeftRight, stock: Hexagon, calendar: CalendarDays, leaderboard: CyberActivity, rewards: Zap, you: User, settings: SettingsIcon };
      case 'fantasy': return { today: Scroll, create: Sword, trades: ArrowLeftRight, stock: Shield, calendar: CalendarDays, leaderboard: Crown, rewards: Castle, you: User, settings: SettingsIcon };
      case 'victorian': return { today: BookOpen, create: Feather, trades: ArrowLeftRight, stock: Pocket, calendar: Hourglass, leaderboard: Gem, rewards: Gift, you: User, settings: SettingsIcon };
      case 'wonderland': return { today: Spade, create: Heart, trades: ArrowLeftRight, stock: Club, calendar: CalendarDays, leaderboard: Cherry, rewards: Smile, you: User, settings: SettingsIcon };
      case 'steampunk': return { today: Compass, create: Wrench, trades: ArrowLeftRight, stock: Anchor, calendar: Hourglass, leaderboard: Settings2, rewards: Hammer, you: User, settings: SettingsIcon };
      case 'enchanted': return { today: Leaf, create: Flower, trades: ArrowLeftRight, stock: Trees, calendar: Moon, leaderboard: Sparkles, rewards: Gift, you: User, settings: SettingsIcon };
      case 'cosmic': return { today: Star, create: Rocket, trades: ArrowLeftRight, stock: Globe2, calendar: Telescope, leaderboard: Orbit, rewards: Gift, you: User, settings: SettingsIcon };
      case 'retro': return { today: Radio, create: CassetteTape, trades: ArrowLeftRight, stock: Tv, calendar: CalendarDays, leaderboard: Music, rewards: Camera, you: User, settings: SettingsIcon };
      case 'cutesy': return { today: Heart, create: Sparkles, trades: ArrowLeftRight, stock: Gift, calendar: CalendarDays, leaderboard: Star, rewards: Cherry, you: Smile, settings: SettingsIcon };
      default: return { today: ListChecks, create: PlusCircle, trades: ArrowLeftRight, stock: PackageSearch, calendar: CalendarDays, leaderboard: Trophy, rewards: Gift, you: User, settings: SettingsIcon };
    }
  };
  const themeIcons = getThemeIcons();

  // Per-theme nav-tab flavor text. Each theme swaps in its own vocabulary
  // (a chore-tracker becomes a "Quest Board" in Fantasy, a "Bridge" in
  // Cosmic, etc). Kept as parallel en/pt dictionaries rather than routed
  // through the general t() catalog so each language keeps its own vibe
  // instead of a literal word-for-word mapping.
  const THEME_LABELS = {
    en: {
      cyberpunk: { today: 'Missions', create: 'Upload', trades: 'Swap', stock: 'Inventory', calendar: 'Timeline', leaderboard: 'Rankings', rewards: 'Loot', you: 'Profile', settings: 'Config' },
      fantasy: { today: 'Quests', create: 'Forge', trades: 'Barter', stock: 'Armory', calendar: 'Chronicle', leaderboard: 'Hall of Fame', rewards: 'Treasury', you: 'Hero', settings: 'Spellbook' },
      victorian: { today: 'Duties', create: 'Compose', trades: 'Exchange', stock: 'Provisions', calendar: 'Almanac', leaderboard: 'Honours', rewards: 'Parlour', you: 'Profile', settings: 'Registry' },
      wonderland: { today: 'Adventures', create: 'Brew', trades: 'Swap', stock: 'Pantry', calendar: 'Tea Time', leaderboard: 'Croquet', rewards: 'Curiosities', you: 'You', settings: 'Looking Glass' },
      steampunk: { today: 'Operations', create: 'Engineer', trades: 'Exchange', stock: 'Depot', calendar: 'Clockwork', leaderboard: 'Meters', rewards: 'Workshop', you: 'Operator', settings: 'Controls' },
      enchanted: { today: 'Whispers', create: 'Grow', trades: 'Trade', stock: 'Grove', calendar: 'Seasons', leaderboard: 'Spirits', rewards: 'Treasures', you: 'You', settings: 'Roots' },
      cosmic: { today: 'Missions', create: 'Launch', trades: 'Warp', stock: 'Cargo', calendar: 'Star Chart', leaderboard: 'Orbit', rewards: 'Space Store', you: 'Crew', settings: 'Bridge' },
      retro: { today: 'To-Do', create: 'Record', trades: 'Swap', stock: 'Stash', calendar: 'Schedule', leaderboard: 'High Score', rewards: 'Arcade', you: 'You', settings: 'Dial' },
      cutesy: { today: 'My Tasks', create: 'Create', trades: 'Swap', stock: 'Pantry', calendar: 'Planner', leaderboard: 'Stars', rewards: 'Goodies', you: 'Me', settings: 'Settings' },
    },
    pt: {
      cyberpunk: { today: 'Missões', create: 'Upload', trades: 'Troca', stock: 'Inventário', calendar: 'Timeline', leaderboard: 'Rankings', rewards: 'Loot', you: 'Perfil', settings: 'Config' },
      fantasy: { today: 'Demandas', create: 'Forja', trades: 'Escambo', stock: 'Armaria', calendar: 'Crónica', leaderboard: 'Salão da Fama', rewards: 'Tesouro', you: 'Herói', settings: 'Grimório' },
      victorian: { today: 'Deveres', create: 'Redigir', trades: 'Permuta', stock: 'Provisões', calendar: 'Almanaque', leaderboard: 'Honras', rewards: 'Salão', you: 'Perfil', settings: 'Registo' },
      wonderland: { today: 'Aventuras', create: 'Poção', trades: 'Troca', stock: 'Despensa', calendar: 'Hora do Chá', leaderboard: 'Croquet', rewards: 'Curiosidades', you: 'Tu', settings: 'Espelho' },
      steampunk: { today: 'Operações', create: 'Engenharia', trades: 'Câmbio', stock: 'Depósito', calendar: 'Engrenagens', leaderboard: 'Medidores', rewards: 'Oficina', you: 'Operador', settings: 'Comandos' },
      enchanted: { today: 'Sussurros', create: 'Cultivar', trades: 'Troca', stock: 'Bosque', calendar: 'Estações', leaderboard: 'Espíritos', rewards: 'Tesouros', you: 'Tu', settings: 'Raízes' },
      cosmic: { today: 'Missões', create: 'Lançamento', trades: 'Dobra', stock: 'Carga', calendar: 'Carta Estelar', leaderboard: 'Órbita', rewards: 'Loja Espacial', you: 'Tripulação', settings: 'Ponte de Comando' },
      retro: { today: 'A Fazer', create: 'Gravar', trades: 'Troca', stock: 'Reserva', calendar: 'Horário', leaderboard: 'Recorde', rewards: 'Arcade', you: 'Tu', settings: 'Sintonizador' },
      cutesy: { today: 'As Minhas Tarefas', create: 'Criar', trades: 'Troca', stock: 'Despensa', calendar: 'Planeador', leaderboard: 'Estrelas', rewards: 'Mimos', you: 'Eu', settings: 'Definições' },
    },
  };

  const getThemeLabels = () => {
    const themed = THEME_LABELS[lang][currentTheme];
    if (themed) return themed;
    return { today: t("Today"), create: t("Chores"), trades: t("Trades"), stock: t("Stock"), calendar: t("Calendar"), leaderboard: t("Board"), rewards: t("Rewards"), you: t("You"), settings: t("Settings") };
  };
  const themeLabels = getThemeLabels();

  // Habits is shared across every group you're in (and needs none at all),
  // so it isn't part of the per-theme relabeling below — it always shows
  // up first, with a fixed label/icon.
  let TABS = [{ id: "habits", label: t("Habits"), icon: Flame }];

  if (group.groupId) {
    TABS.push(
      { id: "today", label: themeLabels.today, icon: themeIcons.today },
      { id: "create", label: themeLabels.create, icon: themeIcons.create },
      { id: "trades", label: themeLabels.trades, icon: themeIcons.trades },
      { id: "stock", label: themeLabels.stock, icon: themeIcons.stock },
      { id: "calendar", label: themeLabels.calendar, icon: themeIcons.calendar },
      { id: "leaderboard", label: themeLabels.leaderboard, icon: themeIcons.leaderboard },
    );

    if (group?.currentMembership?.groups?.rewards_enabled || group?.currentMembership?.groups?.cosmetics_unlocked_for_all) {
      TABS.push({ id: "rewards", label: themeLabels.rewards, icon: themeIcons.rewards });
    }

    TABS.push({ id: "you", label: themeLabels.you, icon: themeIcons.you });
    TABS.push({ id: "settings", label: themeLabels.settings, icon: themeIcons.settings });
  } else {
    // No group yet — the only other thing to do is create/join one.
    TABS.push({ id: "groups", label: t("Groups"), icon: Users });
  }

  const [tradePrefill, setTradePrefill] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);

  if (authLoading) return <CenteredNote>{t("Loading...")}</CenteredNote>;
  if (!user) return <Auth />;
  if (group.loading && group.memberships.length === 0) return <CenteredNote>{t("Loading your household…")}</CenteredNote>;
  // Note: no more hard block on !group.groupId here — Habits works with
  // zero groups, so people without one still get a real shell (Habits +
  // a Groups tab to create/join from) instead of being stuck on a
  // full-screen Household prompt before they can do anything at all.

  function goProposeTrade(ev) {
    setTradePrefill(ev);
    setTab("trades");
  }

  function goViewPerson(uid, name) {
    setViewingPerson({ userId: uid, name });
    setTab("you");
  }

  return (
    
      <div className="flex h-screen w-full flex-col md:flex-row app-bg app-ink overflow-hidden relative">
        <ThemeDecorator />
        {/* Mobile Tab Bar (Bottom) */}
        <nav className="md:hidden flex shrink-0 border-t app-surface app-border pb-safe relative z-10">
          <div className="flex w-full justify-around">
            {TABS.map((tInfo) => (
              <button
                key={tInfo.id}
                onClick={() => setTab(tInfo.id)}
                className={`flex flex-col items-center justify-center py-2 px-1 w-full transition ${
                  tab === tInfo.id ? "app-accent-text" : "app-muted"
                }`}
              >
                <tInfo.icon size={20} className="mb-1" />
                <span className="text-[10px] truncate max-w-full font-semibold">{tInfo.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Desktop Sidebar (Left) */}
        <aside className="hidden md:flex w-64 flex-col border-r app-surface app-border p-4 relative z-10">
          <div className="mb-8 px-2">
            <ThemeAppTitle />
            {group.groupId ? (
              <button
                type="button"
                className="flex items-center gap-2 mt-1 text-sm font-semibold app-muted hover:app-ink transition min-w-0 w-full text-left"
                onClick={() => setShowGroupPicker(true)}
                title={t("Switch household")}
              >
                <IconGlyph icon={group.currentMembership?.groups?.icon} fallback="🏠" size={20} />
                <span className="truncate">{group.currentMembership?.groups?.name}</span>
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 mt-1 text-sm font-semibold app-muted hover:app-ink transition min-w-0 w-full text-left"
                onClick={() => setTab("groups")}
              >
                <span className="text-lg">🏠</span>
                <span className="truncate">{t("Create or join a group")}</span>
              </button>
            )}
          </div>
          <nav className="flex-1 space-y-1">
            {TABS.map((tInfo) => (
              <button
                key={tInfo.id}
                onClick={() => setTab(tInfo.id)}
                className={`flex w-full items-center space-x-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                  tab === tInfo.id ? "app-accent-bg" : "hover:bg-black/5 hover:dark:bg-white/5 app-muted hover:app-ink"
                }`}
              >
                <tInfo.icon size={18} />
                <span>{tInfo.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 relative z-10">
          <div className="mx-auto max-w-2xl h-full pb-20 md:pb-0">
            {tab === "habits" && <Habits />}
            {tab === "groups" && (
              <Household
                onCreate={group.createGroup}
                onJoin={group.joinGroup}
              />
            )}
            {tab === "today" && (
              <Today 
                group={group.currentMembership?.groups} 
                groupId={group.groupId} 
                user={user} 
                roster={group.roster} 
                onProposeTrade={goProposeTrade}
              />
            )}
            {tab === "create" && (
              <CreateChore 
                groupId={group.groupId} 
                roster={group.roster} 
                onCreated={() => setTab("today")}
                rewardsEnabled={!!group.currentMembership?.groups?.rewards_enabled}
                maxCoins={group.currentMembership?.groups?.max_coin_reward}
                currentMembership={group.currentMembership}
                user={user}
              />
            )}
            {tab === "trades" && (
              <Trades 
                groupId={group.groupId} 
                user={user} 
                roster={group.roster} 
                prefillEvent={tradePrefill} 
              />
            )}
            {tab === "stock" && (
              <Stock 
                groupId={group.groupId} 
              />
            )}
            {tab === "calendar" && (
              <CalendarScreen 
                groupId={group.groupId} 
                roster={group.roster} 
              />
            )}
            {tab === "leaderboard" && (
              <Leaderboard 
                groupId={group.groupId} 
                roster={group.roster} 
                onSelectPerson={goViewPerson}
                rewardsEnabled={!!group.currentMembership?.groups?.rewards_enabled}
              />
            )}
            {tab === "rewards" && (
              <Rewards 
                group={group.currentMembership?.groups} 
                user={user} 
                roster={group.roster} 
              />
            )}
            {tab === "you" && (
              <You 
                user={user} 
                groupId={group.groupId}
                roster={group.roster}
                currentMembership={group.currentMembership}
                viewing={viewingPerson}
                onClearViewing={() => setViewingPerson(null)}
                onSelectPerson={goViewPerson}
              />
            )}
            {tab === "settings" && (
              <Settings 
                groupId={group.groupId} 
                user={user} 
                memberships={group.memberships}
                roster={group.roster}
                onSwitchGroup={(gid) => group.setGroupId(gid)}
                onLeaveGroup={(gid) => group.leaveGroup(gid)}
                onSignOut={() => supabase.auth.signOut()}
                onRefreshGroup={group.refreshMemberships}
                onOpenGroupPicker={() => setShowGroupPicker(true)}
                onSelectPerson={goViewPerson}
              />
            )}
          </div>
        </main>

        {showGroupPicker && (
          <HouseholdSwitcher
            memberships={group.memberships}
            groupId={group.groupId}
            onSwitch={(gid) => group.setGroupId(gid)}
            onCreate={group.createGroup}
            onJoin={group.joinGroup}
            onReorder={group.reorderMemberships}
            onClose={() => setShowGroupPicker(false)}
          />
        )}
      </div>
    
  );
}

export default function App() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const group = useGroup(user);
  return (
    <CosmeticsProvider groupId={group?.groupId} activeCosmetics={group?.currentMembership?.active_cosmetics}>
      <AppInner group={group} user={user} authLoading={authLoading} t={t} />
    </CosmeticsProvider>
  );
}
