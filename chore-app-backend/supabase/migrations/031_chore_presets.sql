-- Migration 031: chore presets.
--
-- For a chore you do often but don't want on a fixed schedule (clearing
-- the dishwasher, taking out recycling, whatever) -- save its settings
-- once as a preset, then quickly spin up a new occurrence of it later:
-- assign it to specific people, or leave it unassigned so it notifies
-- everyone and whoever gets to it first is the one who did it (same
-- "genuinely unassigned" behavior complete_onetime_task/complete_chore_event
-- already support).
--
-- A preset is just a template -- creating one writes nothing to
-- chore_types/chore_events. Only instantiate_preset() actually creates a
-- (one-time or timer) task, exactly the way create_onetime_task /
-- create_onetime_timer_task already do, just sourced from saved settings
-- instead of a form filled out from scratch each time.

create table if not exists chore_presets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  icon text,
  created_by uuid references auth.users(id),
  requires_photo boolean not null default false,
  coin_reward int not null default 1,
  requires_approval boolean,
  due_time time,
  overdue_nudge_interval_minutes int,
  counts_for_leaderboard boolean not null default true,
  has_timer boolean not null default false,
  default_timer_minutes int,
  created_at timestamptz not null default now()
);

alter table chore_presets enable row level security;
drop policy if exists "members access chore_presets" on chore_presets;
create policy "members access chore_presets" on chore_presets for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

alter publication supabase_realtime add table chore_presets;

-- ============================================================
-- create_preset / update_preset / delete_preset
-- ============================================================

