import React, { ComponentProps, ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';

export function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {caption && <Text style={s.sectionCaption}>{caption}</Text>}
      </View>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return <View style={s.empty}><Text style={s.muted}>{text}</Text></View>;
}

export function Notice({ message, error = false }: { message?: string; error?: boolean }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return message ? (
    <View style={[s.notice, error && s.noticeError]}>
      <Text style={[s.noticeText, error && s.noticeErrorText]}>{message}</Text>
    </View>
  ) : null;
}

export function Field({ label, isPassword, ...props }: { label: string; isPassword?: boolean } & ComponentProps<typeof TextInput>) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  const [show, setShow] = React.useState(false);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput style={[s.input, isPassword && { paddingRight: 40 }]} placeholderTextColor="#9AA097" secureTextEntry={isPassword && !show} {...props} />
        {isPassword && (
          <Pressable onPress={() => setShow(!show)} style={{ position: 'absolute', right: 12, height: '100%', justifyContent: 'center' }}>
            <Ionicons name={show ? 'eye-off' : 'eye'} size={20} color={colors.ink} style={{ opacity: 0.5 }} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Button({ label, onPress, disabled, compact = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean; secondary?: boolean }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return (
    <Pressable style={[s.button, compact && s.buttonCompact, secondary && s.buttonSecondary, disabled && s.dim]} onPress={onPress} disabled={disabled}>
      <Text style={[s.buttonText, secondary && s.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function Segment({ values, value, onChange }: { values: [string, string][]; value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return (
    <View style={s.segment}>
      {values.map(([id, label]) => (
        <Pressable key={id} style={[s.segmentItem, value === id && s.segmentActive]} onPress={() => onChange(id)}>
          <Text style={[s.segmentText, value === id && s.segmentTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return (
    <SafeAreaView style={s.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={s.muted}>{label}</Text>
    </SafeAreaView>
  );
}
