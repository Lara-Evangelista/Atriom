import React, { useEffect, useState } from 'react';
import { View, Text, Switch, Alert, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Section, Field, Button, Segment, Notice } from '@/components/ui/primitives';
import { IconPickerField } from '@/components/ui/IconPickerField';
import { setUiLanguage } from '@/lib/i18n';
import { disablePush, enablePush, pushStatus } from '@/lib/push';

export function PersonalSettingsSection() {
  const { t, i18n } = useTranslation();
  const { groupId, currentMembership, refresh } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [name, setName] = useState(currentMembership?.display_name || '');
  const [avatar, setAvatar] = useState(currentMembership?.avatar_url || '');
  const [pronouns, setPronouns] = useState(currentMembership?.pronouns || 'they/them');
  const [isPaused, setIsPaused] = useState(!!currentMembership?.is_paused);
  
  const [busy, setBusy] = useState(false);

  // Device-only preferences: these affect only this person on this device,
  // not the household, so they live here rather than in group Settings.
  const [pushState, setPushState] = useState('off');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  const refreshPush = () => pushStatus().then(setPushState).catch((error) => setPushMessage(error.message));

  useEffect(() => { refreshPush(); }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (pushState === 'enabled') await disablePush();
      else await enablePush();
      await refreshPush();
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : t('Could not update notifications.'));
    } finally {
      setPushBusy(false);
    }
  };

  const pushLabel = pushState === 'enabled' ? t('On for this device.') : pushState === 'blocked' ? t('Blocked in device settings.') : pushState === 'simulator' ? t('Use a physical device for push.') : pushState === 'web' ? t('Manage browser push in the web app.') : t('Get a notification when chores are due.');

  const UI_LANGUAGES: [string, string][] = [
    ['en', 'English'],
    ['pt-PT', 'Português'],
  ];

  const save = async () => {
    if (!groupId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('update_personal_settings', {
        p_group_id: groupId,
        p_display_name: name.trim(),
        p_avatar_url: avatar,
        p_notification_hour: currentMembership?.notification_hour ?? 9,
        p_notification_preferences: currentMembership?.notification_preferences ?? { daily_chores: true, timers: true, supermarket: true },
        p_pronouns: pronouns,
        p_is_paused: isPaused,
      });
      if (error) throw error;
      Alert.alert(t('Saved'), t('Your personal settings have been updated.'));
      await refresh();
    } catch (err) {
      Alert.alert(t('Error'), getErrorMessage(err));
    }
    setBusy(false);
  };

  const PRONOUNS: [string, string][] = [
    ['they/them', t('They/Them')],
    ['she/her', t('She/Her')],
    ['he/him', t('He/Him')],
  ];

  return (
    <Section title={t('Personal Settings')}>
      <Field label={t('Your Display Name')} value={name} onChangeText={setName} />
      <IconPickerField label={t('Avatar (emoji or photo)')} value={avatar} onChange={setAvatar} groupId={groupId} />
      
      <View style={{ marginBottom: 16 }}>
        <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Pronouns')}</Text>
        <Segment values={PRONOUNS} value={pronouns} onChange={setPronouns} />
        </View>
        <View style={{ marginBottom: 16 }}>
          <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t("App Language")}</Text>
          <Segment values={[["en", t("English")], ["pt-PT", t("Portuguese")]]} value={i18n.language} onChange={(v) => i18n.changeLanguage(v as string)} />
        </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text style={s.taskTitle}>{t('Pause Chores')}</Text>
          <Text style={s.taskDue}>{t('Stop being assigned to new rotational chores (e.g. for vacation).')}</Text>
        </View>
        <Switch value={isPaused} onValueChange={setIsPaused} />
      </View>

      <View style={{ marginTop: 16 }}>
        <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('App Language')}</Text>
        <Segment values={UI_LANGUAGES} value={i18n.language} onChange={(v) => setUiLanguage(v as 'en' | 'pt-PT')} />
      </View>

      <View style={{ marginTop: 16 }}>
        <Button label={busy ? t('Saving...') : t('Save Settings')} onPress={save} disabled={busy || !name.trim()} />
      </View>

      <View style={{ marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line }}>
        <Notice message={pushMessage} error />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={s.taskTitle}>{t('Push notifications')}</Text>
            <Text style={s.taskDue}>{pushLabel}</Text>
          </View>
          {pushState !== 'blocked' && pushState !== 'web' && (
            <Pressable style={pushState === 'enabled' ? s.outlineButton : s.button} onPress={togglePush} disabled={pushBusy}>
              <Text style={pushState === 'enabled' ? s.outlineText : s.buttonText}>{pushBusy ? t('Working...') : pushState === 'enabled' ? t('Turn off') : t('Turn on')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Section>
  );
}
