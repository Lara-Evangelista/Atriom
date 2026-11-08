import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { TodayChoresWidget, type TodayChoresLabels } from './TodayChoresWidget';
import { OutOfStockWidget, type OutOfStockLabels } from './OutOfStockWidget';
import i18n from '@/lib/i18n';
import { themeLabel } from '@/lib/themeLabels';
import type { ThemeMode } from '@/providers/ThemeProvider';
import {
  completeChore,
  delayChore,
  fetchOutOfStock,
  fetchTodayChores,
  getActiveGroupId,
  getCurrentUserId,
  getEquippedTheme,
  getUiLanguage,
  resolveStockItem,
} from './data';

// Must match the `name` given to each widget in the app.json config plugin.
const nameToWidget = {
  TodayChores: TodayChoresWidget,
  OutOfStock: OutOfStockWidget,
};

// Resolves the same two things CosmeticsProvider/i18n resolve for the main
// app — equipped theme and UI language — and turns them into the strings
// each widget needs, so a widget matches whatever's active in the app.
async function buildLabels(groupId: string | null): Promise<{
  today: TodayChoresLabels;
  stock: OutOfStockLabels;
  errors: { signIn: string; chores: string; stock: string };
}> {
  const [theme, lang] = await Promise.all([
    groupId ? getEquippedTheme(groupId) : Promise.resolve<ThemeMode>('neutral'),
    getUiLanguage(),
  ]);
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng: lang, ...options });

  return {
    today: {
      title: themeLabel(lang, theme, 'today', t("Today's chores")),
      loading: t('Loading...'),
      empty: t('All done for today! 🎉'),
      overdue: t('Overdue'),
      needsPhoto: t('Needs a photo'),
      open: t('Open'),
      done: t('Done'),
      more: (count: number) => t('+{{count}} more', { count }),
    },
    stock: {
      title: themeLabel(lang, theme, 'stock', t('Out of Stock')),
      loading: t('Loading...'),
      empty: t('Nothing flagged 🎉'),
      gotIt: t('Got it'),
      more: (count: number) => t('+{{count}} more', { count }),
    },
    errors: {
      signIn: t('Open the app to sign in'),
      chores: t('Could not load chores'),
      stock: t('Could not load stock'),
    },
  };
}

async function renderTodayChores(props: WidgetTaskHandlerProps) {
  const groupId = await getActiveGroupId();
  const labels = await buildLabels(groupId);
  try {
    props.renderWidget(React.createElement(TodayChoresWidget, { items: [], loading: true, labels: labels.today }));
    const userId = await getCurrentUserId();
    if (!groupId || !userId) {
      props.renderWidget(
        React.createElement(TodayChoresWidget, { items: [], errorMessage: labels.errors.signIn, labels: labels.today })
      );
      return;
    }
    const items = await fetchTodayChores(groupId, userId);
    props.renderWidget(React.createElement(TodayChoresWidget, { items, labels: labels.today }));
  } catch (e: any) {
    props.renderWidget(
      React.createElement(TodayChoresWidget, {
        items: [],
        errorMessage: e?.message || labels.errors.chores,
        labels: labels.today,
      })
    );
  }
}

async function renderOutOfStock(props: WidgetTaskHandlerProps) {
  const groupId = await getActiveGroupId();
  const labels = await buildLabels(groupId);
  try {
    props.renderWidget(React.createElement(OutOfStockWidget, { items: [], loading: true, labels: labels.stock }));
    if (!groupId) {
      props.renderWidget(
        React.createElement(OutOfStockWidget, { items: [], errorMessage: labels.errors.signIn, labels: labels.stock })
      );
      return;
    }
    const items = await fetchOutOfStock(groupId);
    props.renderWidget(React.createElement(OutOfStockWidget, { items, labels: labels.stock }));
  } catch (e: any) {
    props.renderWidget(
      React.createElement(OutOfStockWidget, {
        items: [],
        errorMessage: e?.message || labels.errors.stock,
        labels: labels.stock,
      })
    );
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetName = props.widgetInfo.widgetName as keyof typeof nameToWidget;

  const render = () => (widgetName === 'TodayChores' ? renderTodayChores(props) : renderOutOfStock(props));

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      await render();
      break;

    case 'WIDGET_DELETED':
      // Nothing persisted per-widget-instance to clean up.
      break;

    case 'WIDGET_CLICK':
      try {
        if (props.clickAction === 'refresh') {
          await render();
        } else if (props.clickAction === 'complete') {
          const { eventId, isScheduled } = props.clickActionData as { eventId: string; isScheduled: boolean };
          await completeChore(eventId, isScheduled);
          await render();
        } else if (props.clickAction === 'delay') {
          const { eventId } = props.clickActionData as { eventId: string };
          await delayChore(eventId, 1);
          await render();
        } else if (props.clickAction === 'resolve') {
          const { itemId } = props.clickActionData as { itemId: string };
          await resolveStockItem(itemId);
          await render();
        }
      } catch (e) {
        // Fall back to a fresh render rather than leaving a stale/broken widget.
        await render();
      }
      break;

    default:
      break;
  }
}
