-- Migration 022: Personal Habits + Stock/Resource Tags
--
-- Two independent features bundled in one migration:
--
-- 1. HABITS — unlike chores, habits are personal and NOT scoped to a group.
--    A user doesn't need to have created or joined a group to have habits;
--    they're tied only to auth.users(id), the same way push_tokens /
--    expo_push_tokens already work. This is the first "global, no group
--    needed" user data this app has, so it also introduces `user_settings`,
--    a one-row-per-user table for cross-group personal preferences
--    (currently just habit-related, but the natural home for anything else
--    personal that shouldn't live on a per-group `memberships` row).
--
--    Design decisions worth calling out:
--    - A habit's weekly target is mutable and "live": changing it changes
--      what's required for the CURRENT week immediately (already-logged
--      completions this week are never lost). Past, already-scored weeks
--      are evaluated against the habit's target at the time this function
--      runs, not a frozen snapshot — this is a deliberate simplification;
--      if you later want past weeks to be immune to a target change made
--      today, that needs a `target_snapshot` column on a per-week table,
--      which this migration intentionally leaves out to keep things simple.
--    - Streak counts up the moment a week's target is met — it does not
--      wait for the week to roll over. The in-progress current week is the
--      only one allowed to be "not met yet" without breaking the streak
--      (same idea as a daily streak not breaking just because today hasn't
--      been done yet).
--    - "Once a day" is enforced by a unique constraint AND doubles as the
--      undo mechanism: toggle_habit_today() inserts a completion if one
--      doesn't exist for today, or deletes it if it does.
--    - Notification scheduling needs per-user local time. Since nothing in
--      this app stores a timezone today (the existing daily-check cron is
--      a single fixed UTC time for the whole household — see backend
--      README), user_settings.timezone stores an IANA zone name
--      (e.g. "Europe/Lisbon") that the client refreshes silently on each
--      app open via touch_my_timezone(). This is what lets "notify me at
--      8pm" mean 8pm wherever the person actually is, and keeps working
--      across DST changes, without the user ever seeing or thinking about
--      it — they just pick an hour.
--    - Notifications are fully manual, per-habit, no global mode: there is
--      no automatic "you're falling behind pace" system nudge anymore.
--      Each habit optionally has its own set of reminder day/hour slots
--      (habit_reminders); if none are set, that habit simply never
--      notifies. `user_settings` therefore only holds week_end_day now —
--      the earlier `habit_notification_mode` global switch was removed
--      once notifications became fully per-habit.
--    - A scheduled reminder is suppressed once a weekly habit's target for
--      the current week has already been met — see
--      get_due_habit_reminders() below. Daily habits have no such ceiling
--      (there's nothing to "finish early").
--    - Vacation mode: chores already pause per-membership (memberships
--      .is_paused), which is naturally group-scoped. Habits aren't
--      group-scoped at all, so there's no single membership row to check.
--      JUDGMENT CALL: a user's habit reminders are paused if they're
--      currently on vacation in *any* group they belong to (see
--      is_user_on_vacation() below) — i.e. telling one household you're
--      away also quiets your personal habit pings. This seemed like the
--      least-surprising default (you're "away", full stop) but is easy to
--      change to "paused in every group" or a dedicated personal toggle
--      if that's not what you want.
--
-- 2. TAGS — simple, group-scoped, optional many-to-many labels usable on
--    both `resources` (tracked inventory) and `stock_items` (the flagged
--    "we're out of X" list), independently of each other. Everything else
--    about Stock is untouched.

-- ============================================================
-- PART 1: HABITS
-- ============================================================

-- ------------------------------------------------------------
-- 1a. user_settings — personal, cross-group preferences
-- ------------------------------------------------------------
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC',
  -- Day the user's habit week ends on. 0 = Sunday ... 6 = Saturday
  -- (matches Postgres extract(dow from ...) and JS Date#getDay()).
  week_end_day int not null default 0 check (week_end_day between 0 and 6),
  created_at timestamptz not null default now()
);

-- Habits aren't group-scoped, so there's no single membership row to read
-- "on vacation" off of. See the PART 1 header comment for the judgment
-- call this makes: paused in ANY group counts as on vacation for habits.
create or replace function is_user_on_vacation(p_user_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1 from memberships where user_id = p_user_id and is_paused = true
  );
$$;

alter table user_settings enable row level security;
drop policy if exists "own settings" on user_settings;
create policy "own settings" on user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Called on every app open (web/mobile) so scheduling always has a fresh
-- timezone, without the user ever setting it explicitly.
create or replace function touch_my_timezone(p_timezone text)
returns void
language plpgsql security definer
as $$
begin
  insert into user_settings (user_id, timezone)
  values (auth.uid(), coalesce(nullif(p_timezone, ''), 'UTC'))
  on conflict (user_id) do update
    set timezone = coalesce(nullif(p_timezone, ''), user_settings.timezone);
end;
$$;

-- Called from You → Habits settings. Notifications are no longer a global
-- mode — each habit sets its own reminder days/hours (see
-- set_habit_reminders) — so the only cross-habit personal setting left is
-- the week boundary.
create or replace function update_my_habit_settings(
  p_week_end_day int
)
returns void
language plpgsql security definer
as $$
begin
  insert into user_settings (user_id, week_end_day)
  values (auth.uid(), coalesce(p_week_end_day, 0))
  on conflict (user_id) do update
    set week_end_day = coalesce(p_week_end_day, user_settings.week_end_day);
end;
$$;

-- ------------------------------------------------------------
-- 1b. habits, habit_reminders, habit_completions
-- ------------------------------------------------------------
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  frequency text not null check (frequency in ('daily', 'weekly')),
  -- required for weekly, must be null for daily
  weekly_target int,
  notifications_enabled boolean not null default true,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint habits_weekly_target_matches_frequency check (
    (frequency = 'weekly' and weekly_target is not null and weekly_target >= 1)
    or (frequency = 'daily' and weekly_target is null)
  )
);

alter table habits enable row level security;
drop policy if exists "own habits" on habits;
create policy "own habits" on habits for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per reminder slot. day_of_week = null means "every day"
-- (the only option for daily habits; also usable for a weekly habit that
-- wants the same reminder every day regardless of which days it's done).
create table if not exists habit_reminders (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  day_of_week int check (day_of_week between 0 and 6),
  time_local time not null
);

alter table habit_reminders enable row level security;
drop policy if exists "own habit reminders" on habit_reminders;
create policy "own habit reminders" on habit_reminders for all
  using (exists (select 1 from habits h where h.id = habit_id and h.user_id = auth.uid()))
  with check (exists (select 1 from habits h where h.id = habit_id and h.user_id = auth.uid()));

create table if not exists habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_date date not null,
  created_at timestamptz not null default now(),
  unique (habit_id, completed_date)
);

alter table habit_completions enable row level security;
drop policy if exists "own habit completions" on habit_completions;
create policy "own habit completions" on habit_completions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists habit_completions_habit_date_idx
  on habit_completions (habit_id, completed_date desc);

-- ------------------------------------------------------------
-- 1c. Week-boundary helper
-- ------------------------------------------------------------
-- Given a date and the day the week ENDS on (0=Sun..6=Sat), returns the
-- date the containing week STARTS on.
create or replace function habit_week_start(p_date date, p_week_end_day int)
returns date
language sql immutable
as $$
  select p_date - ((((extract(dow from p_date)::int) - ((p_week_end_day + 1) % 7)) + 7) % 7);
$$;

-- ------------------------------------------------------------
-- 1d. CRUD RPCs
-- ------------------------------------------------------------
create or replace function create_habit(
  p_name text,
  p_icon text,
  p_frequency text,
  p_weekly_target int,
  p_notifications_enabled boolean default true
)
returns uuid
language plpgsql security definer
as $$
declare
  v_id uuid;
begin
  insert into habits (user_id, name, icon, frequency, weekly_target, notifications_enabled)
  values (
    auth.uid(), p_name, p_icon, p_frequency,
    case when p_frequency = 'weekly' then p_weekly_target else null end,
    coalesce(p_notifications_enabled, true)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Weekly target changes take effect immediately for the current week —
-- there's nothing here to "reconcile", since streak/progress are always
-- computed live off habit_completions + the habit's current target.
create or replace function update_habit(
  p_habit_id uuid,
  p_name text,
  p_icon text,
  p_weekly_target int,
  p_notifications_enabled boolean
)
returns void
language plpgsql security definer
as $$
begin
  update habits
  set name = coalesce(p_name, name),
      icon = coalesce(p_icon, icon),
      weekly_target = case when frequency = 'weekly' then coalesce(p_weekly_target, weekly_target) else null end,
      notifications_enabled = coalesce(p_notifications_enabled, notifications_enabled)
  where id = p_habit_id and user_id = auth.uid();
end;
$$;

create or replace function archive_habit(p_habit_id uuid, p_archived boolean)
returns void
language plpgsql security definer
as $$
begin
  update habits set archived = p_archived
  where id = p_habit_id and user_id = auth.uid();
end;
$$;

create or replace function delete_habit(p_habit_id uuid)
returns void
language plpgsql security definer
as $$
begin
  delete from habits where id = p_habit_id and user_id = auth.uid();
end;
$$;

-- Replaces the full reminder schedule for a habit in one call — simplest
-- contract for an edit screen that lets you set several day/hour slots
-- at once. Pass an empty array to clear all reminders for the habit.
create or replace function set_habit_reminders(p_habit_id uuid, p_reminders jsonb)
returns void
language plpgsql security definer
as $$
declare
  v_owner uuid;
  v_item jsonb;
begin
  select user_id into v_owner from habits where id = p_habit_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not your habit';
  end if;

  delete from habit_reminders where habit_id = p_habit_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb))
  loop
    insert into habit_reminders (habit_id, day_of_week, time_local)
    values (
      p_habit_id,
      case when v_item ? 'day_of_week' and v_item->>'day_of_week' is not null
           then (v_item->>'day_of_week')::int else null end,
      (v_item->>'time_local')::time
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 1e. Completion toggle (also serves as same-day undo)
-- ------------------------------------------------------------
create or replace function toggle_habit_today(p_habit_id uuid, p_local_date date)
returns boolean -- true if now completed, false if just un-done
language plpgsql security definer
as $$
declare
  v_owner uuid;
  v_existing uuid;
begin
  select user_id into v_owner from habits where id = p_habit_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not your habit';
  end if;

  select id into v_existing from habit_completions
  where habit_id = p_habit_id and completed_date = p_local_date;

  if v_existing is not null then
    delete from habit_completions where id = v_existing;
    return false;
  else
    insert into habit_completions (habit_id, user_id, completed_date)
    values (p_habit_id, auth.uid(), p_local_date);
    return true;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1f. Streak + current-week progress (read-side)
-- ------------------------------------------------------------
create or replace function compute_habit_streak(p_habit_id uuid)
returns int
language plpgsql stable
as $$
declare
  v_habit habits%rowtype;
  v_week_end int;
  v_streak int := 0;
  v_check_date date;
  v_week_start date;
  v_count int;
  v_first boolean := true;
  v_current_week_start date;
begin
  select * into v_habit from habits where id = p_habit_id;
  if not found then return 0; end if;

  select coalesce(week_end_day, 0) into v_week_end
  from user_settings where user_id = v_habit.user_id;
  v_week_end := coalesce(v_week_end, 0);

  if v_habit.frequency = 'daily' then
    v_check_date := current_date;
    loop
      if exists (select 1 from habit_completions where habit_id = p_habit_id and completed_date = v_check_date) then
        v_streak := v_streak + 1;
      elsif v_first then
        -- today not done yet doesn't break the streak
        null;
      else
        exit;
      end if;
      v_first := false;
      v_check_date := v_check_date - 1;
      exit when v_streak = 0 and v_check_date < current_date - 1000; -- safety valve
    end loop;
  else
    v_current_week_start := habit_week_start(current_date, v_week_end);
    v_week_start := v_current_week_start;
    loop
      select count(*) into v_count from habit_completions
      where habit_id = p_habit_id and completed_date between v_week_start and v_week_start + 6;

      if v_count >= v_habit.weekly_target then
        v_streak := v_streak + 1;
      elsif v_first then
        -- current week still in progress and not met yet: doesn't break it
        null;
      else
        exit;
      end if;
      v_first := false;
      v_week_start := v_week_start - 7;
      exit when v_week_start < v_current_week_start - interval '5 years';
    end loop;
  end if;

  return v_streak;
end;
$$;

-- Convenience view: everything the Habits tab needs per habit in one read
-- (current streak + this week's progress for weekly habits).
create or replace view habit_summaries as
select
  h.*,
  compute_habit_streak(h.id) as current_streak,
  case when h.frequency = 'weekly' then (
    select count(*)::int from habit_completions c
    where c.habit_id = h.id
      and c.completed_date between
        habit_week_start(current_date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0))
        and habit_week_start(current_date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0)) + 6
  ) else null end as this_week_count,
  exists (
    select 1 from habit_completions c where c.habit_id = h.id and c.completed_date = current_date
  ) as done_today
