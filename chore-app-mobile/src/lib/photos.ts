import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

export async function captureAndUploadChorePhoto(groupId: string, eventId: string) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission is needed to attach proof of completion.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: true,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const blob = await (await fetch(asset.uri)).blob();
  const extension = asset.mimeType?.split('/')[1] || 'jpg';
  const path = `${groupId}/${eventId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from('chore-photos').upload(path, blob, {
    contentType: asset.mimeType || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}
