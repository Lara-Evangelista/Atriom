import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { getSignedIconUrl, isIconPhotoPath } from '@/lib/icons';

export function IconGlyph({
  icon,
  fallback = '📋',
  size = 22,
  photoSize = 28,
  textStyle,
}: {
  icon?: string | null;
  fallback?: string;
  size?: number;
  photoSize?: number;
  textStyle?: any;
}) {
  const isPhoto = isIconPhotoPath(icon);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isPhoto && icon) {
      getSignedIconUrl(icon)
        .then((u) => !cancelled && setUrl(u))
        .catch(() => !cancelled && setUrl(null));
    } else {
      setUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [icon, isPhoto]);

  if (isPhoto) {
    return url ? (
      <Image source={{ uri: url }} style={[styles.photo, { width: photoSize, height: photoSize, borderRadius: photoSize / 4 }]} />
    ) : (
      <View style={[styles.photo, { width: photoSize, height: photoSize, borderRadius: photoSize / 4 }]} />
    );
  }

  return <Text style={[{ fontSize: size }, textStyle]}>{icon || fallback}</Text>;
}

const styles = StyleSheet.create({
  photo: { backgroundColor: '#DDD' },
});
