import { Platform, StyleSheet } from 'react-native';
import type { ViewStyle, TextStyle, ImageStyle } from 'react-native';
import type { Colors } from '@/providers/ThemeProvider';

type Rule = ViewStyle | TextStyle | ImageStyle;

// Mobile counterpart to web's `body { font-family: var(--font) }`. Web gets
// theme-wide fonts for free via CSS inheritance; React Native has no such
// cascade, so instead every rule below is stamped with the active theme's
// font after the fact. A custom TTF only renders its own single weight, so
// text that was already asking for 600/700/800 gets the bold file and
// everything else gets the regular file — otherwise Android in particular
// will try to synthesize a bold that doesn't exist for these fonts and it
// looks wrong. Rules with no color/fontSize/fontWeight (pure layout, like
// `row: { flexDirection: 'row' }`) pick up an unused `fontFamily` too, which
// React Native simply ignores on non-text styles.
function isBoldWeight(weight: TextStyle['fontWeight']): boolean {
  return (
    weight === '600' || weight === '700' || weight === '800' || weight === '900' || weight === 'bold' ||
    (typeof weight === 'number' && weight >= 600)
  );
}

function withFont(rule: Rule, C: Colors): Rule {
  if (!C.fontRegular) return rule; // neutral/minimalist/cosmic: OS default font
  const weight = (rule as TextStyle).fontWeight;
  return { ...rule, fontFamily: (isBoldWeight(weight) && C.fontBold) || C.fontRegular };
}

// Same font-per-weight logic as `withFont`, exposed for the handful of
// one-off `style={{ ... }}` text styles scattered across screens that
// don't go through `createStyles`/`raw` above (a "Clear time" link, a
// dynamic-size modal title, etc). Those were missed by the original
// per-theme font pass since they never flow through `withFont`.
export function themedFontFamily(C: Colors, weight?: TextStyle['fontWeight']): string | undefined {
  if (!C.fontRegular) return undefined;
  return (isBoldWeight(weight) && C.fontBold) || C.fontRegular;
}

