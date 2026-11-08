// src/lib/localNotifications.ts
//
// Local notification helpers for daily chore summaries and other
// time-based, non-collaborative alerts. These fire without any server
// involvement — perfect for "your daily chores" reminders at each
// user's preferred notification_hour.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Schedule a daily local notification at a given hour.
// Cancels any previous daily notification before scheduling a new one.
export async function scheduleDailyChoreReminder(hour: number, title: string, body: string) {
  if (Platform.OS === 'web') return;

  // Cancel any existing daily reminder
  await cancelDailyChoreReminder();

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: { type: 'daily_chores' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
    },
    identifier: 'daily-chore-reminder',
  });
}

export async function cancelDailyChoreReminder() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync('daily-chore-reminder').catch(() => {});
}

// Fire a one-off local notification right now or after a delay.
export async function fireLocalNotification(title: string, body: string, data?: Record<string, unknown>, delaySec?: number) {
  if (Platform.OS === 'web') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: data || {},
    },
    trigger: delaySec ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySec } : null,
  });
}

// Update the daily reminder whenever the user changes their notification_hour
// in personal settings. Call this from SettingsScreen after saving.
export async function syncDailyReminder(hour: number, enabled: boolean) {
  if (!enabled) {
    await cancelDailyChoreReminder();
    return;
  }
  await scheduleDailyChoreReminder(hour, "Today's chores", "Check what's on your list for today!");
}
