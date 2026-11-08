// See TodayChoresWidget.tsx: react-native-android-widget invokes this
// component as a raw function, which React Compiler's memoization breaks.
'use no memo';

import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetStockItem } from './data';

const COLORS = {
  bg: '#F7F7F2',
  card: '#FFFFFF',
  ink: '#20231D',
  muted: '#6E746B',
  accent: '#3578AF',
  accentInk: '#FFFFFF',
};

const MAX_ROWS = 5;

// Resolved by widget-task-handler.ts (equipped theme + UI language) before
// each render, since this component is invoked directly as a raw function
// rather than through a tree with an I18nextProvider — it can't call
// useTranslation() itself.
export type OutOfStockLabels = {
  title: string;
  loading: string;
  empty: string;
  gotIt: string;
  more: (count: number) => string;
};

const DEFAULT_LABELS: OutOfStockLabels = {
  title: 'Out of Stock',
  loading: 'Loading...',
  empty: 'Nothing flagged 🎉',
  gotIt: 'Got it',
  more: (count) => `+${count} more`,
};

export function OutOfStockWidget({
  items,
  loading,
  errorMessage,
  labels = DEFAULT_LABELS,
}: {
  items: WidgetStockItem[];
  loading?: boolean;
  errorMessage?: string | null;
  labels?: OutOfStockLabels;
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
      clickActionData={{ uri: 'chores://stock' }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <TextWidget text={labels.title} style={{ fontSize: 14, fontWeight: '700', color: COLORS.ink }} />
        <FlexWidget style={{ padding: 6, borderRadius: 999, backgroundColor: COLORS.card }} clickAction="refresh">
          <TextWidget text={loading ? '…' : '↻'} style={{ fontSize: 12, color: COLORS.muted }} />
        </FlexWidget>
      </FlexWidget>

      {errorMessage ? (
        <TextWidget text={errorMessage} style={{ fontSize: 12, color: '#BD4545' }} />
      ) : loading ? (
        <TextWidget text={labels.loading} style={{ fontSize: 13, color: COLORS.muted }} />
      ) : visible.length === 0 ? (
        <TextWidget text={labels.empty} style={{ fontSize: 13, color: COLORS.muted }} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          {visible.map((item) => (
            <FlexWidget
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: 'match_parent',
                backgroundColor: COLORS.card,
                borderRadius: 12,
                padding: 8,
                marginBottom: 6,
              }}
            >
              <TextWidget text={item.name} style={{ fontSize: 13, fontWeight: '600', color: COLORS.ink, flex: 1 }} maxLines={1} />
              <FlexWidget
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: COLORS.accent }}
                clickAction="resolve"
                clickActionData={{ itemId: item.id }}
              >
                <TextWidget text={labels.gotIt} style={{ fontSize: 11, color: COLORS.accentInk, fontWeight: '700' }} />
              </FlexWidget>
            </FlexWidget>
          ))}
        </FlexWidget>
      )}

      {overflow > 0 && (
        <TextWidget text={labels.more(overflow)} style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }} />
      )}
    </FlexWidget>
  );
}