export function createStyles(C: Colors) {
  const raw: Record<string, Rule> = {
    app: { flex: 1, backgroundColor: C.paper },
    loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: C.paper },
    auth: { flex: 1, backgroundColor: C.paper, padding: 24, justifyContent: 'space-between' },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
    brandMark: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
    brandEmoji: { color: C.accentInk, fontSize: 20, fontWeight: '800' },
    brandName: { fontWeight: '800', fontSize: 14, letterSpacing: 1.5, color: C.ink },
    authContent: { paddingBottom: 74 },
    authTitle: { fontSize: 34, lineHeight: 40, color: C.ink, fontWeight: '700' },
    authSubtitle: { color: C.muted, fontSize: 16, lineHeight: 23, marginTop: 10 },
    form: { gap: 14, marginTop: 28 },
    link: { color: C.blue, textAlign: 'center', fontWeight: '600', marginTop: 6 },
    topbar: { minHeight: 72, paddingHorizontal: 20, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.surface },
    eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, color: C.accent },
    groupName: { fontSize: 21, color: C.ink, fontWeight: '700', marginTop: 2 },
    back: { color: C.blue, fontSize: 14, fontWeight: '600', marginBottom: 4 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCECDF', alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: C.green, fontWeight: '800' },
    main: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 104, gap: 22 },
    date: { color: C.muted, fontSize: 14, marginTop: -9 },
    lead: { color: C.muted, fontSize: 16, lineHeight: 23 },
    nav: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 18 : 10 },
    navItem: { alignItems: 'center', gap: 3 },
    navLabel: { fontSize: 10, color: C.muted },
    navLabelActive: { color: C.accent, fontWeight: '700' },
    navDonePill: { position: 'absolute', top: -34, right: 14, backgroundColor: C.accent, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8, zIndex: 10, elevation: 10 },
    navDonePillText: { color: C.accentInk, fontWeight: '700', fontSize: 13 },
    navEditBadge: { position: 'absolute', top: -6, right: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', zIndex: 20, elevation: 20 },
    navEditBadgeText: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
    dragGhost: { position: 'absolute', width: 68, alignItems: 'center', gap: 3, padding: 8, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, zIndex: 100, elevation: 100 },
    dragHandleHint: { color: C.muted, fontSize: 9, textAlign: 'center' },
    section: { gap: 9 },
    sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    sectionTitle: { color: C.ink, fontSize: 17, fontWeight: '700' },
    sectionCaption: { color: C.muted, fontSize: 13 },
    sectionBody: { gap: 8 },
    empty: { padding: 16, borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: '#FBFCF9' },
    muted: { color: C.muted, fontSize: 14 },
    footerText: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 3 },
    taskCard: { minHeight: 76, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    taskIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#FDEBE5', justifyContent: 'center', alignItems: 'center' },
    emoji: { fontSize: 19 },
    taskBody: { flex: 1, minWidth: 0 },
    taskTitle: { color: C.ink, fontSize: 15, fontWeight: '600' },
    taskDue: { color: C.muted, fontSize: 12, marginTop: 3 },
    overdue: { color: C.red, fontWeight: '600' },
    checkButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent },
    dim: { opacity: 0.5 },
    quickRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderColor: C.line },
    quickName: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
    outlineButton: { borderWidth: 1, borderColor: C.line, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: C.surface },
    outlineText: { color: C.ink, fontSize: 13, fontWeight: '700' },
    field: { gap: 6 },
    fieldLabel: { color: C.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
    input: { height: 48, borderWidth: 1, borderColor: C.line, borderRadius: 7, backgroundColor: C.surface, paddingHorizontal: 13, color: C.ink, fontSize: 16, justifyContent: 'center' },
    button: { minHeight: 48, borderRadius: 7, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
    buttonCompact: { minHeight: 42, alignSelf: 'flex-start' },
    buttonSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
    buttonText: { color: C.accentInk, fontWeight: '800', fontSize: 15 },
    buttonSecondaryText: { color: C.ink },
    buttonRow: { flexDirection: 'row', gap: 10 },
    segment: { flexDirection: 'row', borderRadius: 8, padding: 3, backgroundColor: '#ECEEE8' },
    segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 6 },
    segmentActive: { backgroundColor: C.surface },
    segmentText: { color: C.muted, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: C.ink, fontWeight: '800' },
    people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    personChip: { borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: C.surface },
    personChipActive: { backgroundColor: '#FDEBE5', borderColor: C.accent },
    personText: { color: C.muted, fontSize: 13, fontWeight: '600' },
    personTextActive: { color: C.accent, fontWeight: '800' },
    notice: { borderRadius: 7, padding: 11, backgroundColor: '#E8F3EA' },
    noticeError: { backgroundColor: '#FCE9E8' },
    noticeText: { color: C.green, fontSize: 13, lineHeight: 18 },
    noticeErrorText: { color: C.red },
    monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    monthArrow: { width: 38, height: 38, justifyContent: 'center', alignItems: 'center', borderRadius: 19, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
    monthTitle: { fontSize: 17, fontWeight: '700', color: C.ink },
    calendar: { borderWidth: 1, borderColor: C.line, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surface },
    week: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.line },
    weekday: { width: '14.2857%', textAlign: 'center', paddingVertical: 10, color: C.muted, fontWeight: '700', fontSize: 9, letterSpacing: 0 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: '14.2857%', height: 52, paddingTop: 7, alignItems: 'center' },
    daySelected: { backgroundColor: '#FDEBE5' },
    dayNumber: { color: C.ink, fontSize: 13 },
    todayNumber: { color: C.accent, fontWeight: '800' },
    dotRow: { flexDirection: 'row', gap: 2, marginTop: 5 },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
    calendarItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderWidth: 1, borderColor: C.line, borderRadius: 7, backgroundColor: C.surface },
    status: { borderRadius: 99, backgroundColor: '#FDEBE5', paddingHorizontal: 8, paddingVertical: 4 },
    statusDone: { backgroundColor: '#E8F3EA' },
    statusText: { color: C.muted, fontSize: 10, textTransform: 'capitalize', fontWeight: '700' },
    stockRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line },
    formHalf: { flex: 1 },
    stockHistoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    stockHistoryText: { color: C.muted, fontSize: 13 },
    restockedChip: { backgroundColor: '#E8F3EA', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
    restockedText: { color: C.green, fontSize: 11, fontWeight: '700' },
    warningIcon: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FCE9E8' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: C.line, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: C.surface },
    qty: { color: C.ink, minWidth: 18, textAlign: 'center', fontWeight: '700' },
    boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
    rank: { color: C.muted, width: 22, textAlign: 'center', fontWeight: '700' },
    boardName: { flex: 1, gap: 7 },
    progress: { height: 6, borderRadius: 3, backgroundColor: '#EAECE6', overflow: 'hidden' },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
    points: { color: C.accent, fontSize: 17, fontWeight: '800', minWidth: 24, textAlign: 'right' },
    profileHero: { alignItems: 'center', gap: 7, paddingVertical: 10 },
    bigAvatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#DCECDF', alignItems: 'center', justifyContent: 'center' },
    bigAvatarText: { color: C.green, fontSize: 30, fontWeight: '800' },
    profileName: { color: C.ink, fontSize: 23, fontWeight: '700', marginTop: 3 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderColor: C.line },
    moreIntro: { paddingVertical: 10 },
    moreRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
    moreIcon: { height: 39, width: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#EAF2F8' },
    invite: { borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: C.surface, padding: 16, gap: 6 },
    inviteCode: { color: C.ink, fontSize: 26, letterSpacing: 3, fontWeight: '800' },
    radio: { height: 16, width: 16, borderRadius: 8, borderWidth: 1, borderColor: C.muted },
    radioActive: { borderWidth: 5, borderColor: C.accent },
    signOut: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11 },
    signOutText: { color: C.red, fontWeight: '700', fontSize: 15 },
    notificationRow: { minHeight: 66, borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: C.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    tradeRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderBottomWidth: 1, borderColor: C.line },

    // Habits
    screenHeadRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: -8 },
    roundIconButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
    habitRow: { minHeight: 60, borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: C.surface, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
    habitRowDone: { opacity: 0.55 },
    habitIconWrap: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDEBE5' },
    habitBody: { flex: 1, minWidth: 0 },
    habitName: { color: C.ink, fontSize: 15, fontWeight: '600' },
    habitNameDone: { textDecorationLine: 'line-through' },
    habitFreq: { color: C.muted, fontSize: 12, marginTop: 2 },
    streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FDEBE5', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3 },
    streakText: { color: C.accent, fontSize: 12, fontWeight: '700' },
    remainingBadge: { minWidth: 20, alignItems: 'center' },
    remainingText: { color: C.muted, fontSize: 14, fontWeight: '700' },
    iconButtonSmall: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    toggleCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface },
    toggleCircleDone: { backgroundColor: C.accent, borderColor: C.accent },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
    modalContent: { padding: 22, paddingBottom: 40, gap: 14 },
    modalHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    modalTitle: { color: C.ink, fontSize: 19, fontWeight: '700' },

    freqRow: { flexDirection: 'row', gap: 8 },
    choicePill: { flex: 1, minHeight: 42, borderRadius: 7, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    choicePillActive: { backgroundColor: C.accent, borderColor: C.accent },
    choicePillText: { color: C.ink, fontSize: 13, fontWeight: '600' },
    choicePillTextActive: { color: C.accentInk },

    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    switchLabel: { color: C.ink, fontSize: 14, fontWeight: '600' },

    dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    dayChip: { width: 42, height: 38, borderRadius: 7, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
    dayChipActive: { backgroundColor: C.accent, borderColor: C.accent },
    dayChipText: { color: C.ink, fontSize: 12, fontWeight: '600' },
    dayChipTextActive: { color: C.accentInk },

    reminderTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    reminderDayLabel: { width: 42, color: C.muted, fontSize: 12, fontWeight: '700' },
    timeInput: { height: 40, width: 84, borderWidth: 1, borderColor: C.line, borderRadius: 7, backgroundColor: C.surface, paddingHorizontal: 10, color: C.ink, fontSize: 14, textAlign: 'center', justifyContent: 'center' },

    warnBanner: { borderRadius: 7, padding: 10, backgroundColor: '#FDEBE5' },
    warnBannerText: { color: C.accent, fontSize: 12, lineHeight: 17 },

    historyDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 7, backgroundColor: C.surface, padding: 10 },
    historyDateText: { color: C.ink, fontSize: 13, fontWeight: '600' },

    // Tags (Stock)
    tagFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    tagFilterChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface },
    tagFilterChipActive: { borderColor: 'transparent' },
    tagFilterChipText: { color: C.ink, fontSize: 12, fontWeight: '600' },
    tagFilterChipTextActive: { color: '#1f2937', fontWeight: '700' },
    tagFilterClear: { color: C.muted, fontSize: 12, textDecorationLine: 'underline', paddingHorizontal: 4 },
    tagChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
    tagChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
    tagChipText: { color: '#1f2937', fontSize: 11, fontWeight: '600' },
    stockItemRow: { borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: C.surface, padding: 10, gap: 8 },
    stockItemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    stockItemActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tagPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagPickerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 },
    tagPickerChipText: { color: '#1f2937', fontSize: 12, fontWeight: '600' },
    tagNewRow: { flexDirection: 'row', gap: 8 },
    tagSuggestion: { color: C.muted, fontSize: 12, paddingVertical: 3 },
  };

  const themed: Record<string, Rule> = {};
  for (const key in raw) {
    themed[key] = withFont(raw[key], C);
  }

  return StyleSheet.create(themed);
}
