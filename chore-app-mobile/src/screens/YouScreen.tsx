import { Ionicons } from '@expo/vector-icons';
import { PersonalSettingsSection } from "@/components/PersonalSettingsSection";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, Alert } from 'react-native';
import { supabase } from "@/lib/supabase";
import { useChoreApp } from "@/providers/ChoreAppProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { createStyles } from "@/styles/theme";
import { Empty, Notice, Section, Segment } from "@/components/ui/primitives";
import { IconGlyph } from "@/components/ui/IconGlyph";
import { isIconPhotoPath } from "@/lib/icons";
import { useTranslation } from "react-i18next";
type Viewing = { userId: string; name: string } | null;
export function YouScreen({
  viewing,
  onClearViewing,
  onSelectPerson,
}: {
  viewing?: Viewing;
  onClearViewing?: () => void;
  onSelectPerson?: (userId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const { groupId, user, currentMembership, roster } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);
  const viewingUserId = viewing?.userId || user?.id;
  const isSelf = viewingUserId === user?.id;
  const viewingMember = isSelf
    ? currentMembership
    : roster.find((m: any) => m.user_id === viewingUserId);
  const viewingName = viewing?.name || viewingMember?.display_name || t("You");
  const [history, setHistory] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!groupId || !viewingUserId) return;
    supabase
      .rpc("get_member_history", {
        p_group_id: groupId,
        p_user_id: viewingUserId,
      })
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else setHistory(data ?? []);
      });
  }, [groupId, viewingUserId]);
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {" "}
      <Notice message={message} error />{" "}
      {!isSelf && (
        <Pressable
          onPress={onClearViewing}
          style={{ alignSelf: "flex-start", marginBottom: 8 }}
        >
          {" "}
          <Text style={s.back}>{t("Back")}</Text>{" "}
        </Pressable>
      )}{" "}
      {isSelf && (
        <View style={s.profileHero}>
          {" "}
          <View style={[s.bigAvatar, { overflow: "hidden" }]}>
            {" "}
            {isIconPhotoPath(currentMembership?.avatar_url) ? (
              <IconGlyph icon={currentMembership?.avatar_url} photoSize={76} />
            ) : (
              <Text style={s.bigAvatarText}>
                {currentMembership?.avatar_url ||
                  currentMembership?.display_name?.slice(0, 1).toUpperCase() ||
                  "?"}
              </Text>
            )}{" "}
          </View>{" "}
          <Text style={s.profileName}>
            {currentMembership?.display_name || t("You")}
          </Text>{" "}
          <Text style={s.muted}>
            {currentMembership?.pronouns || t("They/Them")}
          </Text>{" "}
          <Text style={s.muted}>{t("Member of this household")}</Text>{" "}
        </View>
      )}{" "}
      <HistorySection
        history={history}
        isSelf={isSelf}
        viewingName={viewingName}
        t={t}
        s={s}
      />{" "}
      {isSelf && <PersonalSettingsSection />}{" "}
      {isSelf && (
        <Section title={t("Household roster")}>
          {" "}
          {roster.map((member: any) => {
            const isMe = member.user_id === user?.id;
            return (
              <Pressable
                key={member.user_id}
                style={s.stockRow}
                onPress={() =>
                  !isMe && onSelectPerson?.(member.user_id, member.display_name)
                }
                disabled={isMe}
              >
                {" "}
                <IconGlyph
                  icon={member.avatar_url}
                  fallback="👤"
                  size={15}
                  photoSize={22}
                />{" "}
                <Text style={[s.taskTitle, { flex: 1 }]}>
                  {" "}
                  {member.display_name} {isMe && t("(You)")}{" "}
                </Text>{" "}
                <Text style={s.taskDue}>{member.role}</Text>{" "}
              </Pressable>
            );
          })}{" "}
        </Section>
      )}{" "}

      {isSelf && (
        <Section title={t('Account')}>
          <Pressable style={s.signOut} onPress={() => Alert.alert(t('Sign out?'), t('You can sign in again whenever you need.'), [{ text: t('Cancel'), style: 'cancel' }, { text: t('Sign out'), style: 'destructive', onPress: async () => { await supabase.auth.signOut(); } }])}>
            <Ionicons name="log-out-outline" size={18} color={colors.red} />
            <Text style={s.signOutText}>{t('Sign out')}</Text>
          </Pressable>
        </Section>
      )}{" "}
    </ScrollView>
  );
}
const DAY_MS = 24 * 60 * 60 * 1000;
function HistorySection({
  history,
  isSelf,
  viewingName,
  t,
  s,
}: {
  history: any[];
  isSelf: boolean;
  viewingName: string;
  t: any;
  s: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState<string>("today");
  const now = Date.now();
  const cutoffs: Record<string, number> = {
    today: new Date(new Date().setHours(0,0,0,0)).getTime(),
    week: now - 7 * DAY_MS,
    month: now - 30 * DAY_MS,
    year: new Date(new Date().getFullYear(), 0, 1).getTime(),
  };
  const recent = history.slice(0, 5);
  const filtered = expanded
    ? history.filter((h) => new Date(h.done_at).getTime() >= cutoffs[period])
    : recent;
  const PERIODS: [string, string][] = [
    ["today", t("Today")],
    ["week", t("This week")],
    ["month", t("This month")],
    ["year", t("This year")],
  ];
  return (
    <Section
      title={
        isSelf
          ? t("Your history")
          : t("{{name}}'s history", { name: viewingName })
      }
    >
      {" "}
      {expanded && (
        <Segment values={PERIODS} value={period} onChange={setPeriod} />
      )}{" "}
      {filtered.length === 0 ? (
        <Empty text={t("Nothing completed yet.")} />
      ) : (
        filtered.map((item, index) => (
          <View key={`${item.done_at}-${index}`} style={s.historyRow}>
            {" "}
            <IconGlyph
              icon={item.icon}
              fallback={item.kind === "cycle" ? "⏱️" : "📋"}
            />{" "}
            <View style={s.taskBody}>
              {" "}
              <Text style={s.taskTitle}>{item.name}</Text>{" "}
              <Text style={s.taskDue}>
                {new Date(item.done_at).toLocaleString()}
              </Text>{" "}
            </View>{" "}
          </View>
        ))
      )}{" "}
      {!expanded && history.length > 5 && (
        <Pressable
          style={[s.button, s.buttonSecondary]}
          onPress={() => setExpanded(true)}
        >
          {" "}
          <Text style={s.buttonSecondaryText}>
            {t("See all this year")}
          </Text>{" "}
        </Pressable>
      )}{" "}
      {expanded && (
        <Pressable
          style={[s.button, s.buttonSecondary]}
          onPress={() => {
            setExpanded(false);
            setPeriod("year");
          }}
        >
          {" "}
          <Text style={s.buttonSecondaryText}>{t("Show less")}</Text>{" "}
        </Pressable>
      )}{" "}
    </Section>
  );
}
