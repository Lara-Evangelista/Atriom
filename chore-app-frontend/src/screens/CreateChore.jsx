import React, { useCallback, useEffect, useState } from "react";

import { Pencil, Trash2, X } from "lucide-react";

import { useTranslation } from "react-i18next";

import { supabase } from "../supabaseClient";

import { PeoplePicker, IconPicker, ErrorBanner, IconGlyph } from "../components/UI";



const KINDS = [
  { id: "scheduled", label: "Rotating / assigned" },
  { id: "onetime", label: "One-time task" },
  { id: "counter", label: "Counter-triggered" },
  { id: "presets", label: "Presets" },
];



const DAYS = [

  { k: "1", l: "Mon" }, { k: "2", l: "Tue" }, { k: "3", l: "Wed" },

  { k: "4", l: "Thu" }, { k: "5", l: "Fri" }, { k: "6", l: "Sat" }, { k: "7", l: "Sun" },

];



// Shared helper: figure out whether the current user is allowed to put a

// coin reward on a chore in this group, given the household's coin policy

// (Settings > Rewards System > "Who can set coin rewards" / "Allow

// self-assigned coins"). Mirrors the same rule enforced server-side in

// check_coin_assignment_allowed() and on mobile in CreateScreen.tsx.

function useCoinPermissions(currentMembership, user) {

  const groupSettings = currentMembership?.groups || {};

  const isAdmin = currentMembership?.role === "owner" || currentMembership?.role === "admin";

  const restrictCoinsToAdmins = groupSettings.restrict_coins_to_admins ?? true;

  const allowSelfAssignedCoins = !!groupSettings.allow_self_assigned_coins;

  const rewardsEnabled = !!groupSettings.rewards_enabled;

  const canSetCoins = rewardsEnabled && (isAdmin || !restrictCoinsToAdmins);

  const currentUserId = user?.id;

  const selfAssignmentBlocksCoins = (peopleList) => {

    if (allowSelfAssignedCoins) return false;

    if (!currentUserId) return false;

    return peopleList.includes(currentUserId) && peopleList.length < 2;

  };

  return { isAdmin, restrictCoinsToAdmins, allowSelfAssignedCoins, rewardsEnabled, canSetCoins, currentUserId, selfAssignmentBlocksCoins };

}



// Shared coin-reward input, used by the create form (scheduled + onetime)

// and the edit form. Shows the number input when the current user is

// allowed to set coins on this chore's current assignment; otherwise

// explains why not, instead of silently hiding the whole section.

function CoinRewardField({ t, rewardsEnabled, canSetCoins, blockedBySelfAssignment, coinReward, setCoinReward, maxCoins }) {

  if (!rewardsEnabled) {

    return <p className="text-xs app-muted">{t("Coin rewards are off. Turn on \"Rewards & Coins\" in Settings to assign coins to this chore.")}</p>;

  }

  if (!canSetCoins) {

    return <p className="text-xs app-muted">{t("Only admins can set coin rewards on chores in this household.")}</p>;

  }

  if (blockedBySelfAssignment) {

    return <p className="text-xs app-muted">{t("Add at least one other person to earn coins on this chore — this household doesn't allow awarding coins to yourself.")}</p>;

  }

  return (

    <div className="flex items-center gap-2">

      <span className="text-sm">{t("Coin reward:")}</span>

      <input className="app-input w-20" type="number" min="0" max={maxCoins || undefined} value={coinReward} onChange={e => setCoinReward(e.target.value)} />

    </div>

  );

}



