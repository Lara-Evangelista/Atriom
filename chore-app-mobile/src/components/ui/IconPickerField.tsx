import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/providers/ThemeProvider';
import { themedFontFamily } from '@/styles/theme';
import { getSignedIconUrl, isIconPhotoPath, pickIconPhoto } from '@/lib/icons';

const COMMON_ICONS = ['🧹', '🍽️', '🗑️', '🚽', '🧺', '🧼', '🛏️', '🪟', '🐶', '🌱', '📦', '🧴'];

export function IconPickerField({
  label,
  value,
  onChange,
  groupId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  groupId?: string | null;
}) {
  const { colors } = useTheme();
  const isPhoto = isIconPhotoPath(value);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (isPhoto && value) {
      getSignedIconUrl(value)
        .then((u) => !cancelled && setPreviewUrl(u))
        .catch(() => !cancelled && setPreviewUrl(null));
    } else {
      setPreviewUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [value, isPhoto]);

  async function handlePickPhoto() {
    setError('');
    if (!groupId) {
      setError("Can't upload a photo here yet — missing household id.");
      return;
    }
    setUploading(true);
    try {
      const path = await pickIconPhoto(groupId);
      if (path) onChange(path);
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted, fontFamily: themedFontFamily(colors, '700') }]}>{label}</Text>

      <View style={styles.row}>
        {COMMON_ICONS.map((ic) => (
          <Pressable
            key={ic}
            onPress={() => onChange(ic)}
            style={[
              styles.swatch,
              { borderColor: value === ic ? colors.accent : colors.line, backgroundColor: colors.surface },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{ic}</Text>
          </Pressable>
        ))}

        <Pressable
          onPress={handlePickPhoto}
          disabled={uploading}
          style={[
            styles.swatch,
            { borderColor: isPhoto ? colors.accent : colors.line, backgroundColor: colors.surface },
          ]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : isPhoto && previewUrl ? (
            <Image source={{ uri: previewUrl }} style={styles.previewThumb} />
          ) : (
            <Ionicons name="image-outline" size={18} color={colors.ink} />
          )}
        </Pressable>
      </View>

      {!!error && <Text style={[styles.error, { color: colors.red, fontFamily: themedFontFamily(colors) }]}>{error}</Text>}

      <TextInput
        style={[styles.input, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink, fontFamily: themedFontFamily(colors) }]}
        placeholder="Or type/paste any emoji"
        placeholderTextColor="#9AA097"
        value={isPhoto ? '' : value}
        onChangeText={onChange}
        maxLength={32}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 40, height: 40, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  previewThumb: { width: 32, height: 32, borderRadius: 6 },
  input: { height: 48, borderWidth: 1, borderRadius: 7, paddingHorizontal: 13, fontSize: 16 },
  error: { fontSize: 12 },
});