create or replace function create_preset(
  p_group_id uuid,
  p_name text,
  p_icon text,
  p_requires_photo boolean default false,
  p_coin_reward int default 1,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null,
  p_counts_for_leaderboard boolean default true,
  p_has_timer boolean default false,
  p_default_timer_minutes int default 60
)
returns uuid
language plpgsql security definer
as $$
declare
  v_id uuid;
  v_max_coins int;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Name is required'; end if;

  select max_coin_reward into v_max_coins from groups where id = p_group_id;
  if p_coin_reward > coalesce(v_max_coins, 10) then
    p_coin_reward := coalesce(v_max_coins, 10);
  end if;

  insert into chore_presets(
    group_id, name, icon, created_by, requires_photo, coin_reward, requires_approval,
    due_time, overdue_nudge_interval_minutes, counts_for_leaderboard, has_timer, default_timer_minutes
  ) values (
    p_group_id, trim(p_name), p_icon, auth.uid(), coalesce(p_requires_photo, false), coalesce(p_coin_reward, 1),
    coalesce(p_requires_approval, p_requires_photo), p_due_time, p_overdue_nudge_interval_minutes,
    coalesce(p_counts_for_leaderboard, true), coalesce(p_has_timer, false),
    case when coalesce(p_has_timer, false) then coalesce(p_default_timer_minutes, 60) else null end
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function update_preset(
  p_preset_id uuid,
  p_name text default null,
  p_icon text default null,
  p_requires_photo boolean default null,
  p_coin_reward int default null,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null,
  p_counts_for_leaderboard boolean default null,
  p_has_timer boolean default null,
  p_default_timer_minutes int default null
)
returns void
language plpgsql security definer
as $$
declare
  v_preset chore_presets%rowtype;
  v_max_coins int;
begin
  select * into v_preset from chore_presets where id = p_preset_id;
  if not found then raise exception 'Preset not found'; end if;
  if not is_group_member(v_preset.group_id) then raise exception 'Not authorized'; end if;

  if p_coin_reward is not null then
    select max_coin_reward into v_max_coins from groups where id = v_preset.group_id;
    if p_coin_reward > coalesce(v_max_coins, 10) then
      p_coin_reward := coalesce(v_max_coins, 10);
    end if;
  end if;

  update chore_presets set
    name = coalesce(nullif(trim(p_name), ''), name),
    icon = coalesce(p_icon, icon),
    requires_photo = coalesce(p_requires_photo, requires_photo),
    coin_reward = coalesce(p_coin_reward, coin_reward),
    requires_approval = coalesce(p_requires_approval, requires_approval),
    due_time = coalesce(p_due_time, due_time),
    overdue_nudge_interval_minutes = coalesce(p_overdue_nudge_interval_minutes, overdue_nudge_interval_minutes),
    counts_for_leaderboard = coalesce(p_counts_for_leaderboard, counts_for_leaderboard),
    has_timer = coalesce(p_has_timer, has_timer),
    default_timer_minutes = coalesce(p_default_timer_minutes, default_timer_minutes)
  where id = p_preset_id;
end;
$$;

create or replace function delete_preset(p_preset_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from chore_presets where id = p_preset_id;
  if v_group_id is null then return; end if;
  if not is_group_member(v_group_id) then raise exception 'Not authorized'; end if;
  delete from chore_presets where id = p_preset_id;
end;
$$;

-- ============================================================
-- instantiate_preset: actually creates the task from a saved preset.
-- p_assignee_ids null/empty = unassigned (notify everyone, first to do
-- it gets it) -- same convention as create_onetime_task.
-- ============================================================

create or replace function instantiate_preset(
  p_preset_id uuid,
  p_assignee_ids uuid[] default null,
  p_due_date date default current_date,
  p_cycle_minutes int default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_preset chore_presets%rowtype;
  v_chore_type_id uuid;
  v_event_id uuid;
  v_run_id uuid;
  v_uid uuid;
  v_names text;
  v_assignee_ids uuid[];
  v_bad_count int;
  v_cycle_minutes int;
  v_display_name text;
begin
  select * into v_preset from chore_presets where id = p_preset_id;
  if not found then raise exception 'Preset not found'; end if;
  if not is_group_member(v_preset.group_id) then raise exception 'Not authorized'; end if;

  v_assignee_ids := coalesce(p_assignee_ids, array[]::uuid[]);

  if array_length(v_assignee_ids, 1) > 0 then
    select count(*) into v_bad_count
      from unnest(v_assignee_ids) uid
      where not exists (select 1 from memberships m where m.group_id = v_preset.group_id and m.user_id = uid);
    if v_bad_count > 0 then
      raise exception 'One or more selected people are not members of this group';
    end if;

    perform check_coin_assignment_allowed(v_preset.group_id, v_assignee_ids, v_preset.coin_reward);
  end if;

  select display_name into v_display_name from memberships where group_id = v_preset.group_id and user_id = auth.uid();
  select string_agg(display_name, ', ' order by display_name) into v_names
    from memberships where group_id = v_preset.group_id and user_id = any(v_assignee_ids);

  if v_preset.has_timer then
    v_cycle_minutes := coalesce(p_cycle_minutes, v_preset.default_timer_minutes, 60);

    insert into chore_types(
      group_id, name, icon, has_schedule, has_timer, requires_photo, created_by, coin_reward,
      requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard,
      is_onetime, default_timer_minutes
    ) values (
      v_preset.group_id, v_preset.name, v_preset.icon, false, true, v_preset.requires_photo, auth.uid(),
      v_preset.coin_reward, v_preset.requires_approval, v_preset.due_time, v_preset.overdue_nudge_interval_minutes,
      v_preset.counts_for_leaderboard, true, v_preset.default_timer_minutes
    ) returning id into v_chore_type_id;

    insert into chore_runs(chore_type_id, group_id, trigger_reason, status, started_by, started_at, cycle_minutes, cycle_ends_at)
      values (v_chore_type_id, v_preset.group_id, 'preset', 'running', auth.uid(), now(),
              v_cycle_minutes, now() + (v_cycle_minutes || ' minutes')::interval)
      returning id into v_run_id;

    foreach v_uid in array v_assignee_ids loop
      insert into chore_run_assignees(chore_run_id, user_id) values (v_run_id, v_uid);
    end loop;

    insert into activity_log(group_id, text, type)
      values (v_preset.group_id,
        coalesce(v_display_name, 'Someone') || ' started ' || v_preset.name || ' from a preset (' || v_cycle_minutes || ' min).' ||
        case when array_length(v_assignee_ids, 1) > 0
          then ' ' || coalesce(v_names, '') || ' will be notified when it''s ready.'
          else ' Anyone can grab it.'
        end,
        'timer');

    return v_chore_type_id;
  else
    insert into chore_types(
      group_id, name, icon, has_schedule, requires_photo, created_by, coin_reward,
      requires_approval, due_time, overdue_nudge_interval_minutes, counts_for_leaderboard, is_onetime
    ) values (
      v_preset.group_id, v_preset.name, v_preset.icon, false, v_preset.requires_photo, auth.uid(),
      v_preset.coin_reward, v_preset.requires_approval, v_preset.due_time, v_preset.overdue_nudge_interval_minutes,
      v_preset.counts_for_leaderboard, true
    ) returning id into v_chore_type_id;

    insert into chore_events(chore_type_id, group_id, date, status, created_by, assigned_user_id)
      values (v_chore_type_id, v_preset.group_id, coalesce(p_due_date, current_date), 'pending', auth.uid(),
              case when array_length(v_assignee_ids, 1) = 1 then v_assignee_ids[1] else null end)
      returning id into v_event_id;

    foreach v_uid in array v_assignee_ids loop
      insert into chore_event_assignees(chore_event_id, user_id) values (v_event_id, v_uid);
    end loop;

    insert into activity_log(group_id, text, type)
      values (v_preset.group_id,
        case when array_length(v_assignee_ids, 1) > 0
          then v_preset.name || ' was assigned to ' || coalesce(v_names, 'someone') || ' from a preset.'
          else v_preset.name || ' was added from a preset -- unassigned, first to do it gets it.'
        end,
        'chore_created');

    return v_chore_type_id;
  end if;
end;
$$;