export default function CreateChore({ groupId, roster, rewardsEnabled, maxCoins, currentMembership, user }) {

  const { t } = useTranslation();

  const { canSetCoins, selfAssignmentBlocksCoins } = useCoinPermissions(currentMembership, user);

  const [kind, setKind] = useState("scheduled");

  const [name, setName] = useState("");

  const [icon, setIcon] = useState("??");

  const [requiresPhoto, setRequiresPhoto] = useState(false);

  

  // Scheduled-specific state

  const [scheduleType, setScheduleType] = useState("interval"); // 'interval' | 'weekly'

  const [intervalDays, setIntervalDays] = useState(7);

  const [weekly, setWeekly] = useState({}); // { "1": "15:00" }

  

  const [isRotational, setIsRotational] = useState(true);

  const [people, setPeople] = useState([]); // sequence or set

  

  const [isDelayable, setIsDelayable] = useState(true);

  const [maxDelays, setMaxDelays] = useState(3);

  const [coinReward, setCoinReward] = useState(0);

  const [requiresApproval, setRequiresApproval] = useState(false);

  const [dueTime, setDueTime] = useState('');

  const [overdueNudge, setOverdueNudge] = useState('');

  const [countsForLeaderboard, setCountsForLeaderboard] = useState(true);



  // Onetime-specific

  
  const [startDate, setStartDate] = useState('');
  const [isTimer, setIsTimer] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(60);
  const [dueTimeOnetime, setDueTimeOnetime] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Counter-specific

  const [threshold, setThreshold] = useState(5);



  const [resources, setResources] = useState([]);

  const [usesResources, setUsesResources] = useState({});



  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");



  useEffect(() => {

    if (!groupId) return;

    supabase

      .from("resources")

      .select("id, name, unit")

      .eq("group_id", groupId)

      .then(({ data }) => setResources(data || []));

  }, [groupId]);



  function reset() {

    setName("");

    setIcon("??");

    setRequiresPhoto(false);

    setPeople([]);

    setUsesResources({});

    setWeekly({});

    setCountsForLeaderboard(true);

  }



  async function attachResources(choreTypeId) {

    const entries = Object.entries(usesResources).filter(([, qty]) => qty !== "" && Number(qty) > 0);

    if (entries.length === 0) return;

    const resourceIds = entries.map(([id]) => id);

    const qtys = entries.map(([, qty]) => Number(qty));

    const { error } = await supabase.rpc("update_chore_resources", {

      p_chore_type_id: choreTypeId,

      p_resource_ids: resourceIds,

      p_qtys: qtys,

    });

    if (error) throw error;

  }



  const toggleDay = (day) => {

    setWeekly((prev) => {

      const next = { ...prev };

      if (next[day]) delete next[day];

      else next[day] = "15:00";

      return next;

    });

  };

  const updateDayTime = (day, time) => setWeekly((prev) => ({ ...prev, [day]: time }));



  async function submit(e) {

    e.preventDefault();

    setError(""); setNotice(""); setBusy(true);

    try {

      let newId = null;

      if (kind === "scheduled") {

        if (people.length === 0) throw new Error(t("Assign at least one person."));

        if (scheduleType === "weekly" && Object.keys(weekly).length === 0) throw new Error(t("Select at least one day for weekly schedule."));



        const advSched = scheduleType === "weekly" ? weekly : null;

        

        const { data, error } = await supabase.rpc("create_chore_type_scheduled", {

          p_group_id: groupId,

          p_name: name.trim(),

          p_icon: icon.trim(),

          p_interval_days: scheduleType === "interval" ? Number(intervalDays) : 1,

          p_user_ids: people,

          p_requires_photo: requiresPhoto,

          p_advanced_schedule: advSched,

          p_is_rotational: isRotational,

          p_is_delayable: isDelayable,

          p_max_consecutive_delays: isDelayable ? Number(maxDelays) : null,

          p_coin_reward: (canSetCoins && !selfAssignmentBlocksCoins(people)) ? Number(coinReward) : 0,

          p_requires_approval: requiresApproval,

          p_due_time: dueTime || null,

          p_overdue_nudge_interval_minutes: overdueNudge ? Number(overdueNudge) : null,

          p_counts_for_leaderboard: countsForLeaderboard,
          p_start_date: startDate || null,

        });

        if (error) throw error;

        newId = data;

      } else if (kind === "onetime") {

        const { data, error } = await supabase.rpc("create_onetime_task", {

          p_group_id: groupId,

          p_name: name,

          p_icon: icon,

          p_assignee_ids: people,

          p_due_date: dueDate,

          p_requires_photo: requiresPhoto,

          p_coin_reward: (canSetCoins && !selfAssignmentBlocksCoins(people)) ? Number(coinReward) : 0,

          p_counts_for_leaderboard: countsForLeaderboard,
          p_start_date: startDate || null,

        });

        if (error) throw error;

        newId = data;

      } else if (kind === "counter") {

        const { data, error } = await supabase.from("chore_types").insert({

            group_id: groupId, name, icon, requires_photo: requiresPhoto, has_counter: true, counter_threshold: Number(threshold), counter_current: 0,

            counts_for_leaderboard: countsForLeaderboard,

        }).select("id").single();

        if (error) throw error;

        newId = data.id;

      } else if (kind === "timer") {

        const { data, error } = await supabase.from("chore_types").insert({ group_id: groupId, name, icon, requires_photo: requiresPhoto, has_timer: true, counts_for_leaderboard: countsForLeaderboard }).select("id").single();

        if (error) throw error;

        newId = data.id;

      }



      if (newId) await attachResources(newId);



      setNotice(t('"{{name}}" created.', { name }));

      reset();

    } catch (err) {

      setError(err.message || String(err));

    } finally {

      setBusy(false);

    }

  }



  return (

    <div className="flex flex-col gap-4 pb-10">

      <div className="flex flex-wrap gap-2">

        {KINDS.map((k) => (

          <button

            key={k.id}

            className={`app-btn px-3 py-1.5 text-sm ${kind === k.id ? "app-accent-bg" : "app-card"}`}

            onClick={() => { setKind(k.id); setPeople([]); }}

            type="button"

          >

            {t(k.label)}

          </button>

        ))}

      </div>

      {kind === "presets" ? (
        <PresetsTab
          groupId={groupId}
          roster={roster}
          rewardsEnabled={rewardsEnabled}
          maxCoins={maxCoins}
          currentMembership={currentMembership}
          user={user}
        />
      ) : (
      <form onSubmit={submit} className="app-card app-radius p-4 flex flex-col gap-4">

        <div>

          <label className="text-xs font-medium app-muted">{t("Name")}</label>

          <input className="app-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("e.g. Dishes")} />

        </div>



        <div>

          <label className="text-xs font-medium app-muted">{t("Icon (emoji or photo)")}</label>

          <div className="mt-1">

            <IconPicker value={icon} onChange={setIcon} groupId={groupId} />

          </div>

        </div>



        {kind === "scheduled" && (

          <>

            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Delay Settings")}</label>

              <label className="flex items-center gap-2 text-sm mb-2">

                <input type="checkbox" checked={isDelayable} onChange={(e) => setIsDelayable(e.target.checked)} />

                {t("Can be delayed")}

              </label>

              {isDelayable && (

                <div className="flex items-center gap-2">

                  <span className="text-sm">{t("Max consecutive delays:")}</span>

                  <input className="app-input w-20" type="number" min="0" value={maxDelays} onChange={(e) => setMaxDelays(e.target.value)} />

                </div>

              )}

            </div>



            <hr className="app-border-color my-1" />



            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Schedule Settings")}</label>

              <div className="flex gap-2 mb-3">

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${scheduleType === 'interval' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setScheduleType('interval')}>{t("Every X Days")}</button>

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${scheduleType === 'weekly' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setScheduleType('weekly')}>{t("Specific Days & Times")}</button>

              </div>



              {scheduleType === "interval" ? (

                <div className="flex items-center gap-2 mb-4">

                  <span className="text-sm">{t("Interval (Days):")}</span>

                  <input className="app-input w-20" type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />

                </div>

              ) : (

                <div className="flex flex-col gap-2 mb-4">

                  {DAYS.map(day => (

                    <div key={day.k} className="flex items-center gap-3">

                      <button type="button" className={`app-btn px-3 py-1 text-sm ${weekly[day.k] !== undefined ? 'app-accent-bg' : 'app-card'}`} onClick={() => toggleDay(day.k)}>

                        {t(day.l)}

                      </button>

                      {weekly[day.k] !== undefined && (

                        <input className="app-input w-24 text-sm" value={weekly[day.k]} onChange={(e) => updateDayTime(day.k, e.target.value)} placeholder={t("HH:MM")} />

                      )}

                    </div>

                  ))}

                </div>

              )}

            </div>



            <hr className="app-border-color my-1" />



            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Who does this?")}</label>

              <div className="flex gap-2 mb-3">

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${isRotational ? 'app-accent-bg' : 'app-card'}`} onClick={() => { setIsRotational(true); setPeople([]); }}>{t("Rotational (Take Turns)")}</button>

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${!isRotational ? 'app-accent-bg' : 'app-card'}`} onClick={() => { setIsRotational(false); setPeople([]); }}>{t("Shared (Everyone)")}</button>

              </div>



              {isRotational ? (

                <div>

                  <p className="text-xs app-muted mb-2">{t("Click a person to append them to the sequence.")}</p>

                  <div className="flex flex-wrap gap-2 mb-3">

                    {roster.map(r => (

                      <button key={r.user_id} type="button" className="app-btn app-card px-2 py-1 text-sm" onClick={() => setPeople(prev => [...prev, r.user_id])}>

                        {t("+ {{name}}", { name: r.display_name })}

                      </button>

                    ))}

                  </div>

                  <div className="flex flex-col gap-1">

                    {people.map((id, index) => {

                      const p = roster.find(r => r.user_id === id);

                      return (

                        <div key={`${id}-${index}`} className="flex justify-between items-center text-sm p-2 app-card app-radius">

                          <span>{index + 1}. {p?.display_name || t('Unknown')}</span>

                          <button type="button" className="text-red-500 text-xs" onClick={() => setPeople(prev => prev.filter((_, i) => i !== index))}>{t("Remove")}</button>

                        </div>

                      );

                    })}

                    {people.length === 0 && <span className="text-xs app-muted">{t("No sequence built yet.")}</span>}

                  </div>

                </div>

              ) : (

                <div className="mt-1">

                  <PeoplePicker roster={roster} selected={people} onChange={setPeople} />

                </div>

              )}

            </div>

          </>

        )}



        {kind === "onetime" && (

          <>

            <div>

              <label className="text-xs font-medium app-muted block mb-1">{t("Due date")}</label>

              <input className="app-input w-full" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

            </div>

            <div>

              <label className="text-xs font-medium app-muted block mb-1">{t("Assign to")}</label>

              <PeoplePicker roster={roster} selected={people} onChange={setPeople} />

              <p className="text-xs app-muted mt-1">{t("Pick more than one and it's first-come — whoever marks it done gets the point.")}</p>

            </div>

            <div className="pt-2 border-t app-border-color">

              <CoinRewardField

                t={t}

                rewardsEnabled={rewardsEnabled}

                canSetCoins={canSetCoins}

                blockedBySelfAssignment={selfAssignmentBlocksCoins(people)}

                coinReward={coinReward}

                setCoinReward={setCoinReward}

                maxCoins={maxCoins}

              />

            </div>

          </>

        )}



        {kind === "counter" && (

          <div>

            <label className="text-xs font-medium app-muted block mb-1">{t("Do it once this many things pile up")}</label>

            <input className="app-input w-full" type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} />

            <p className="text-xs app-muted mt-1">{t("Anyone can add to the count from the Today tab's Quick actions. Hitting the limit opens the task to the whole household.")}</p>

          </div>

        )}



        {kind === "timer" && (

          <p className="text-xs app-muted">{t("This creates the reusable cycle (e.g. \"Dishwasher\"). Cycle length is chosen each time it's started, from Today's Quick actions.")}</p>

        )}



        {kind === "scheduled" && (

          <div className="flex flex-col gap-3 pt-2 border-t app-border-color">

            <label className="text-xs font-medium app-muted">{t("Rewards & Timing")}</label>

            <CoinRewardField

              t={t}

              rewardsEnabled={rewardsEnabled}

              canSetCoins={canSetCoins}

              blockedBySelfAssignment={selfAssignmentBlocksCoins(people)}

              coinReward={coinReward}

              setCoinReward={setCoinReward}

              maxCoins={maxCoins}

            />

            <label className="flex items-center gap-2 text-sm">

              <input type="checkbox" checked={requiresApproval} onChange={e => setRequiresApproval(e.target.checked)} /> {t("Requires admin approval")}

            </label>

            <div className="flex items-center gap-2">

              <span className="text-sm">{t("Due time (HH:MM, optional):")}</span>

              <input type="time" className="app-input w-28" value={dueTime} onChange={e => setDueTime(e.target.value)} />

            </div>

            <div className="flex items-center gap-2">

              <span className="text-sm">{t("Overdue nudge (min, optional):")}</span>

              <input className="app-input w-20" type="number" min="0" placeholder="30" value={overdueNudge} onChange={e => setOverdueNudge(e.target.value)} />

            </div>

          </div>

        )}



        <label className="flex items-center gap-2 text-sm mt-2">

          <input type="checkbox" checked={requiresPhoto} onChange={(e) => setRequiresPhoto(e.target.checked)} />

          {t("Require a photo to mark done")}

        </label>



        <div>

          <label className="flex items-center gap-2 text-sm">

            <input type="checkbox" checked={countsForLeaderboard} onChange={(e) => setCountsForLeaderboard(e.target.checked)} />

            {t("Counts toward the leaderboard")}

          </label>

          <p className="text-xs app-muted mt-1">

            {t("Turn this off for things you just want to track — like reading — without it inflating the leaderboard each time it's done.")}

          </p>

        </div>



        {resources.length > 0 && kind !== "onetime" && (

          <div>

            <label className="text-xs font-medium app-muted block mb-1">{t("Uses resources on completion (optional)")}</label>

            <div className="flex flex-col gap-2">

              {resources.map((r) => (

                <div key={r.id} className="flex items-center gap-2">

                  <span className="text-sm flex-1">{r.name} {r.unit ? `(${r.unit})` : ""}</span>

                  <input className="app-input w-20" type="number" min={0} step="0.5" placeholder={t("qty")} value={usesResources[r.id] ?? ""} onChange={(e) => setUsesResources((prev) => ({ ...prev, [r.id]: e.target.value }))} />

                </div>

              ))}

            </div>

          </div>

        )}



        <ErrorBanner error={error} onClose={() => setError("")} />

        {notice && <div className="text-sm app-chip-good app-radius px-3 py-2">{notice}</div>}



        <button className="app-btn app-accent-bg py-2.5 mt-2" disabled={busy} type="submit">
          {busy ? t("Creating…") : t("Create Chore")}
        </button>
      </form>
      )}

      {kind !== "presets" && (
        <ManageChores groupId={groupId} roster={roster} rewardsEnabled={rewardsEnabled} maxCoins={maxCoins} currentMembership={currentMembership} user={user} />
      )}
    </div>
  );

}