from habits h
where h.user_id = auth.uid();

-- History tab: completions in a date range (e.g. "last week/month/year").
create or replace function get_habit_history(p_habit_id uuid, p_from date, p_to date)
returns table (completed_date date)
language sql stable
as $$
  select completed_date from habit_completions
  where habit_id = p_habit_id
    and user_id = auth.uid()
    and completed_date between p_from and p_to
  order by completed_date desc;
$$;

alter publication supabase_realtime add table user_settings, habits, habit_reminders, habit_completions;

-- ------------------------------------------------------------
-- 1g. Reminder delivery (cron-habit-reminder edge function)
-- ------------------------------------------------------------
-- One row per reminder actually sent, so a cron tick that runs every few
-- minutes never double-fires the same slot on the same local day even if
-- the exact minute is missed and picked up on a later tick.
create table if not exists habit_reminder_log (
  reminder_id uuid not null references habit_reminders(id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (reminder_id, local_date)
);

alter table habit_reminder_log enable row level security;
-- No policies: this is written only by the service role (from the
-- cron-habit-reminder edge function), which bypasses RLS entirely. Users
-- never need to read or write it directly.

-- Called by the cron-habit-reminder edge function (service role, every
-- few minutes). Returns every reminder slot that is currently due:
--   - the habit isn't archived and has notifications enabled
--   - it's the right local day for this reminder (day_of_week matches,
--     or day_of_week is null meaning "every day")
--   - local time has passed time_local, within a lookback window (so a
--     missed tick doesn't fire hours late, and a cron running every N
--     minutes doesn't need to line up exactly on the minute)
--   - it hasn't already been sent today (habit_reminder_log)
--   - for weekly habits, this week's target hasn't already been met
--     (nothing left to do this week = suppress, don't nag)
--   - the user isn't on vacation (see is_user_on_vacation)
create or replace function get_due_habit_reminders(p_lookback_minutes int default 20)
returns table (
  reminder_id uuid,
  habit_id uuid,
  user_id uuid,
  habit_name text,
  habit_icon text,
  frequency text,
  local_date date
)
language sql stable
as $$
  select
    r.id as reminder_id,
    h.id as habit_id,
    h.user_id,
    h.name as habit_name,
    h.icon as habit_icon,
    h.frequency,
    ln.local_now::date as local_date
  from habit_reminders r
  join habits h on h.id = r.habit_id
  cross join lateral (
    select coalesce(us.timezone, 'UTC') as tz
    from user_settings us where us.user_id = h.user_id
  ) tzs
  cross join lateral (
    select (now() at time zone tzs.tz) as local_now
  ) ln
  where h.archived = false
    and h.notifications_enabled = true
    and (r.day_of_week is null or r.day_of_week = extract(dow from ln.local_now)::int)
    and r.time_local <= ln.local_now::time
    and r.time_local > (ln.local_now::time - make_interval(mins => p_lookback_minutes))
    and not exists (
      select 1 from habit_reminder_log l
      where l.reminder_id = r.id and l.local_date = ln.local_now::date
    )
    and not is_user_on_vacation(h.user_id)
    and (
      h.frequency = 'daily'
      or (
        select count(*) from habit_completions c
        where c.habit_id = h.id
          and c.completed_date between
            habit_week_start(ln.local_now::date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0))
            and habit_week_start(ln.local_now::date, coalesce((select week_end_day from user_settings where user_id = h.user_id), 0)) + 6
      ) < h.weekly_target
    );
$$;

-- Called by cron-habit-reminder right after a push actually goes out, so
-- the same slot doesn't fire again today.
create or replace function mark_habit_reminder_sent(p_reminder_id uuid, p_local_date date)
returns void
language sql
as $$
  insert into habit_reminder_log (reminder_id, local_date)
  values (p_reminder_id, p_local_date)
  on conflict (reminder_id, local_date) do nothing;
$$;

-- ============================================================
-- PART 2: TAGS (Stock tab — resources + stock_items)
-- ============================================================

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now()
);

