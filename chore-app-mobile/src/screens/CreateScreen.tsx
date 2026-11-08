import React, { useCallback, useEffect, useState } from 'react';


import { View, Text, Pressable, ScrollView, Platform, Modal } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';


import { useTranslation } from 'react-i18next';


import { supabase } from '@/lib/supabase';


import { useChoreApp } from '@/providers/ChoreAppProvider';


import { useTheme } from '@/providers/ThemeProvider';


import { createStyles, themedFontFamily } from '@/styles/theme';


import { Button, Field, Notice, Section, Segment } from '@/components/ui/primitives';


import { IconPickerField } from '@/components/ui/IconPickerField';


import { IconGlyph } from '@/components/ui/IconGlyph';


import DateTimePicker from '@react-native-community/datetimepicker';
import { getErrorMessage } from '@/lib/errors';
import { WeeklyDayTimes, WeeklyMap, normalizeWeekly, serializeWeekly } from '@/components/WeeklyDayTimes';
import { ResourceUsageEditor } from '@/components/ResourceUsageEditor';





export function CreateScreen({ onCreated }: { onCreated: () => void }) {


  const { t } = useTranslation();


  const { groupId, roster, currentMembership, user } = useChoreApp();


  const { colors } = useTheme();


  const s = createStyles(colors);


  const rewardsEnabled = !!currentMembership?.groups?.rewards_enabled;


  const maxCoins = currentMembership?.groups?.max_coin_reward;


  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';


  const restrictCoinsToAdmins = currentMembership?.groups?.restrict_coins_to_admins ?? true;


  const allowSelfAssignedCoins = !!currentMembership?.groups?.allow_self_assigned_coins;


  const canSetCoins = rewardsEnabled && (isAdmin || !restrictCoinsToAdmins);


  const currentUserId = user?.id;





  // Same self-assignment rule as web: can't set coins on a chore/rotation


  // that's only you. Needs at least one other person besides yourself.


  const selfAssignmentBlocksCoins = (peopleList: string[]) => {


    if (allowSelfAssignedCoins) return false;


    if (!currentUserId) return false;


    return peopleList.includes(currentUserId) && peopleList.length < 2;


  };





  const [mode, setMode] = useState<'recurring' | 'onetime' | 'presets'>('recurring');





  const [name, setName] = useState('');


  const [icon, setIcon] = useState('');


  


  // Capabilities


  const [hasSchedule, setHasSchedule] = useState(true);


  const [requiresPhoto, setRequiresPhoto] = useState(false);


  const [hasCounter, setHasCounter] = useState(false);


  const [counterThreshold, setCounterThreshold] = useState('10');


  const [hasTimer, setHasTimer] = useState(false);


  const [defaultTimerMinutes, setDefaultTimerMinutes] = useState('60');


  const [isDelayable, setIsDelayable] = useState(true);


  const [maxDelays, setMaxDelays] = useState('3');





  // Scheduling


  const [startDate, setStartDate] = useState<Date | null>(null);


  const [showStartDatePicker, setShowStartDatePicker] = useState(false);


  const [scheduleType, setScheduleType] = useState('interval'); // 'interval' | 'weekly'


  const [interval, setInterval] = useState('7');


  const [weekly, setWeekly] = useState<WeeklyMap>({});





  // Assignment


  const [isRotational, setIsRotational] = useState(true);


  const [assigned, setAssigned] = useState<string[]>([]); // Sequence if rotational, Set if shared





  const [busy, setBusy] = useState(false);


  const [message, setMessage] = useState('');


  const [coinReward, setCoinReward] = useState('0');


  const [requiresApproval, setRequiresApproval] = useState(false);


  const [dueTime, setDueTime] = useState('');

  const [showDueTimePicker, setShowDueTimePicker] = useState(false);


  const [overdueNudge, setOverdueNudge] = useState('');


  const [countsForLeaderboard, setCountsForLeaderboard] = useState(true);





  const [resources, setResources] = useState<any[]>([]);


  const [usesResources, setUsesResources] = useState<{ [id: string]: string }>({});





  useEffect(() => {


    if (!groupId) return;


    supabase.from('resources').select('id, name, unit').eq('group_id', groupId).order('name')


      .then(({ data }) => setResources(data ?? []));


  }, [groupId]);





  const attachResources = async (choreTypeId: string) => {


    const entries = Object.entries(usesResources).filter(([, qty]) => qty !== '' && Number(qty) > 0);


    if (entries.length === 0) return;


    const { error } = await supabase.rpc('update_chore_resources', {


      p_chore_type_id: choreTypeId,


      p_resource_ids: entries.map(([id]) => id),


      p_qtys: entries.map(([, qty]) => Number(qty)),


    });


    if (error) throw error;


  };





  // One-time task state


  const [onetimeDueDate, setOnetimeDueDate] = useState(() => new Date());


  const [showDatePicker, setShowDatePicker] = useState(false);


  const [dueTimeOnetime, setDueTimeOnetime] = useState('');

  const [showDueTimeOnetimePicker, setShowDueTimeOnetimePicker] = useState(false);


  const [isTimer, setIsTimer] = useState(false);


  const [onetimeTimerMinutes, setOnetimeTimerMinutes] = useState('60');


  const [onetimeAssigned, setOnetimeAssigned] = useState<string[]>([]);

  // Presets: a saved template for a one-time/timer task you make often but
  // don't want on a fixed schedule (clearing the dishwasher, etc).
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [presets, setPresets] = useState<any[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState('');

  const loadPresets = React.useCallback(async () => {
    if (!groupId) return;
    setPresetsLoading(true);
    const { data, error } = await supabase.from('chore_presets').select('*').eq('group_id', groupId).order('name');
    if (error) setPresetsError(getErrorMessage(error));
    else setPresets(data ?? []);
    setPresetsLoading(false);
  }, [groupId]);

  useEffect(() => { if (mode === 'presets') loadPresets(); }, [mode, loadPresets]);

  // Inline "new/edit preset" form state, and the "assign & add" modal state
  // for instantiating a saved preset into an actual task.
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null); // null = not editing, 'new' = creating
  const [presetName, setPresetName] = useState('');
  const [presetIcon, setPresetIcon] = useState('');
  const [presetRequiresPhoto, setPresetRequiresPhoto] = useState(false);
  const [presetCoinReward, setPresetCoinReward] = useState('0');
  const [presetHasTimer, setPresetHasTimer] = useState(false);
  const [presetTimerMinutes, setPresetTimerMinutes] = useState('60');
  const [presetCountsForLeaderboard, setPresetCountsForLeaderboard] = useState(true);
  const [presetBusy, setPresetBusy] = useState(false);

  const resetPresetForm = () => {
    setPresetName(''); setPresetIcon(''); setPresetRequiresPhoto(false);
    setPresetCoinReward('0'); setPresetHasTimer(false); setPresetTimerMinutes('60');
    setPresetCountsForLeaderboard(true);
  };

  const startNewPreset = () => { resetPresetForm(); setEditingPresetId('new'); };
  const startEditPreset = (p: any) => {
    setPresetName(p.name || ''); setPresetIcon(p.icon || ''); setPresetRequiresPhoto(!!p.requires_photo);
    setPresetCoinReward(String(p.coin_reward ?? 0)); setPresetHasTimer(!!p.has_timer);
    setPresetTimerMinutes(String(p.default_timer_minutes ?? 60)); setPresetCountsForLeaderboard(p.counts_for_leaderboard ?? true);
    setEditingPresetId(p.id);
  };

  const savePreset = async () => {
    if (!groupId || !presetName.trim()) return;
    setPresetBusy(true); setPresetsError('');
    try {
      if (editingPresetId === 'new') {
        const { error } = await supabase.rpc('create_preset', {
          p_group_id: groupId, p_name: presetName.trim(), p_icon: presetIcon.trim(),
          p_requires_photo: presetRequiresPhoto, p_coin_reward: Number(presetCoinReward) || 0,
          p_counts_for_leaderboard: presetCountsForLeaderboard, p_has_timer: presetHasTimer,
          p_default_timer_minutes: presetHasTimer ? (Number(presetTimerMinutes) || 60) : null,
        });
        if (error) throw error;
      } else if (editingPresetId) {
        const { error } = await supabase.rpc('update_preset', {
          p_preset_id: editingPresetId, p_name: presetName.trim(), p_icon: presetIcon.trim(),
          p_requires_photo: presetRequiresPhoto, p_coin_reward: Number(presetCoinReward) || 0,
          p_counts_for_leaderboard: presetCountsForLeaderboard, p_has_timer: presetHasTimer,
          p_default_timer_minutes: presetHasTimer ? (Number(presetTimerMinutes) || 60) : null,
        });
        if (error) throw error;
      }
      setEditingPresetId(null);
      await loadPresets();
    } catch (err) {
      setPresetsError(getErrorMessage(err));
    } finally {
      setPresetBusy(false);
    }
  };

  const removePreset = async (id: string) => {
    setPresetBusy(true); setPresetsError('');
    try {
      const { error } = await supabase.rpc('delete_preset', { p_preset_id: id });
      if (error) throw error;
      await loadPresets();
    } catch (err) {
      setPresetsError(getErrorMessage(err));
    } finally {
      setPresetBusy(false);
    }
  };

  const [assigningPreset, setAssigningPreset] = useState<any | null>(null);
  const [presetAssignees, setPresetAssignees] = useState<string[]>([]);
  const togglePresetAssignee = (id: string) => setPresetAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const instantiatePreset = async () => {
    if (!assigningPreset) return;
    setPresetBusy(true); setPresetsError('');
    try {
      const { error } = await supabase.rpc('instantiate_preset', {
        p_preset_id: assigningPreset.id,
        p_assignee_ids: presetAssignees.length > 0 ? presetAssignees : null,
        p_due_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      setAssigningPreset(null);
      onCreated();
    } catch (err) {
      setPresetsError(getErrorMessage(err));
    } finally {
      setPresetBusy(false);
    }
  };


  const toggleOnetimePerson = (id: string) => setOnetimeAssigned(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);










  const togglePersonShared = (id: string) => setAssigned(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);


  const addPersonSequence = (id: string) => setAssigned(prev => [...prev, id]);


  const removePersonSequence = (index: number) => setAssigned(prev => prev.filter((_, i) => i !== index));





  const submit = async () => {


    if (!groupId || !name.trim()) return;


    setBusy(true); setMessage('');


    try {


      if (hasSchedule) {




        const advSched = scheduleType === 'weekly' ? serializeWeekly(weekly) : null;


        if (scheduleType === 'weekly' && Object.keys(weekly).length === 0) throw new Error(t('Select at least one day for weekly schedule.'));


        


        const { data: choreId, error: createError } = await supabase.rpc('create_chore_type_scheduled', {


          p_group_id: groupId,


          p_name: name.trim(),


          p_icon: icon.trim(),


          p_interval_days: scheduleType === 'interval' ? Number(interval) : 1,


          p_user_ids: assigned,


          p_requires_photo: requiresPhoto,


          p_advanced_schedule: advSched,


          p_is_rotational: isRotational,


          p_is_delayable: isDelayable,


          p_max_consecutive_delays: isDelayable ? Number(maxDelays) : null,


          p_coin_reward: (canSetCoins && !selfAssignmentBlocksCoins(assigned)) ? Number(coinReward) : 0,


          p_requires_approval: requiresApproval || undefined,


          p_due_time: dueTime || null,


          p_overdue_nudge_interval_minutes: overdueNudge ? Number(overdueNudge) : null,


          p_counts_for_leaderboard: countsForLeaderboard,


          p_start_date: startDate ? startDate.toISOString().slice(0, 10) : null,


        });


        


        if (createError) throw createError;


        


        const { error: updateError } = await supabase.from('chore_types').update({


          has_counter: hasCounter,


          counter_threshold: hasCounter ? Number(counterThreshold) : null,


          has_timer: hasTimer,


          default_timer_minutes: hasTimer ? (Number(defaultTimerMinutes) || 60) : null,


        }).eq('id', choreId);


        


        if (updateError) throw updateError;


        await attachResources(choreId);


      } else {


        const { data, error } = await supabase.from('chore_types').insert({


          group_id: groupId,


          name: name.trim(),


          icon: icon.trim(),


          has_schedule: false,


          requires_photo: requiresPhoto,


          has_counter: hasCounter,


          counter_threshold: hasCounter ? Number(counterThreshold) : null,


          has_timer: hasTimer,


          default_timer_minutes: hasTimer ? (Number(defaultTimerMinutes) || 60) : null,


          counts_for_leaderboard: countsForLeaderboard,


        }).select('id').single();


        if (error) throw error;


        await attachResources(data.id);


      }


      onCreated();


    } catch (error) {


      setMessage(getErrorMessage(error, t('Could not create chore.')));


    } finally {


      setBusy(false);


    }


  };





  const submitOnetime = async () => {


    if (!groupId || !name.trim()) return;




    setBusy(true); setMessage('');


    try {


      const rpcName = isTimer ? 'create_onetime_timer_task' : 'create_onetime_task';


      const args: any = {


        p_group_id: groupId,


        p_name: name.trim(),


        p_icon: icon.trim(),


        p_assignee_ids: onetimeAssigned,


        p_due_date: isTimer ? new Date().toISOString().slice(0, 10) : onetimeDueDate.toISOString().slice(0, 10),


        p_requires_photo: requiresPhoto,


        p_coin_reward: (canSetCoins && !selfAssignmentBlocksCoins(onetimeAssigned)) ? Number(coinReward) : 0,


        p_counts_for_leaderboard: countsForLeaderboard,


        p_due_time: (!isTimer && dueTimeOnetime) ? dueTimeOnetime : null,


      };


      if (isTimer) {


        args.p_cycle_minutes = Number(onetimeTimerMinutes) || 60;


      }


      const { error } = await supabase.rpc(rpcName, args);


      if (error) throw error;


      if (saveAsPreset) {
        // Best-effort: the task itself already succeeded above, so a preset
        // save failure shouldn't block onCreated() or look like the whole
        // action failed -- just surface it separately.
        const { error: presetError } = await supabase.rpc('create_preset', {
          p_group_id: groupId,
          p_name: name.trim(),
          p_icon: icon.trim(),
          p_requires_photo: requiresPhoto,
          p_coin_reward: (canSetCoins && !selfAssignmentBlocksCoins(onetimeAssigned)) ? Number(coinReward) : 0,
          p_due_time: (!isTimer && dueTimeOnetime) ? dueTimeOnetime : null,
          p_counts_for_leaderboard: countsForLeaderboard,
          p_has_timer: isTimer,
          p_default_timer_minutes: isTimer ? (Number(onetimeTimerMinutes) || 60) : null,
        });
        if (presetError) setMessage(getErrorMessage(presetError, t('Task created, but saving it as a preset failed.')));
      }


      onCreated();


    } catch (error) {


      setMessage(getErrorMessage(error, t('Could not create task.')));


    } finally {


      setBusy(false);


    }


  };





  const DAYS = [{k:'1', l:t('day.mon')}, {k:'2', l:t('day.tue')}, {k:'3', l:t('day.wed')}, {k:'4', l:t('day.thu')}, {k:'5', l:t('day.fri')}, {k:'6', l:t('day.sat')}, {k:'7', l:t('day.sun')}];





  if (mode === 'onetime') {


    return (


      <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>


        <Notice message={message} error />





        <Segment values={[['recurring', t('Recurring chore')], ['onetime', t('One-time task')], ['presets', t('Presets')]]} value={mode} onChange={(v) => setMode(v as 'recurring' | 'onetime' | 'presets')} />


        <View style={{ height: 16 }} />





        <Section title={t('Basic Info')}>


          <Field label={t('Task Name')} value={name} onChangeText={setName} placeholder={t('Take out the trash')} />


          <IconPickerField label={t('Icon (emoji or photo)')} value={icon} onChange={setIcon} groupId={groupId} />


          <Pressable style={s.quickRow} onPress={() => setIsTimer(!isTimer)}>


            <View style={[s.radio, isTimer && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Starts on a timer (delayed start)')}</Text>


          </Pressable>


          


          {isTimer ? (


            <View style={{ marginTop: 12 }}>


              <Field label={t('Timer duration (minutes)')} value={onetimeTimerMinutes} onChangeText={setOnetimeTimerMinutes} keyboardType="number-pad" placeholder="60" />


              <Text style={s.taskDue}>{t('Task will be created and notifications sent when the timer finishes.')}</Text>


            </View>


          ) : (


            <View style={{ marginTop: 12 }}>


              <View style={{ marginBottom: 16 }}><Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Due date')}</Text>{Platform.OS === 'ios' ? (<DateTimePicker value={onetimeDueDate} mode="date" display="default" onChange={(event: any, date: any) => date && setOnetimeDueDate(date)} />) : (<><Pressable style={s.input} onPress={() => setShowDatePicker(true)}><Text style={{ color: colors.ink }}>{onetimeDueDate.toISOString().slice(0, 10)}</Text></Pressable>{showDatePicker && (<DateTimePicker value={onetimeDueDate} mode="date" display="default" onChange={(event: any, date: any) => { setShowDatePicker(false); if (date) setOnetimeDueDate(date); }} />)}</>)}</View>


              <View style={{ marginBottom: 16 }}>

              <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Due Time (Optional)')}</Text>
              <Text style={[s.taskDue, { marginBottom: 8 }]}>{t('The clock time this chore is due on that date. Leave blank if only the date matters.')}</Text>

              {Platform.OS === 'ios' ? (

                <DateTimePicker value={dueTimeOnetime ? (function(){ const [h,m]=dueTimeOnetime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => date && setDueTimeOnetime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0"))} />
              ) : (

                <>

                  <Pressable style={s.input} onPress={() => setShowDueTimeOnetimePicker(true)}>

                    <Text style={{ color: dueTimeOnetime ? colors.ink : colors.muted }}>{dueTimeOnetime || 'No time set'}</Text>

                  </Pressable>

                  {showDueTimeOnetimePicker && (

                    <DateTimePicker value={dueTimeOnetime ? (function(){ const [h,m]=dueTimeOnetime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => { setShowDueTimeOnetimePicker(false); if (date) setDueTimeOnetime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0")); }} />
                  )}

                </>

              )}

              {dueTimeOnetime ? (

                <Pressable onPress={() => setDueTimeOnetime('')} style={{ marginTop: 8 }}><Text style={{ color: colors.accent, fontSize: 12, fontFamily: themedFontFamily(colors) }}>{t('Clear time')}</Text></Pressable>

              ) : null}

            </View>


            </View>


          )}


        </Section>





        <Section title={t('Assign to')}>


          <View style={s.people}>


            {roster.map(person => (


              <Pressable key={person.user_id} style={[s.personChip, onetimeAssigned.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => toggleOnetimePerson(person.user_id)}>


                <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />


                <Text style={[s.personText, onetimeAssigned.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>


              </Pressable>


            ))}


          </View>
          {onetimeAssigned.length === 0 && <Text style={[s.muted, { marginTop: 8 }]}>{t('No one selected.')} {t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}



        </Section>





        <Section title={t('Options')}>


          <Pressable style={s.quickRow} onPress={() => setRequiresPhoto(!requiresPhoto)}>


            <View style={[s.radio, requiresPhoto && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Requires a photo to complete')}</Text>


          </Pressable>


          <Pressable style={s.quickRow} onPress={() => setCountsForLeaderboard(!countsForLeaderboard)}>


            <View style={[s.radio, countsForLeaderboard && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Counts toward the leaderboard')}</Text>


          </Pressable>


          <Text style={s.taskDue}>{t("Turn this off for things you just want to track — like reading — without it inflating the leaderboard each time it's done.")}</Text>


        </Section>


        <Section title={t('Preset')}>


          <Pressable style={s.quickRow} onPress={() => setSaveAsPreset(!saveAsPreset)}>


            <View style={[s.radio, saveAsPreset && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Also save this as a preset for quick reuse')}</Text>


          </Pressable>


          <Text style={s.taskDue}>{t('Saves these same settings (name, icon, photo/coin/timer settings) so you can quickly create it again later from the Presets tab -- without re-typing everything. Who it\'s assigned to isn\'t saved; you pick that fresh each time you use it.')}</Text>


        </Section>






        <Section title={t('Rewards')}>


          {!rewardsEnabled ? (


            <Text style={s.taskDue}>{t('Coin rewards are off. Turn on "Rewards & Coins" in Settings to assign coins to this chore.')}</Text>


          ) : !canSetCoins ? (


            <Text style={s.taskDue}>{t('Only admins can set coin rewards on chores in this household.')}</Text>


          ) : selfAssignmentBlocksCoins(onetimeAssigned) ? (


            <Text style={s.taskDue}>{t("You've only assigned this to yourself — add at least one other person to set a coin amount.")}</Text>


          ) : (


            <Field label={`${t('Coin Reward')} (${coinReward}${maxCoins ? ` / max ${maxCoins}` : ''})`} value={coinReward} onChangeText={setCoinReward} keyboardType="number-pad" />


          )}


        </Section>





        <Button label={busy ? t('Working...') : t('Create Task')} onPress={submitOnetime} disabled={busy || !name.trim()} />


      </KeyboardAwareScrollView>


    );


  }


  if (mode === 'presets') {
    return (
      <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>
        <Notice message={presetsError} error />

        <Segment values={[['recurring', t('Recurring chore')], ['onetime', t('One-time task')], ['presets', t('Presets')]]} value={mode} onChange={(v) => setMode(v as 'recurring' | 'onetime' | 'presets')} />
        <View style={{ height: 16 }} />

        <Section title={t('Presets')}>
          <Text style={s.taskDue}>{t("Save chores you do often but don't have a fixed schedule for -- like clearing the dishwasher -- and quickly assign or add them again later, without re-typing everything.")}</Text>
        </Section>

        {presetsLoading ? (
          <Text style={s.muted}>{t('Loading...')}</Text>
        ) : presets.length === 0 ? (
          <Text style={[s.muted, { marginVertical: 8 }]}>{t('No presets saved yet.')}</Text>
        ) : (
          <Section title={t('Saved presets')}>
            {presets.map((p) => (
              <View key={p.id} style={[s.calendarItem]}>
                <IconGlyph icon={p.icon} />
                <View style={s.taskBody}>
                  <Text style={s.taskTitle}>{p.name}</Text>
                  <Text style={s.taskDue}>
                    {p.has_timer ? t('Timer · {{minutes}} min', { minutes: p.default_timer_minutes }) : t('One-time')}
                    {p.coin_reward ? ` · ${p.coin_reward}🪙` : ''}
                  </Text>
                </View>
                <Pressable style={s.outlineButton} onPress={() => { setPresetAssignees([]); setAssigningPreset(p); }} disabled={presetBusy}>
                  <Text style={s.outlineText}>{t('Add')}</Text>
                </Pressable>
                <Pressable style={[s.outlineButton, { marginLeft: 8 }]} onPress={() => startEditPreset(p)} disabled={presetBusy}>
                  <Text style={s.outlineText}>{t('Edit')}</Text>
                </Pressable>
                <Pressable style={[s.outlineButton, { marginLeft: 8, borderColor: colors.red }]} onPress={() => removePreset(p.id)} disabled={presetBusy}>
                  <Text style={[s.outlineText, { color: colors.red }]}>{t('Delete')}</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        )}

        {editingPresetId ? (
          <Section title={editingPresetId === 'new' ? t('New preset') : t('Edit preset')}>
            <Field label={t('Chore Name')} value={presetName} onChangeText={setPresetName} placeholder={t('Clean the kitchen')} />
            <IconPickerField label={t('Icon (emoji or photo)')} value={presetIcon} onChange={setPresetIcon} groupId={groupId} />

            <Pressable style={s.quickRow} onPress={() => setPresetRequiresPhoto(!presetRequiresPhoto)}>
              <View style={[s.radio, presetRequiresPhoto && s.radioActive]} />
              <Text style={s.taskTitle}>{t('Requires a photo to complete')}</Text>
            </Pressable>

            <Pressable style={s.quickRow} onPress={() => setPresetCountsForLeaderboard(!presetCountsForLeaderboard)}>
              <View style={[s.radio, presetCountsForLeaderboard && s.radioActive]} />
              <Text style={s.taskTitle}>{t('Counts toward the leaderboard')}</Text>
            </Pressable>

            <Pressable style={s.quickRow} onPress={() => setPresetHasTimer(!presetHasTimer)}>
              <View style={[s.radio, presetHasTimer && s.radioActive]} />
              <Text style={s.taskTitle}>{t('Starts on a timer (delayed start)')}</Text>
            </Pressable>
            {presetHasTimer && (
              <Field label={t('Timer duration (minutes)')} value={presetTimerMinutes} onChangeText={setPresetTimerMinutes} keyboardType="number-pad" placeholder="60" />
            )}

            {rewardsEnabled && canSetCoins && (
              <Field label={`${t('Coin Reward')} (${presetCoinReward}${maxCoins ? ` / max ${maxCoins}` : ''})`} value={presetCoinReward} onChangeText={setPresetCoinReward} keyboardType="number-pad" />
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label={presetBusy ? t('Working...') : t('Save')} onPress={savePreset} disabled={presetBusy || !presetName.trim()} />
              </View>
              <Pressable style={[s.outlineButton, { flex: 1, alignItems: 'center', paddingVertical: 14 }]} onPress={() => setEditingPresetId(null)}>
                <Text style={s.outlineText}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          </Section>
        ) : (
          <Button label={t('+ New Preset')} onPress={startNewPreset} />
        )}

        <Modal transparent animationType="slide" visible={!!assigningPreset} onRequestClose={() => setAssigningPreset(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
              <Text style={[s.taskTitle, { fontSize: 20, marginBottom: 12 }]}>{assigningPreset?.name}</Text>
              <Text style={s.fieldLabel}>{t('Assign to')}</Text>
              <View style={[s.people, { marginTop: 8, marginBottom: 8 }]}>
                {roster.map(person => (
                  <Pressable key={person.user_id} style={[s.personChip, presetAssignees.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => togglePresetAssignee(person.user_id)}>
                    <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />
                    <Text style={[s.personText, presetAssignees.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>
                  </Pressable>
                ))}
              </View>
              {presetAssignees.length === 0 && <Text style={[s.muted, { marginBottom: 8 }]}>{t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}
              <Button label={presetBusy ? t('Working...') : t('Add')} onPress={instantiatePreset} disabled={presetBusy} />
              <Pressable style={[s.outlineButton, { alignItems: 'center', paddingVertical: 14, marginTop: 12 }]} onPress={() => setAssigningPreset(null)}>
                <Text style={s.outlineText}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </KeyboardAwareScrollView>
    );
  }





  return (


    <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>


      <Notice message={message} error />





      <Segment values={[['recurring', t('Recurring chore')], ['onetime', t('One-time task')], ['presets', t('Presets')]]} value={mode} onChange={(v) => setMode(v as 'recurring' | 'onetime' | 'presets')} />


      <View style={{ height: 16 }} />





      <Section title={t('Basic Info')}>


        <Field label={t('Chore Name')} value={name} onChangeText={setName} placeholder={t('Clean the kitchen')} />


        <IconPickerField label={t('Icon (emoji or photo)')} value={icon} onChange={setIcon} groupId={groupId} />


      </Section>


      


      <Section title={t('Capabilities')}>


        <View style={s.form}>


          


          <Pressable style={s.quickRow} onPress={() => setRequiresPhoto(!requiresPhoto)}>


            <View style={[s.radio, requiresPhoto && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Requires a photo to complete')}</Text>


          </Pressable>


          <Pressable style={s.quickRow} onPress={() => setCountsForLeaderboard(!countsForLeaderboard)}>


            <View style={[s.radio, countsForLeaderboard && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Counts toward the leaderboard')}</Text>


          </Pressable>


          <Pressable style={s.quickRow} onPress={() => setHasCounter(!hasCounter)}>


            <View style={[s.radio, hasCounter && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Triggers after a count (e.g. 10 dishes)')}</Text>


          </Pressable>


          <ResourceUsageEditor resources={resources} value={usesResources} onChange={setUsesResources} />

        </View>


      </Section>





      {hasSchedule && (


        <Section title={t('Delay Settings')}>


          <View style={s.form}>


            <Pressable style={s.quickRow} onPress={() => setIsDelayable(!isDelayable)}>


              <View style={[s.radio, isDelayable && s.radioActive]} />


              <Text style={s.taskTitle}>{t('Can be delayed')}</Text>


            </Pressable>


            {isDelayable && (


              <Field label={t('Max consecutive delays')} value={maxDelays} onChangeText={setMaxDelays} keyboardType="number-pad" />


            )}


          </View>


        </Section>


      )}


      


      {hasSchedule && (


        <Section title={t('Schedule Settings')}>


          <View style={{ marginBottom: 16 }}>


            <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Starts On (Optional)')}</Text>


            {Platform.OS === 'ios' ? (


              <DateTimePicker value={startDate || new Date()} mode="date" display="default" onChange={(event: any, date: any) => date && setStartDate(date)} />


            ) : (


              <>


                <Pressable style={s.input} onPress={() => setShowStartDatePicker(true)}>


                  <Text style={{ color: startDate ? colors.ink : colors.muted }}>{startDate ? startDate.toISOString().slice(0, 10) : 'Today'}</Text>


                </Pressable>


                {showStartDatePicker && (


                  <DateTimePicker value={startDate || new Date()} mode="date" display="default" onChange={(event: any, date: any) => { setShowStartDatePicker(false); if (date) setStartDate(date); }} />


                )}


              </>


            )}


            {startDate && (


              <Pressable onPress={() => setStartDate(null)} style={{ marginTop: 8 }}><Text style={{ color: colors.accent, fontSize: 12, fontFamily: themedFontFamily(colors) }}>{t('Clear start date')}</Text></Pressable>


            )}


          </View>





          <Segment values={[['interval', t('Every X Days')], ['weekly', t('Specific Days & Times')]]} value={scheduleType} onChange={(v) => setScheduleType(v as string)} />


          <View style={{ height: 16 }} />


          


          {scheduleType === 'interval' ? (


            <Field label={t('Interval (Days)')} value={interval} onChangeText={setInterval} keyboardType="number-pad" />


          ) : (


            <WeeklyDayTimes value={weekly} onChange={setWeekly} />


          )}





          <View style={{ height: 24 }} />


          <Text style={s.fieldLabel}>{t('Who does this?')}</Text>


          <Segment values={[['true', t('Rotational (Take Turns)')], ['false', t('Shared (Everyone together)')]]} value={String(isRotational)} onChange={(v) => setIsRotational(v === 'true')} />


          <View style={{ height: 16 }} />





          {isRotational ? (


            <View>


              <Text style={s.muted}>{t('Tap roster to append to the rotation sequence. Tap sequence below to remove.')}</Text>


              <View style={s.people}>


                {roster.map(person => (


                  <Pressable key={person.user_id} style={[s.outlineButton, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => addPersonSequence(person.user_id)}>


                    <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />


                    <Text style={s.outlineText}>{t('+ Add {{name}}', { name: person.display_name })}</Text>


                  </Pressable>


                ))}


              </View>


              <View style={{ marginTop: 12 }}>


                {assigned.map((id, index) => {


                  const p = roster.find(r => r.user_id === id);


                  return (


                    <Pressable key={`${id}-${index}`} style={s.moreRow} onPress={() => removePersonSequence(index)}>


                      <IconGlyph icon={p?.avatar_url} fallback="👤" size={15} photoSize={20} />


                      <Text style={[s.taskTitle, { flex: 1 }]}>{index + 1}. {p?.display_name || t('Unknown')}</Text>


                      <Text style={s.taskDue}>{t('Remove')}</Text>


                    </Pressable>


                  );


                })}


                {assigned.length === 0 && <Text style={s.muted}>{t('No sequence built yet.')} {t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}


              </View>


            </View>


          ) : (


            <>
              <View style={s.people}>


                {roster.map(person => (


                  <Pressable key={person.user_id} style={[s.personChip, assigned.includes(person.user_id) && s.personChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => togglePersonShared(person.user_id)}>


                    <IconGlyph icon={person.avatar_url} fallback="👤" size={13} photoSize={16} />


                    <Text style={[s.personText, assigned.includes(person.user_id) && s.personTextActive]}>{person.display_name}</Text>


                  </Pressable>


                ))}


              </View>
              {assigned.length === 0 && <Text style={[s.muted, { marginTop: 8 }]}>{t('No one selected.')} {t('Leave it this way and the chore stays unassigned — open for anyone to grab.')}</Text>}
            </>


          )}


        </Section>


      )}


      


      {hasCounter && (


        <Section title={t('Counter Settings')}>


          <Field label={t('Trigger after (Count)')} value={counterThreshold} onChangeText={setCounterThreshold} keyboardType="number-pad" />


        </Section>


      )}





      <Section title={t('Rewards & Approval')}>


        <View style={s.form}>


          {!rewardsEnabled ? (


            <Text style={s.taskDue}>{t('Coin rewards are off. Turn on "Rewards & Coins" in Settings to assign coins to this chore.')}</Text>


          ) : !canSetCoins ? (


            <Text style={s.taskDue}>{t('Only admins can set coin rewards on chores in this household.')}</Text>


          ) : selfAssignmentBlocksCoins(assigned) ? (


            <Text style={s.taskDue}>{t("You're in this rotation alone — add at least one other person to set a coin amount.")}</Text>


          ) : (


            <Field label={`Coin Reward (${coinReward}${maxCoins ? ` / max ${maxCoins}` : ''})`} value={coinReward} onChangeText={setCoinReward} keyboardType="number-pad" />


          )}


          <Pressable style={s.quickRow} onPress={() => setRequiresApproval(!requiresApproval)}>


            <View style={[s.radio, requiresApproval && s.radioActive]} />


            <Text style={s.taskTitle}>{t('Requires admin approval')}</Text>


          </Pressable>


          <View style={{ marginBottom: 16 }}>

              <Text style={[s.fieldLabel, { marginBottom: 8 }]}>{t('Due Time (Optional)')}</Text>
              <Text style={[s.taskDue, { marginBottom: 8 }]}>{t('The clock time this chore is due each day. Leave blank if only the date matters.')}</Text>

              {Platform.OS === 'ios' ? (

                <DateTimePicker value={dueTime ? (function(){ const [h,m]=dueTime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => date && setDueTime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0"))} />
              ) : (

                <>

                  <Pressable style={s.input} onPress={() => setShowDueTimePicker(true)}>

                    <Text style={{ color: dueTime ? colors.ink : colors.muted }}>{dueTime || 'No time set'}</Text>

                  </Pressable>

                  {showDueTimePicker && (

                    <DateTimePicker value={dueTime ? (function(){ const [h,m]=dueTime.split(":"); const d=new Date(); d.setHours(parseInt(h,10), parseInt(m,10), 0, 0); return d; })() : new Date()} mode="time" display="default" onChange={(event: any, date: any) => { setShowDueTimePicker(false); if (date) setDueTime(date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0")); }} />
                  )}

                </>

              )}

              {dueTime ? (

                <Pressable onPress={() => setDueTime('')} style={{ marginTop: 8 }}><Text style={{ color: colors.accent, fontSize: 12, fontFamily: themedFontFamily(colors) }}>{t('Clear time')}</Text></Pressable>

              ) : null}

            </View>


          <Field label={t('Overdue Nudge Interval (minutes, optional)')} value={overdueNudge} onChangeText={setOverdueNudge} keyboardType="number-pad" placeholder={t('e.g. 30')} />
          <Text style={[s.taskDue, { marginTop: -8, marginBottom: 8 }]}>{t("Once this chore is overdue (past its due time), how often to automatically re-nudge the assignee — not part of when it's due.")}</Text>


        </View>


      </Section>


      


      <Button label={busy ? t('Working...') : t('Create Chore')} onPress={submit} disabled={busy || !name.trim()} />


    </KeyboardAwareScrollView>


  );


}


