import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

function projectId() {
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ?? Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId;
}

export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('chores', {
      name: 'Chores',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E7623E',
      enableVibrate: true,
      showBadge: true,
    });
  }
}

export async function pushStatus() {
  if (Platform.OS === 'web') return 'web';
  if (!Device.isDevice) return 'simulator';
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) return permissions.canAskAgain ? 'off' : 'blocked';
  // Permission is granted — but also check if a token is actually saved in the DB.
  // Without this, the button shows "Turn off" even when registration previously failed
  // (e.g. due to a wrong project ID), making it appear to do nothing when tapped.
  const { data } = await supabase.from('expo_push_tokens').select('id').limit(1);
  if (!data || data.length === 0) return 'off';
  return 'enabled';
}

export async function enablePush() {
  if (Platform.OS === 'web') throw new Error('Use the web app notification setting in a browser.');
  if (!Device.isDevice) throw new Error('Push notifications require a physical Android or iOS device.');
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notifications are blocked. Enable them in the device settings to continue.');

  await setupNotificationChannel();

  const id = projectId();
  if (!id) throw new Error('Set EXPO_PUBLIC_EAS_PROJECT_ID before enabling native notifications.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const { error } = await supabase.rpc('save_expo_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) throw error;
  return token;
}

export async function registerPushIfPermitted() {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (granted) {
      await setupNotificationChannel();
      const id = projectId();
      if (id) {
        const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
        await supabase.rpc('save_expo_push_token', { p_token: token, p_platform: Platform.OS });
      }
    }
  } catch (err) {
    console.warn('Could not auto-register push token:', err);
  }
}

export async function disablePush() {
  if (Platform.OS === 'web') return;
  const id = projectId();
  if (!id) return;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  const { error } = await supabase.rpc('remove_expo_push_token', { p_token: token });
  if (error) throw error;
}
