import React, { ReactNode, useState } from 'react';
import { Pressable, SafeAreaView, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Field, Notice, Segment } from '@/components/ui/primitives';

export function AuthGate() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { colors } = useTheme();
  const s = createStyles(colors);

  const submit = async () => {
    setMessage(''); setBusy(true);
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === 'signup') setMessage(t('Account created. Check your inbox if email confirmation is on.'));
  };

  return (
    <AuthLayout title={t('Chores, together')} subtitle={mode === 'signin' ? t('Sign in to see what needs doing.') : t('Create an account for your household.')}>
      <Field label={t('Email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t('Password')} value={password} onChangeText={setPassword} isPassword />
      <Notice message={message} error={message.includes('Invalid') || message.includes('Password')} />
      <Button label={busy ? t('Working...') : mode === 'signin' ? t('Sign in') : t('Create account')} onPress={submit} disabled={busy || !email || password.length < 6} />
      <Pressable onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>
        <Text style={s.link}>{mode === 'signin' ? t('New here? Create an account') : t('Already have an account? Sign in')}</Text>
      </Pressable>
    </AuthLayout>
  );
}

export function HouseholdGate() {
  const { t } = useTranslation();
  const { createGroup, joinGroup } = useChoreApp();
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [name, setName] = useState(''); 
  const [invite, setInvite] = useState(''); 
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false); 
  const [message, setMessage] = useState('');

  const submit = async () => {
    setBusy(true); setMessage('');
    try { 
      if (mode === 'create') await createGroup(name.trim(), displayName.trim()); 
      else await joinGroup(invite.trim(), displayName.trim()); 
    } catch (error) { 
      const fallback = mode === 'create' ? t('Could not create that household.') : t('Could not join that household.');
      setMessage(error instanceof Error ? error.message : fallback); 
    } finally { 
      setBusy(false); 
    }
  };

  return (
    <AuthLayout title={t('Your household')} subtitle={t('Start a home base or join one with an invite code.')}>
      <Segment values={[['join', t('Join')], ['create', t('Create')]]} value={mode} onChange={(next) => setMode(next as 'join' | 'create')} />
      {mode === 'create' ? <Field label={t('Household name')} value={name} onChangeText={setName} placeholder={t('Maple Street')} /> : <Field label={t('Invite code')} value={invite} onChangeText={(value) => setInvite(value.toUpperCase())} autoCapitalize="characters" />}
      <Field label={t('Your name')} value={displayName} onChangeText={setDisplayName} placeholder={t('How everyone knows you')} />
      <Notice message={message} error />
      <Button label={busy ? t('Working...') : mode === 'create' ? t('Create household') : t('Join household')} onPress={submit} disabled={busy || !displayName || (mode === 'create' ? !name : !invite)} />
    </AuthLayout>
  );
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { colors } = useTheme();
  const s = createStyles(colors);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <KeyboardAwareScrollView contentContainerStyle={[s.auth, { flex: undefined, flexGrow: 1 }]} keyboardShouldPersistTaps="handled" bounces={false} enableOnAndroid={true}>
        <View style={s.brand}>
          <View style={s.brandMark}><Text style={s.brandEmoji}>✓</Text></View>
          <Text style={s.brandName}>CHORES</Text>
        </View>
        <View style={s.authContent}>
          <Text style={s.authTitle}>{title}</Text>
          <Text style={s.authSubtitle}>{subtitle}</Text>
          <View style={s.form}>{children}</View>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