-- Functional unique index (a plain table UNIQUE constraint can't take an
-- expression like lower(name) — same reason memberships uses this pattern
-- for display_name).
create unique index if not exists tags_unique_name_per_group
  on tags (group_id, lower(name));

alter table tags enable row level security;
drop policy if exists "members access tags" on tags;
create policy "members access tags" on tags for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

create table if not exists resource_tags (
  resource_id uuid not null references resources(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (resource_id, tag_id)
);

alter table resource_tags enable row level security;
drop policy if exists "members access resource_tags" on resource_tags;
create policy "members access resource_tags" on resource_tags for all
  using (exists (select 1 from resources r where r.id = resource_id and is_group_member(r.group_id)))
  with check (exists (select 1 from resources r where r.id = resource_id and is_group_member(r.group_id)));

create table if not exists stock_item_tags (
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (stock_item_id, tag_id)
);

alter table stock_item_tags enable row level security;
drop policy if exists "members access stock_item_tags" on stock_item_tags;
create policy "members access stock_item_tags" on stock_item_tags for all
  using (exists (select 1 from stock_items s where s.id = stock_item_id and is_group_member(s.group_id)))
  with check (exists (select 1 from stock_items s where s.id = stock_item_id and is_group_member(s.group_id)));

create or replace function create_tag(p_group_id uuid, p_name text, p_color text default null)
returns uuid
language plpgsql security definer
as $$
declare
  v_id uuid;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of this group';
  end if;

  insert into tags (group_id, name, color)
  values (p_group_id, trim(p_name), p_color)
  on conflict (group_id, lower(name)) do update set color = coalesce(excluded.color, tags.color)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function delete_tag(p_tag_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from tags where id = p_tag_id;
  if v_group_id is null or not is_group_member(v_group_id) then
    raise exception 'Not authorized';
  end if;
  delete from tags where id = p_tag_id;
end;
$$;

create or replace function set_resource_tags(p_resource_id uuid, p_tag_ids uuid[])
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from resources where id = p_resource_id;
  if v_group_id is null or not is_group_member(v_group_id) then
    raise exception 'Not authorized';
  end if;

  delete from resource_tags where resource_id = p_resource_id;
  insert into resource_tags (resource_id, tag_id)
  select p_resource_id, t from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as t;
end;
$$;

create or replace function set_stock_item_tags(p_stock_item_id uuid, p_tag_ids uuid[])
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from stock_items where id = p_stock_item_id;
  if v_group_id is null or not is_group_member(v_group_id) then
    raise exception 'Not authorized';
  end if;

  delete from stock_item_tags where stock_item_id = p_stock_item_id;
  insert into stock_item_tags (stock_item_id, tag_id)
  select p_stock_item_id, t from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as t;
end;
$$;

alter publication supabase_realtime add table tags, resource_tags, stock_item_tags;