const KIND_LABEL = { scheduled: "Rotating / assigned", counter: "Counter-triggered", timer: "Timer / cycle", onetime: "One-time task" };



function ManageChores({ groupId, roster, rewardsEnabled, maxCoins, currentMembership, user }) {

  const { t } = useTranslation();

  const [types, setTypes] = useState([]); 

  const [onetimeTasks, setOnetimeTasks] = useState([]); 

  const [resources, setResources] = useState([]);

  const [editingKey, setEditingKey] = useState(null); 

  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");



  const load = useCallback(async () => {

    if (!groupId) return;

    const [{ data: allTypes }, { data: events }, { data: res }] = await Promise.all([

      supabase

        .from("chore_types")

        .select(

          "id, name, icon, requires_photo, has_schedule, has_counter, has_timer, schedule_interval_days, counter_threshold, advanced_schedule, is_rotational, is_delayable, max_consecutive_delays, coin_reward, requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard, chore_type_rotation(user_id, sort_order), chore_type_resources(resource_id, qty_per_completion)"

        )

        .eq("group_id", groupId)

        .eq("archived", false)

        .order("name"),

      supabase

        .from("chore_events")

        .select("id, date, chore_type_id, chore_types(id, name, icon, requires_photo, has_schedule, has_counter, has_timer, archived, counts_for_leaderboard), chore_event_assignees(user_id)")

        .eq("group_id", groupId)

        .eq("status", "pending")

        .order("date"),

      supabase.from("resources").select("id, name, unit").eq("group_id", groupId).order("name"),

    ]);



    setTypes((allTypes || []).filter((t) => t.has_schedule || t.has_counter || t.has_timer));



    const seen = new Set();

    const onetime = [];

    for (const ev of events || []) {

      const ct = ev.chore_types;

      if (!ct || ct.archived || ct.has_schedule || ct.has_counter || ct.has_timer) continue;

      if (seen.has(ct.id)) continue; 

      seen.add(ct.id);

      onetime.push(ev);

    }

    setOnetimeTasks(onetime);

    setResources(res || []);

  }, [groupId]);



  useEffect(() => {

    load();

  }, [load]);



  function closeEdit() {

    setEditingKey(null);

    setError("");

  }



  async function runAction(fn, successMsg) {

    setBusy(true); setError(""); setNotice("");

    try {

      await fn();

      setNotice(successMsg);

      setEditingKey(null);

      setConfirmDeleteKey(null);

      await load();

    } catch (err) {

      setError(err.message || String(err));

    } finally {

      setBusy(false);

    }

  }



  async function deleteType(id) {

    await runAction(async () => {

      const { error } = await supabase.rpc("archive_chore_type", { p_chore_type_id: id });

      if (error) throw error;

    }, t("Deleted. Past history and points are kept — only future occurrences were removed."));

  }



  async function deleteOnetime(eventId) {

    await runAction(async () => {

      const { error } = await supabase.rpc("delete_onetime_task", { p_event_id: eventId });

      if (error) throw error;

    }, t("Task deleted."));

  }



  if (types.length === 0 && onetimeTasks.length === 0) return null;



  return (

    <div>

      <h3 className="text-sm font-semibold app-muted mb-2 mt-4">{t("Your chores")}</h3>

      <div className="flex flex-col gap-2">

        {types.map((ct) => {

          const key = `type-${ct.id}`;

          return (

            <ChoreTypeCard

              key={key} chore={ct} roster={roster} resources={resources}

              rewardsEnabled={rewardsEnabled} maxCoins={maxCoins} currentMembership={currentMembership} user={user}

              editing={editingKey === key} confirmDelete={confirmDeleteKey === key}

              busy={busy} error={editingKey === key ? error : ""}

              onEdit={() => setEditingKey(key)} onCancelEdit={closeEdit}

              onSave={(fn, msg) => runAction(fn, msg)}

              onAskDelete={() => setConfirmDeleteKey(key)} onCancelDelete={() => setConfirmDeleteKey(null)} onConfirmDelete={() => deleteType(ct.id)}

            />

          );

        })}

        {onetimeTasks.map((ev) => {

          const key = `onetime-${ev.id}`;

          return (

            <OnetimeTaskCard

              key={key} event={ev} roster={roster}

              editing={editingKey === key} confirmDelete={confirmDeleteKey === key}

              busy={busy} error={editingKey === key ? error : ""}

              onEdit={() => setEditingKey(key)} onCancelEdit={closeEdit}

              onSave={(fn, msg) => runAction(fn, msg)}

              onAskDelete={() => setConfirmDeleteKey(key)} onCancelDelete={() => setConfirmDeleteKey(null)} onConfirmDelete={() => deleteOnetime(ev.id)}

            />

          );

        })}

      </div>

      {notice && <div className="text-sm app-chip-good app-radius px-3 py-2 mt-2">{notice}</div>}

    </div>

  );

}



