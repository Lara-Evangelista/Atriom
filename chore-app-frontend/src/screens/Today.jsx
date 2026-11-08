import React, { useCallback, useEffect, useState } from "react";
import { Check, Clock, ArrowLeftRight, Plus, Timer, Activity, X, Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

function isoToday() { return new Date().toISOString().slice(0, 10); }
import { supabase } from "../supabaseClient";
import { uploadChorePhoto } from "../lib/photos";
import { ErrorBanner, PhotoField, PhotoThumb, IconGlyph } from "../components/UI";
import { useCosmetics } from "../contexts/CosmeticsProvider";

function timeLeft(endsAtIso, t) {
  const ms = new Date(endsAtIso).getTime() - Date.now();
  if (ms <= 0) return t("any moment now");
  const mins = Math.round(ms / 60000);
  if (mins < 60) return t("{{count}} min left", { count: mins });
  return t("{{hours}}h {{mins}}m left", { hours: Math.floor(mins / 60), mins: mins % 60 });
}

export default function Today({ group, user, groupId, roster, onProposeTrade }) {
  const { t } = useTranslation();
  const { triggerEffect } = useCosmetics();
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const isAdmin = roster.find(r => r.user_id === user.id)?.role !== 'member';
  const [myTasks, setMyTasks] = useState([]); 
  const [unassignedTasks, setUnassignedTasks] = useState([]);
  const [runs, setRuns] = useState([]); 
  const [runAssignees, setRunAssignees] = useState({}); 
  const [choreTypes, setChoreTypes] = useState([]); 
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [, forceTick] = useState(0);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [filter, setFilter] = useState("today"); // 'today' | 'upcoming' | 'unassigned'

  const load = useCallback(async () => {
    if (!groupId || !user) return;
    setError("");
    try {
      const throughDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await supabase.rpc("ensure_all_events", { p_group_id: groupId, p_through_date: throughDate }).catch(() => {});

      const { data: allEventRows, error: e1 } = await supabase
        .from("chore_events")
        .select(
          "id, date, status, assigned_user_id, chore_type_id, group_id, consecutive_delays_count, chore_types(id,name,icon,requires_photo,has_schedule,is_delayable,max_consecutive_delays,is_rotational), chore_event_assignees(user_id)"
        )
        .eq("status", "pending")
        .eq("group_id", groupId);
      if (e1) throw e1;
      
      const sortedEvents = (allEventRows || [])
        .sort((a, b) => a.date.localeCompare(b.date));
      
      const myAssignees = sortedEvents.filter(e => e.chore_event_assignees?.some(a => a.user_id === user.id));
      setMyTasks(myAssignees);

      const unassigned = sortedEvents.filter(e => !e.chore_event_assignees || e.chore_event_assignees.length === 0);
      setUnassignedTasks(unassigned);

      const { data: runRows, error: e2 } = await supabase
        .from("chore_runs")
        .select("id, status, trigger_reason, cycle_ends_at, started_by, chore_type_id, chore_types(name, icon)")
        .eq("group_id", groupId)
        .in("status", ["pending", "running"])
        .order("started_at", { ascending: true });
      if (e2) throw e2;
      setRuns(runRows || []);

      const runIds = (runRows || []).filter((r) => r.status === "running").map((r) => r.id);
      const { data: raRows2 } = await supabase
        .from("chore_run_assignees")
        .select("chore_run_id, user_id")
        .in("chore_run_id", runIds.length ? runIds : ["00000000-0000-0000-0000-000000000000"]);
      const map = {};
      (raRows2 || []).forEach((r) => {
        map[r.chore_run_id] = map[r.chore_run_id] || [];
        map[r.chore_run_id].push(r.user_id);
      });
      setRunAssignees(map);

      const { data: ctRows, error: e3 } = await supabase
        .from("chore_types")
        .select("*")
        .eq("group_id", groupId)
        .eq("archived", false);
      if (e3) throw e3;
      setChoreTypes(ctRows || []);

      const { data: actRows } = await supabase
        .from("activity_log")
        .select("id, text, type, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(15);
      setActivity(actRows || []);
      
      if (isAdmin) {
        const { data: pAppr } = await supabase
          .from('chore_event_completions')
          .select('event_id, approval_status, chore_events!inner(id, photo_url, done_at, chore_types(name, icon))')
          .eq('approval_status', 'pending')
          .eq('chore_events.group_id', groupId);
        setPendingApprovals(pAppr || []);
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [groupId, user]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`today-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_events", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_runs", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_types", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `group_id=eq.${groupId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load, groupId]);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const nameFor = (uid) => roster.find((m) => m.user_id === uid)?.display_name || t("Someone");

  async function completeEvent(ev, photoPath, creditedUserIds) {
    setBusyId(ev.id);
    setError("");
    try {
      const fn = ev.chore_types?.has_schedule ? "complete_chore_event" : "complete_onetime_task";
      
      const rpcArgs = { p_event_id: ev.id, p_photo_url: photoPath || null };
      if (creditedUserIds && creditedUserIds.length > 0) {
        rpcArgs.p_credited_user_ids = creditedUserIds;
      }

      const { error } = await supabase.rpc(fn, rpcArgs);
      if (error) throw error;
      
      setSelectedEvent(null);
      triggerEffect();
      await load();

      // Fire-and-forget push notification
      if (creditedUserIds && creditedUserIds.length > 0) {
        supabase.functions.invoke('notify-completion', {
          body: { eventId: ev.id, creditedUserIds }
        }).catch(console.warn);
      }
      
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function delayEvent(ev, days) {
    setBusyId(ev.id);
    try {
      const { error } = await supabase.rpc("delay_chore_event", { p_event_id: ev.id, p_days: days });
      if (error) throw error;
      setSelectedEvent(null);
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function completeRun(run) {
    setBusyId(run.id);
    setError("");
    try {
      const { error } = await supabase.rpc("complete_chore_run", { p_run_id: run.id });
      if (error) throw error;
      triggerEffect();
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function bumpCounter(ct) {
    setBusyId(ct.id);
    setError("");
    try {
      const { error } = await supabase.rpc("increment_counter", { p_chore_type_id: ct.id, p_amount: 1 });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function startTimer(ct) {
    const mins = window.prompt(t('Start "{{name}}" — cycle length in minutes?', { name: ct.name }), "60");
    if (!mins) return;
    setBusyId(ct.id);
    setError("");
    try {
      const { error } = await supabase.rpc("start_timer", {
        p_chore_type_id: ct.id,
        p_cycle_minutes: parseInt(mins, 10),
        p_assignee_ids: null,
      });
      if (error) throw error;
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function nudgeAssignee(ev) {
    const assignees = ev.chore_event_assignees || [];
    const others = assignees.map(a => a.user_id).filter(id => id !== user.id);
    if (others.length === 0) return;
    setBusyId(ev.id);
    setError("");
    try {
      const { error: rpcErr } = await supabase.rpc('nudge_assignee', { p_event_id: ev.id, p_nudgee_id: others[0] });
      if (rpcErr) throw rpcErr;
      supabase.functions.invoke('notify-nudge', { body: { eventId: ev.id, nudgeeId: others[0] } }).catch(console.warn);
      alert(t("Nudged! They'll get a notification shortly."));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  const today = isoToday();
  const filtered = filter === "today" ? myTasks.filter(t => t.date <= today) : filter === "upcoming" ? myTasks.filter(t => t.date > today) : [];
  const myTurns = filtered.filter((t) => t.chore_types?.has_schedule);
  const myOneTime = filtered.filter((t) => !t.chore_types?.has_schedule);
  const openRuns = runs.filter((r) => r.status === "pending");
  const runningRuns = runs.filter((r) => r.status === "running");
  const counterTypes = choreTypes.filter((c) => c.has_counter);
  const timerTypes = choreTypes.filter((c) => c.has_timer);

  return (
    <div className="flex flex-col gap-6 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />

      <div className="flex gap-2">
        <button className={`app-btn px-4 py-1.5 text-sm ${filter === 'today' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setFilter('today')}>{t("Today & Overdue")}</button>
        <button className={`app-btn px-4 py-1.5 text-sm ${filter === 'upcoming' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setFilter('upcoming')}>{t("Upcoming")}</button>
        <button className={`app-btn px-4 py-1.5 text-sm ${filter === 'unassigned' ? 'app-accent-bg' : 'app-card'}`} onClick={() => setFilter('unassigned')}>{t("Unassigned")}</button>
      </div>

      {filter === 'unassigned' ? (
        <Section title={t("Unassigned")} empty={unassignedTasks.length === 0} emptyText={t("No unassigned tasks right now.")} caption={unassignedTasks.length > 0 ? t("Open for anyone to grab") : undefined}>
          {unassignedTasks.map((ev) => (
            <TaskRow
              key={ev.id}
              ev={ev}
              busy={busyId === ev.id}
              onClick={() => setSelectedEvent(ev)}
            />
          ))}
        </Section>
      ) : (
        <>
          <Section title={t("Your turns today")} empty={myTurns.length === 0} emptyText={t("Nothing on your rotation right now.")}>
            {myTurns.map((ev) => (
              <TaskRow
                key={ev.id}
                ev={ev}
                busy={busyId === ev.id}
                onClick={() => setSelectedEvent(ev)}
                onTrade={() => onProposeTrade(ev)}
              />
            ))}
          </Section>

          <Section title={t("One-time tasks for you")} empty={myOneTime.length === 0} emptyText={t("No one-off tasks waiting on you.")}>
            {myOneTime.map((ev) => (
              <TaskRow
                key={ev.id}
                ev={ev}
                busy={busyId === ev.id}
                onClick={() => setSelectedEvent(ev)}
              />
            ))}
          </Section>

          {unassignedTasks.length > 0 && (
            <Section title={t("Unassigned")} empty={false} caption={t("Open for anyone to grab")}>
              {unassignedTasks.map((ev) => (
                <TaskRow
                  key={ev.id}
                  ev={ev}
                  busy={busyId === ev.id}
                  onClick={() => setSelectedEvent(ev)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      <Section title={t("Up for grabs")} empty={openRuns.length === 0} emptyText={t("Nothing hit its limit yet.")}>
        {openRuns.map((r) => (
          <div key={r.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-lg app-emoji"><IconGlyph icon={r.chore_types?.icon} fallback="📦" /></span>
              <div>
                <div className="text-sm font-medium">{r.chore_types?.name}</div>
                <div className="text-xs app-muted">{t("Hit its limit — first to grab it wins the point.")}</div>
              </div>
            </div>
            <button className="app-btn app-accent-bg px-3 py-1.5 text-sm" disabled={busyId === r.id} onClick={() => completeRun(r)}>
              <Check size={14} className="inline mr-1" /> {t("Done")}
            </button>
          </div>
        ))}
      </Section>

      <Section title={t("Cycles running")} empty={runningRuns.length === 0} emptyText={t("Nothing's running right now.")}>
        {runningRuns.map((r) => (
          <div key={r.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-lg app-emoji"><IconGlyph icon={r.chore_types?.icon} fallback="⏱️" /></span>
              <div>
                <div className="text-sm font-medium">{r.chore_types?.name}</div>
                <div className="text-xs app-muted">
                  {(runAssignees[r.id] || []).map(nameFor).join(", ") || t("no one")} · {timeLeft(r.cycle_ends_at, t)}
                </div>
              </div>
            </div>
            <button className="app-btn app-card px-3 py-1.5 text-sm" disabled={busyId === r.id} onClick={() => completeRun(r)}>
              {t("Finish now")}
            </button>
          </div>
        ))}
      </Section>

      {(counterTypes.length > 0 || timerTypes.length > 0) && (
        <Section title={t("Quick actions")}>
          <div className="flex flex-col gap-2">
            {counterTypes.map((ct) => (
              <div key={ct.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg app-emoji"><IconGlyph icon={ct.icon} fallback="🔢" /></span>
                  <div>
                    <div className="text-sm font-medium">{ct.name}</div>
                    <div className="text-xs app-muted">
                      {ct.counter_current} / {ct.counter_threshold}
                    </div>
                  </div>
                </div>
                <button className="app-btn app-card px-3 py-1.5 text-sm" disabled={busyId === ct.id} onClick={() => bumpCounter(ct)}>
                  <Plus size={14} className="inline mr-1" /> {t("Add one")}
                </button>
              </div>
            ))}
            {timerTypes.map((ct) => (
              <div key={ct.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg app-emoji"><IconGlyph icon={ct.icon} fallback="⏱️" /></span>
                  <div className="text-sm font-medium">{ct.name}</div>
                </div>
                <button className="app-btn app-card px-3 py-1.5 text-sm" disabled={busyId === ct.id} onClick={() => startTimer(ct)}>
                  <Timer size={14} className="inline mr-1" /> {t("Start")}
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={t("Recent activity")} icon={<Activity size={15} />} empty={activity.length === 0} emptyText={t("Nothing yet.")}>
        <div className="flex flex-col gap-1.5">
          {activity.map((a) => (
            <div key={a.id} className="text-xs app-muted flex justify-between gap-3">
              <span>{a.text}</span>
              <span className="whitespace-nowrap">{new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
          ))}
        </div>
      </Section>

      {selectedEvent && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[var(--bg)] w-full max-w-sm app-radius overflow-hidden shadow-2xl relative flex flex-col max-h-full">
            <button className="absolute top-3 right-3 app-btn p-1.5" onClick={() => setSelectedEvent(null)}>
              <X size={16} />
            </button>
            <ChoreDetailView
              event={selectedEvent}
              roster={roster}
              user={user}
              groupId={groupId}
              busy={busyId === selectedEvent.id}
              onComplete={(photo, credited) => completeEvent(selectedEvent, photo, credited)}
              onNudge={() => nudgeAssignee(selectedEvent)}
              onDelay={(days) => delayEvent(selectedEvent, days)}
              onClose={() => setSelectedEvent(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, empty, emptyText, icon, caption }) {
  return (
    <div>
      <h3 className="text-sm font-semibold app-muted mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {caption && <div className="text-xs app-muted mb-2">{caption}</div>}
      {empty ? <div className="text-sm app-muted app-card app-radius p-3">{emptyText}</div> : <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function TaskRow({ ev, busy, onClick, onTrade }) {
  const { t } = useTranslation();
  const ct = ev.chore_types || {};
  return (
    <div className="app-card app-radius p-3 flex items-center justify-between gap-3 cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all" onClick={onClick}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-lg app-emoji shrink-0"><IconGlyph icon={ct.icon} fallback="📋" /></span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{ct.name}</div>
          <div className="text-xs app-muted">
            {new Date(ev.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            {ev.consecutive_delays_count > 0 && ` · ${t("Delayed {{count}}x", { count: ev.consecutive_delays_count })}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
        {onTrade && (
          <button className="app-btn app-card p-1.5" title={t("Propose a swap")} onClick={onTrade}>
            <ArrowLeftRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function ChoreDetailView({ event, roster, user, groupId, busy, onComplete, onDelay, onNudge, onClose }) {
  const { t } = useTranslation();
  const ct = event.chore_types || {};
  const assignees = event.chore_event_assignees || [];
  const isMultiAssignee = !ct.is_rotational && assignees.length > 1;

  const [creditedUsers, setCreditedUsers] = useState(() => {
    if (isMultiAssignee) return assignees.map(a => a.user_id);
    return [user.id];
  });

  const [delayDays, setDelayDays] = useState("1");
  const canDelay = ct.is_delayable && (ct.max_consecutive_delays === null || event.consecutive_delays_count < ct.max_consecutive_delays);

  const toggleUser = (id) => {
    setCreditedUsers(prev => prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]);
  };

  const handleDone = async () => {
    if (ct.requires_photo) {
      // Create a hidden file input to trigger photo upload
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const path = await uploadChorePhoto(groupId, event.id, file);
          onComplete(path, isMultiAssignee ? creditedUsers : [user.id]);
        } catch (err) {
          alert(t("Error uploading photo: {{message}}", { message: err.message }));
        }
      };
      input.click();
    } else {
      onComplete(null, isMultiAssignee ? creditedUsers : [user.id]);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 app-card app-radius flex items-center justify-center text-2xl app-emoji">
          <IconGlyph icon={ct.icon} fallback="📋" size={32} />
        </div>
        <div>
          <h2 className="font-semibold text-lg">{ct.name}</h2>
          <div className="text-xs app-muted">
            {t("Due {{date}}", { date: new Date(event.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) })}
          </div>
        </div>
      </div>

      {isMultiAssignee && (
        <div className="app-card app-radius p-3">
          <div className="text-xs font-semibold app-muted mb-2">{t("Who did this?")}</div>
          <div className="flex flex-col gap-2">
            {assignees.map(a => {
              const m = roster.find(r => r.user_id === a.user_id);
              const isChecked = creditedUsers.includes(a.user_id);
              return (
                <label key={a.user_id} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isChecked} onChange={() => toggleUser(a.user_id)} />
                  <span className="text-sm">{m?.display_name || t('Unknown')} {a.user_id === user.id ? t('(You)') : ''}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {ct.is_delayable && (
        <div className="app-card app-radius p-3">
          <div className="text-xs font-semibold app-muted mb-2">{t("Delay")}</div>
          {!canDelay ? (
            <div className="text-sm text-red-400">{t("Max delays reached ({{max}}). Must complete!", { max: ct.max_consecutive_delays })}</div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="number" min="1" className="app-input w-16" value={delayDays} onChange={e => setDelayDays(e.target.value)} />
              <span className="text-sm">{t("Days")}</span>
              <button 
                className="app-btn app-card px-3 py-1.5 ml-auto text-sm" 
                disabled={busy} 
                onClick={() => onDelay(parseInt(delayDays, 10))}
              >
                {t("Push Back")}
              </button>
            </div>
          )}
        </div>
      )}

      <button className="app-btn app-accent-bg py-3 font-semibold mt-2" disabled={busy || (isMultiAssignee && creditedUsers.length === 0)} onClick={handleDone}>
        {busy ? t("Working...") : ct.requires_photo ? t("Take Photo & Mark Done") : t("Mark Done")}
      </button>

      {assignees.length > 0 && assignees.some(a => a.user_id !== user.id) && (
        <button className="app-btn app-card py-2.5 flex items-center justify-center gap-2 text-sm" disabled={busy} onClick={onNudge}>
          <Bell size={14} /> {t("Nudge Assignee 👋")}
        </button>
      )}
    </div>
  );
}

