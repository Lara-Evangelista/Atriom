// react-native-android-widget calls this component as a raw function (not
// through React's renderer) when building the native widget tree, so React
// Compiler's injected memoization breaks it with an "Invalid hook call".
// This directive opts the file out of the compiler.
'use no memo';

import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetChoreItem } from './data';

const COLORS = {
  bg: '#F7F7F2',
  card: '#FFFFFF',
  ink: '#20231D',
  muted: '#6E746B',
  line: '#E4E7DE',
  accent: '#E7623E',
  accentInk: '#FFFFFF',
  overdue: '#BD4545',
};

const MAX_ROWS = 4;

// Resolved by widget-task-handler.ts (equipped theme + UI language) before
// each render, since this component is invoked directly as a raw function
// rather than through a tree with an I18nextProvider — it can't call
// useTranslation() itself.
export type TodayChoresLabels = {
  title: string;
  loading: string;
  empty: string;
  overdue: string;
  needsPhoto: string;
  open: string;
  done: string;
  more: (count: number) => string;
};

const DEFAULT_LABELS: TodayChoresLabels = {
  title: "Today's Chores",
  loading: 'Loading...',
  empty: 'All done for today! 🎉',
  overdue: 'Overdue',
  needsPhoto: 'Needs a photo',
  open: 'Open',
  done: 'Done',
  more: (count) => `+${count} more`,
};

export function TodayChoresWidget({
  items,
  loading,
  errorMessage,
  labels = DEFAULT_LABELS,
}: {
  items: WidgetChoreItem[];
  loading?: boolean;
  errorMessage?: string | null;
  labels?: TodayChoresLabels;
}) {
  const visible = items.slice(0, MAX_ROWS);
  const overflow = items.length - visible.length;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: COLORS.bg,
        borderRadius: 16,
        padding: 12,
        flexDirection: 'column',
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'chores://today' }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <TextWidget text={labels.title} style={{ fontSize: 14, fontWeight: '700', color: COLORS.ink }} />
        <FlexWidget
          style={{ padding: 6, borderRadius: 999, backgroundColor: COLORS.card }}
          clickAction="refresh"
        >
          <TextWidget text={loading ? '…' : '↻'} style={{ fontSize: 12, color: COLORS.muted }} />
        </FlexWidget>
      </FlexWidget>

      {errorMessage ? (
        <TextWidget text={errorMessage} style={{ fontSize: 12, color: COLORS.overdue }} />
      ) : loading ? (
        <TextWidget text={labels.loading} style={{ fontSize: 13, color: COLORS.muted }} />
      ) : visible.length === 0 ? (
        <TextWidget text={labels.empty} style={{ fontSize: 13, color: COLORS.muted }} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          {visible.map((item) => (
            <ChoreRow key={item.id} item={item} labels={labels} />
          ))}
        </FlexWidget>
      )}

      {overflow > 0 && (
        <TextWidget text={labels.more(overflow)} style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }} />
      )}
    </FlexWidget>
  );
}

function ChoreRow({ item, labels }: { item: WidgetChoreItem; labels: TodayChoresLabels }) {
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: 'match_parent',
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 8,
        marginBottom: 6,
      }}
    >
      {item.iconUrl ? (
        <ImageWidget image={item.iconUrl} imageWidth={20} imageHeight={20} radius={6} style={{ marginRight: 8 }} />
      ) : (
        <TextWidget text={item.icon || '✓'} style={{ fontSize: 16, marginRight: 8 }} />
      )}

      <FlexWidget style={{ flexDirection: 'column', flex: 1 }} clickAction="OPEN_URI" clickActionData={{ uri: 'chores://today' }}>
        <TextWidget
          text={item.name}
          style={{ fontSize: 13, fontWeight: '600', color: COLORS.ink }}
          maxLines={1}
        />
        {item.overdue && <TextWidget text={labels.overdue} style={{ fontSize: 10, color: COLORS.overdue }} />}
        {item.requiresPhoto && <TextWidget text={labels.needsPhoto} style={{ fontSize: 10, color: COLORS.muted }} />}
      </FlexWidget>

      {item.requiresPhoto ? (
        <FlexWidget
          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: COLORS.accent }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'chores://today' }}
        >
          <TextWidget text={labels.open} style={{ fontSize: 11, color: COLORS.accentInk, fontWeight: '700' }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'row' }}>
          {item.isDelayable && (
            <FlexWidget
              style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: COLORS.bg, marginRight: 6, borderWidth: 1, borderColor: COLORS.line }}
              clickAction="delay"
              clickActionData={{ eventId: item.id }}
            >
              <TextWidget text="+1d" style={{ fontSize: 11, color: COLORS.muted, fontWeight: '700' }} />
            </FlexWidget>
          )}
          <FlexWidget
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: COLORS.accent }}
            clickAction="complete"
            clickActionData={{ eventId: item.id, isScheduled: item.isScheduled }}
          >
            <TextWidget text={labels.done} style={{ fontSize: 11, color: COLORS.accentInk, fontWeight: '700' }} />
          </FlexWidget>
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