function DeleteConfirm({ label, busy, onConfirm, onCancel }) {

  const { t } = useTranslation();

  return (

    <div className="app-chip-danger app-radius px-3 py-2 flex items-center justify-between gap-2 text-sm">

      <span>{t("Delete {{label}}? Past history and points are kept.", { label })}</span>

      <div className="flex gap-1.5 shrink-0">

        <button type="button" className="app-btn app-card px-2 py-1 text-xs" onClick={onCancel}>{t("Cancel")}</button>

        <button type="button" className="app-btn px-2 py-1 text-xs app-chip-danger" disabled={busy} onClick={onConfirm}>{busy ? "…" : t("Delete")}</button>

      </div>

    </div>

  );

}



function CardHeader({ ct, subtitle, onEdit, onAskDelete }) {

  return (

    <div className="flex items-center justify-between gap-3">

      <div className="flex items-center gap-2.5 min-w-0">

        <span className="text-lg app-emoji shrink-0"><IconGlyph icon={ct.icon} /></span>

        <div className="min-w-0">

          <div className="text-sm font-medium truncate">{ct.name}</div>

          <div className="text-xs app-muted">{subtitle}</div>

        </div>

      </div>

      <div className="flex gap-1 shrink-0">

        <button type="button" className="app-btn app-card p-1.5" onClick={onEdit}><Pencil size={14} /></button>

        <button type="button" className="app-btn app-card p-1.5" onClick={onAskDelete}><Trash2 size={14} /></button>

      </div>

    </div>

  );

}



