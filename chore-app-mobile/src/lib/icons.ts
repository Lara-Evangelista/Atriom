import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

// Reuses the chore-photos bucket. Storage RLS requires the first path
// segment to be a group_id the uploader belongs to, so icon/avatar photos
// live at `{groupId}/icons/...` (same bucket, different sub-folder from
// completion proof photos at `{groupId}/{eventId}-....jpg`).
export async function pickIconPhoto(groupId: string): Promise<string | null> {
  if (!groupId) throw new Error("Can't upload a photo here yet — missing household id.");

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library permission is needed to choose an icon.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const blob = await (await fetch(asset.uri)).blob();
  const extension = asset.mimeType?.split('/')[1] || 'jpg';
  const path = `${groupId}/icons/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const { error } = await supabase.storage.from('chore-photos').upload(path, blob, {
    contentType: asset.mimeType || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

const urlCache = new Map<string, { url: string; expires: number }>();

export async function getSignedIconUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from('chore-photos').createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

// A stored icon/avatar is either a short emoji string or a storage path
// like "{groupId}/icons/169...-abc.jpg". Treat anything long, slash-
// containing, and not a URL as a path.
export function isIconPhotoPath(value?: string | null): boolean {
  return !!value && value.length > 10 && !value.startsWith('http') && value.includes('/');
}