function ResourceUsageEditor({ resources, value, onChange }) {

  const { t } = useTranslation();

  if (resources.length === 0) return null;

  return (

    <div>

      <label className="text-xs font-medium app-muted">{t("Uses resources on completion")}</label>

      <div className="flex flex-col gap-2 mt-1">

        {resources.map((r) => (

          <div key={r.id} className="flex items-center gap-2">

            <span className="text-sm flex-1">{r.name} {r.unit ? `(${r.unit})` : ""}</span>

            <input className="app-input w-20" type="number" min={0} step="0.5" placeholder={t("qty")} value={value[r.id] ?? ""} onChange={(e) => onChange({ ...value, [r.id]: e.target.value })} />

          </div>

        ))}

      </div>

    </div>

  );

}



function resourceMapToArrays(map) {

  const entries = Object.entries(map).filter(([, qty]) => qty !== "" && Number(qty) > 0);

  return { ids: entries.map(([id]) => id), qtys: entries.map(([, qty]) => Number(qty)) };

}



function ChoreTypeCard({ chore, roster, resources, rewardsEnabled, maxCoins, currentMembership, user, editing, confirmDelete, busy, error, onEdit, onCancelEdit, onSave, onAskDelete, onCancelDelete, onConfirmDelete }) {

  const { t } = useTranslation();

  const { canSetCoins, selfAssignmentBlocksCoins } = useCoinPermissions(currentMembership, user);

  const ct = chore;

  const [name, setName] = useState(ct.name);

  const [icon, setIcon] = useState(ct.icon || "??");

  const [requiresPhoto, setRequiresPhoto] = useState(ct.requires_photo || false);

  const [intervalDays, setIntervalDays] = useState(ct.schedule_interval_days || 7);

  const [people, setPeople] = useState(() => [...(ct.chore_type_rotation || [])].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.user_id));

  const [threshold, setThreshold] = useState(ct.counter_threshold || 5);

  

  // New edit state

  const [scheduleType, setScheduleType] = useState(ct.advanced_schedule ? "weekly" : "interval");

  const [weekly, setWeekly] = useState(ct.advanced_schedule || {});

  const [isRotational, setIsRotational] = useState(ct.is_rotational ?? true);

  const [isDelayable, setIsDelayable] = useState(ct.is_delayable ?? true);

  const [maxDelays, setMaxDelays] = useState(ct.max_consecutive_delays ?? 3);



  const [resourceMap, setResourceMap] = useState(() => Object.fromEntries((ct.chore_type_resources || []).map((r) => [r.resource_id, r.qty_per_completion])));

  const [coinReward, setCoinReward] = useState(ct.coin_reward ?? 1);

  const [requiresApproval, setRequiresApproval] = useState(ct.requires_approval ?? false);

  const [dueTime, setDueTime] = useState(ct.due_time || '');

  const [overdueNudge, setOverdueNudge] = useState(ct.overdue_nudge_interval_minutes ? String(ct.overdue_nudge_interval_minutes) : '');

  const [countsForLeaderboard, setCountsForLeaderboard] = useState(ct.counts_for_leaderboard ?? true);



  const kindKey = ct.has_schedule ? "scheduled" : ct.has_counter ? "counter" : "timer";



  const toggleDay = (day) => setWeekly((prev) => { const next = { ...prev }; if (next[day]) delete next[day]; else next[day] = "15:00"; return next; });

  const updateDayTime = (day, time) => setWeekly((prev) => ({ ...prev, [day]: time }));



  function save(e) {

    e.preventDefault();

    onSave(async () => {

      const { error: e1 } = await supabase.rpc("update_chore_details", { p_chore_type_id: ct.id, p_name: name, p_icon: icon });

      if (e1) throw e1;



      const { ids, qtys } = resourceMapToArrays(resourceMap);

      const { error: e2 } = await supabase.rpc("update_chore_resources", { p_chore_type_id: ct.id, p_resource_ids: ids, p_qtys: qtys });

      if (e2) throw e2;



      if (kindKey === "scheduled") {

        if (people.length === 0) throw new Error(t("Assign at least one person."));

        const advSched = scheduleType === "weekly" ? weekly : null;

        const { error } = await supabase.rpc("update_chore_schedule", {

          p_chore_type_id: ct.id,

          p_interval_days: scheduleType === "interval" ? Number(intervalDays) : 1,

          p_user_ids: people,

          p_requires_photo: requiresPhoto,

          p_advanced_schedule: advSched,

          p_is_rotational: isRotational,

          p_is_delayable: isDelayable,

          p_max_consecutive_delays: isDelayable ? Number(maxDelays) : null,

          p_coin_reward: selfAssignmentBlocksCoins(people) ? 0 : (canSetCoins ? Number(coinReward) : null),

          p_requires_approval: requiresApproval,

          p_due_time: dueTime || null,

          p_overdue_nudge_interval_minutes: overdueNudge ? Number(overdueNudge) : null,

          p_counts_for_leaderboard: countsForLeaderboard,
          p_start_date: startDate || null,

        });

        if (error) throw error;

      } else if (kindKey === "counter") {

        const { error: te } = await supabase.rpc("update_counter_threshold", { p_chore_type_id: ct.id, p_threshold: Number(threshold) });

        if (te) throw te;

        const { error: pe } = await supabase.from("chore_types").update({ requires_photo: requiresPhoto, counts_for_leaderboard: countsForLeaderboard }).eq("id", ct.id);

        if (pe) throw pe;

      } else {

        const { error: pe } = await supabase.from("chore_types").update({ requires_photo: requiresPhoto, counts_for_leaderboard: countsForLeaderboard }).eq("id", ct.id);

        if (pe) throw pe;

      }

    }, t("Saved."));

  }



  if (confirmDelete) return <div className="app-card app-radius p-3"><DeleteConfirm label={`"${ct.name}"`} busy={busy} onConfirm={onConfirmDelete} onCancel={onCancelDelete} /></div>;



  if (!editing) {

    const subtitle = kindKey === "scheduled" ? (ct.advanced_schedule ? t("Weekly schedule") : t("Every {{count}} day(s)", { count: ct.schedule_interval_days })) : kindKey === "counter" ? t("Triggers at {{count}}", { count: ct.counter_threshold }) : t("Timer / cycle");

    return <div className="app-card app-radius p-3"><CardHeader ct={ct} subtitle={subtitle} onEdit={onEdit} onAskDelete={onAskDelete} /></div>;

  }



  return (

    <div className="app-card app-radius p-4">

      <form onSubmit={save} className="flex flex-col gap-4">

        <div className="flex items-center justify-between">

          <span className="text-sm font-semibold app-muted">{t("Edit {{kind}}", { kind: t(KIND_LABEL[kindKey]) })}</span>

          <button type="button" className="app-btn app-card p-1.5" onClick={onCancelEdit}><X size={14} /></button>

        </div>



        <div><label className="text-xs font-medium app-muted">{t("Name")}</label><input className="app-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required /></div>

        <div><label className="text-xs font-medium app-muted">{t("Icon")}</label><div className="mt-1"><IconPicker value={icon} onChange={setIcon} groupId={ct.group_id} /></div></div>



        {kindKey === "scheduled" && (

          <>

            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Schedule Settings")}</label>

              <div className="flex gap-2 mb-3">

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${scheduleType === 'interval' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setScheduleType('interval')}>{t("Every X Days")}</button>

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${scheduleType === 'weekly' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setScheduleType('weekly')}>{t("Specific Days & Times")}</button>

              </div>

              {scheduleType === "interval" ? (

                <div className="flex items-center gap-2 mb-2">

                  <span className="text-sm">{t("Interval (Days):")}</span><input className="app-input w-20" type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />

                </div>

              ) : (

                <div className="flex flex-col gap-2 mb-2">

                  {DAYS.map(day => (

                    <div key={day.k} className="flex items-center gap-3">

                      <button type="button" className={`app-btn px-3 py-1 text-sm ${weekly[day.k] !== undefined ? 'app-accent-bg' : 'app-card'}`} onClick={() => toggleDay(day.k)}>{t(day.l)}</button>

                      {weekly[day.k] !== undefined && <input className="app-input w-24 text-sm" value={weekly[day.k]} onChange={(e) => updateDayTime(day.k, e.target.value)} placeholder={t("HH:MM")} />}

                    </div>

                  ))}

                </div>

              )}

            </div>

            

            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Assignment")}</label>

              <div className="flex gap-2 mb-3">

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${isRotational ? 'app-accent-bg' : 'app-card'}`} onClick={() => { setIsRotational(true); setPeople([]); }}>{t("Rotational (Take Turns)")}</button>

                <button type="button" className={`app-btn px-3 py-1.5 text-sm ${!isRotational ? 'app-accent-bg' : 'app-card'}`} onClick={() => { setIsRotational(false); setPeople([]); }}>{t("Shared (Everyone)")}</button>

              </div>

              {isRotational ? (

                <div>

                  <div className="flex flex-wrap gap-2 mb-3">

                    {roster.map(r => (

                      <button key={r.user_id} type="button" className="app-btn app-card px-2 py-1 text-sm" onClick={() => setPeople(prev => [...prev, r.user_id])}>{t("+ {{name}}", { name: r.display_name })}</button>

                    ))}

                  </div>

                  <div className="flex flex-col gap-1">

                    {people.map((id, index) => {

                      const p = roster.find(r => r.user_id === id);

                      return (

                        <div key={`${id}-${index}`} className="flex justify-between items-center text-sm p-2 app-card app-radius">

                          <span>{index + 1}. {p?.display_name || t('Unknown')}</span>

                          <button type="button" className="text-red-500 text-xs" onClick={() => setPeople(prev => prev.filter((_, i) => i !== index))}>{t("Remove")}</button>

                        </div>

                      );

                    })}

                  </div>

                </div>

              ) : (

                <PeoplePicker roster={roster} selected={people} onChange={setPeople} />

              )}

            </div>



            <div>

              <label className="text-xs font-medium app-muted block mb-2">{t("Delay Settings")}</label>

              <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={isDelayable} onChange={(e) => setIsDelayable(e.target.checked)} /> {t("Can be delayed")}</label>

              {isDelayable && (

                <div className="flex items-center gap-2"><span className="text-sm">{t("Max delays:")}</span><input className="app-input w-20" type="number" min="0" value={maxDelays} onChange={(e) => setMaxDelays(e.target.value)} /></div>

              )}

            </div>



            <div className="flex flex-col gap-3">

              <label className="text-xs font-medium app-muted">{t("Rewards & Timing")}</label>

              {rewardsEnabled && canSetCoins && !selfAssignmentBlocksCoins(people) ? (

                <div className="flex items-center gap-2">

                  <span className="text-sm">{t("Coin reward:")}</span>

                  <input className="app-input w-20" type="number" min="0" max={maxCoins || undefined} value={coinReward} onChange={e => setCoinReward(e.target.value)} />

                </div>

              ) : (

                <p className="text-xs app-muted">

                  {!rewardsEnabled

                    ? t("Coin rewards are off. Turn on \"Rewards & Coins\" in Settings to assign coins to this chore.")

                    : !canSetCoins

                    ? t("Only admins can set coin rewards on chores in this household.")

                    : t("This chore is now assigned only to you, and this household doesn't allow self-assigned coins — saving will clear its coin reward. Add another person to keep it.")}

                  {" "}{ct.coin_reward > 0 ? (selfAssignmentBlocksCoins(people) ? t("(Currently {{count}}.)", { count: ct.coin_reward }) : t("(Currently {{count}}, unchanged.)", { count: ct.coin_reward })) : ''}

                </p>

              )}

              <label className="flex items-center gap-2 text-sm">

                <input type="checkbox" checked={requiresApproval} onChange={e => setRequiresApproval(e.target.checked)} /> {t("Requires admin approval")}

              </label>

              <div className="flex items-center gap-2">

                <span className="text-sm">{t("Due time (HH:MM):")}</span>

                <input type="time" className="app-input w-28" value={dueTime} onChange={e => setDueTime(e.target.value)} />

              </div>

              <div className="flex items-center gap-2">

                <span className="text-sm">{t("Overdue nudge (min):")}</span>

                <input className="app-input w-20" type="number" min="0" placeholder="30" value={overdueNudge} onChange={e => setOverdueNudge(e.target.value)} />

              </div>

            </div>

          </>

        )}



        {kindKey === "counter" && (

          <div><label className="text-xs font-medium app-muted block mb-1">{t("Trigger count")}</label><input className="app-input w-full" type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>

        )}



        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresPhoto} onChange={(e) => setRequiresPhoto(e.target.checked)} /> {t("Require a photo")}</label>



        <div>

          <label className="flex items-center gap-2 text-sm">

            <input type="checkbox" checked={countsForLeaderboard} onChange={(e) => setCountsForLeaderboard(e.target.checked)} />

            {t("Counts toward the leaderboard")}

          </label>

          <p className="text-xs app-muted mt-1">{t("Leaderboard totals are recalculated live, so this applies to past completions too, not just future ones.")}</p>

        </div>



        <ResourceUsageEditor resources={resources} value={resourceMap} onChange={setResourceMap} />



        <ErrorBanner error={error} onClose={() => {}} />

        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy || (kindKey === "scheduled" && people.length === 0)} type="submit">{busy ? t("Saving…") : t("Save changes")}</button>

      </form>

    </div>

  );

}



function OnetimeTaskCard({ event, roster, editing, confirmDelete, busy, error, onEdit, onCancelEdit, onSave, onAskDelete, onCancelDelete, onConfirmDelete }) {

  const { t } = useTranslation();

  const ct = event.chore_types;

  const [name, setName] = useState(ct.name);

  const [icon, setIcon] = useState(ct.icon || "??");

  const [requiresPhoto, setRequiresPhoto] = useState(ct.requires_photo || false);

  
  const [startDate, setStartDate] = useState('');
  const [isTimer, setIsTimer] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(60);
  const [dueTimeOnetime, setDueTimeOnetime] = useState('');
  const [dueDate, setDueDate] = useState(event.date);

  const [people, setPeople] = useState(() => (event.chore_event_assignees || []).map((a) => a.user_id));

  const [countsForLeaderboard, setCountsForLeaderboard] = useState(ct.counts_for_leaderboard ?? true);



  function save(e) {

    e.preventDefault();

    onSave(async () => {

      const { error: e1 } = await supabase.rpc("update_chore_details", { p_chore_type_id: ct.id, p_name: name, p_icon: icon });

      if (e1) throw e1;

      const { error: e2 } = await supabase.from("chore_types").update({ requires_photo: requiresPhoto }).eq("id", ct.id);

      if (e2) throw e2;

      const { error: e3 } = await supabase.rpc("update_onetime_task", { p_event_id: event.id, p_assignee_ids: people, p_due_date: dueDate, p_counts_for_leaderboard: countsForLeaderboard });

      if (e3) throw e3;

    }, t("Saved."));

  }



  if (confirmDelete) return <div className="app-card app-radius p-3"><DeleteConfirm label={`"${ct.name}"`} busy={busy} onConfirm={onConfirmDelete} onCancel={onCancelDelete} /></div>;



  if (!editing) {

    const names = (event.chore_event_assignees || []).length;

    const subtitle = names > 1 ? t("due {{date}} · offered to {{count}} people", { date: event.date, count: names }) : t("due {{date}}", { date: event.date });

    return <div className="app-card app-radius p-3"><CardHeader ct={ct} subtitle={subtitle} onEdit={onEdit} onAskDelete={onAskDelete} /></div>;

  }



  return (

    <div className="app-card app-radius p-4">

      <form onSubmit={save} className="flex flex-col gap-4">

        <div className="flex items-center justify-between"><span className="text-sm font-semibold app-muted">{t(KIND_LABEL.onetime)}</span><button type="button" className="app-btn app-card p-1.5" onClick={onCancelEdit}><X size={14} /></button></div>

        <div><label className="text-xs font-medium app-muted">{t("Name")}</label><input className="app-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required /></div>

        <div><label className="text-xs font-medium app-muted">{t("Icon")}</label><div className="mt-1"><IconPicker value={icon} onChange={setIcon} groupId={ct.group_id} /></div></div>

        <div><label className="text-xs font-medium app-muted">{t("Due date")}</label><input className="app-input mt-1 w-full" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>

        <div><label className="text-xs font-medium app-muted">{t("Assign to")}</label><div className="mt-1"><PeoplePicker roster={roster} selected={people} onChange={setPeople} /></div></div>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresPhoto} onChange={(e) => setRequiresPhoto(e.target.checked)} /> {t("Require a photo")}</label>

        <div>

          <label className="flex items-center gap-2 text-sm">

            <input type="checkbox" checked={countsForLeaderboard} onChange={(e) => setCountsForLeaderboard(e.target.checked)} />

            {t("Counts toward the leaderboard")}

          </label>

        </div>

        <ErrorBanner error={error} onClose={() => {}} />

        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy || people.length === 0} type="submit">{busy ? t("Saving…") : t("Save changes")}</button>

      </form>

    </div>

  );

}

function PresetsTab({ groupId, roster, rewardsEnabled, maxCoins, currentMembership, user }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [reqPhoto, setReqPhoto] = useState(false);
  const [reward, setReward] = useState("0");
  const [hasTimer, setHasTimer] = useState(false);
  const [timerMins, setTimerMins] = useState("60");
  const [countsForLb, setCountsForLb] = useState(true);
  const [assignees, setAssignees] = useState([]);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true); setError("");
    const { data, error: err } = await supabase.from("chore_presets").select("*").eq("group_id", groupId).order("name");
    if (err) setError(err.message);
    else setPresets(data || []);
    setLoading(false);
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setName(""); setIcon(""); setReqPhoto(false); setReward("0");
    setHasTimer(false); setTimerMins("60"); setCountsForLb(true);
    setEditingId("new");
  };

  const startEdit = (p) => {
    setName(p.name || ""); setIcon(p.icon || ""); setReqPhoto(!!p.requires_photo);
    setReward(String(p.coin_reward ?? 0)); setHasTimer(!!p.has_timer);
    setTimerMins(String(p.default_timer_minutes ?? 60)); setCountsForLb(p.counts_for_leaderboard ?? true);
    setEditingId(p.id);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!groupId || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const args = {
        p_name: name.trim(), p_icon: icon.trim(),
        p_requires_photo: reqPhoto, p_coin_reward: Number(reward) || 0,
        p_counts_for_leaderboard: countsForLb, p_has_timer: hasTimer,
        p_default_timer_minutes: hasTimer ? (Number(timerMins) || 60) : null
      };
      if (editingId === "new") {
        const { error: err } = await supabase.rpc("create_preset", { ...args, p_group_id: groupId });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.rpc("update_preset", { ...args, p_preset_id: editingId });
        if (err) throw err;
      }
      setEditingId(null);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true); setError("");
    try {
      const { error: err } = await supabase.rpc("delete_preset", { p_preset_id: id });
      if (err) throw err;
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const instantiate = async () => {
    if (!assigningId) return;
    setBusy(true); setError("");
    try {
      const { error: err } = await supabase.rpc("instantiate_preset", {
        p_preset_id: assigningId,
        p_assignee_ids: assignees.length > 0 ? assignees : null,
        p_due_date: new Date().toISOString().slice(0, 10),
      });
      if (err) throw err;
      setAssigningId(null);
      setAssignees([]);
      window.alert(t("Task created successfully!"));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (editingId) {
    return (
      <form onSubmit={save} className="app-card app-radius p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold app-muted">{editingId === "new" ? t("New preset") : t("Edit preset")}</span>
          <button type="button" className="app-btn app-card p-1.5" onClick={() => setEditingId(null)}><X size={14} /></button>
        </div>
        <div>
          <label className="text-xs font-medium app-muted">{t("Name")}</label>
          <input className="app-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("e.g. Clean kitchen")} />
        </div>
        <div>
          <label className="text-xs font-medium app-muted">{t("Icon")}</label>
          <div className="mt-1"><IconPicker value={icon} onChange={setIcon} groupId={groupId} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reqPhoto} onChange={(e) => setReqPhoto(e.target.checked)} /> {t("Require a photo")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={countsForLb} onChange={(e) => setCountsForLb(e.target.checked)} /> {t("Counts toward the leaderboard")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasTimer} onChange={(e) => setHasTimer(e.target.checked)} /> {t("Starts on a timer (delayed start)")}</label>
        {hasTimer && (
          <div>
            <label className="text-xs font-medium app-muted">{t("Timer duration (minutes)")}</label>
            <input className="app-input mt-1 w-full" type="number" min="1" value={timerMins} onChange={(e) => setTimerMins(e.target.value)} />
          </div>
        )}
        {rewardsEnabled && (
          <div>
            <label className="text-xs font-medium app-muted">{t("Coin Reward")}</label>
            <input className="app-input mt-1 w-full" type="number" min="0" max={maxCoins || 100} value={reward} onChange={(e) => setReward(e.target.value)} />
          </div>
        )}
        <ErrorBanner error={error} onClose={() => setError("")} />
        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy || !name.trim()} type="submit">{busy ? t("Saving…") : t("Save")}</button>
      </form>
    );
  }

  if (assigningId) {
    const preset = presets.find(p => p.id === assigningId);
    return (
      <div className="app-card app-radius p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold app-muted">{t("Assign")} {preset?.name}</span>
          <button type="button" className="app-btn app-card p-1.5" onClick={() => setAssigningId(null)}><X size={14} /></button>
        </div>
        <div>
          <label className="text-xs font-medium app-muted">{t("Assign to")}</label>
          <div className="mt-1"><PeoplePicker roster={roster} selected={assignees} onChange={setAssignees} /></div>
          {assignees.length === 0 && <div className="text-xs app-muted mt-2">{t("Leave it this way and the chore stays unassigned — open for anyone to grab.")}</div>}
        </div>
        <ErrorBanner error={error} onClose={() => setError("")} />
        <button className="app-btn app-accent-bg py-2 mt-2" disabled={busy} onClick={instantiate}>{busy ? t("Working…") : t("Add")}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm app-muted">
        {t("Save chores you do often but don't have a fixed schedule for -- like clearing the dishwasher -- and quickly assign or add them again later, without re-typing everything.")}
      </div>
      <button className="app-btn app-card py-2.5 w-full flex justify-center items-center gap-2 font-semibold" onClick={startNew}>
        {t("+ New Preset")}
      </button>
      <ErrorBanner error={error} onClose={() => setError("")} />
      {loading ? (
        <div className="text-sm app-muted">{t("Loading...")}</div>
      ) : presets.length === 0 ? (
        <div className="text-sm app-muted italic">{t("No presets saved yet.")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map(p => (
            <div key={p.id} className="app-card app-radius p-3 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <IconGlyph icon={p.icon} fallback="✨" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{p.name}</div>
                  <div className="text-xs app-muted">
                    {p.has_timer ? t("Timer · {{minutes}} min", { minutes: p.default_timer_minutes }) : t("One-time")}
                    {p.coin_reward > 0 ? ` · ${p.coin_reward}🪙` : ""}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="app-btn app-accent-bg py-1.5 px-3 text-xs flex-1" disabled={busy} onClick={() => { setAssignees([]); setAssigningId(p.id); }}>{t("Add")}</button>
                <button className="app-btn app-card py-1.5 px-3 text-xs flex-1" disabled={busy} onClick={() => startEdit(p)}>{t("Edit")}</button>
                <button className="app-btn app-card py-1.5 px-3 text-xs text-red-500" disabled={busy} onClick={() => remove(p.id)}>{t("Delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

