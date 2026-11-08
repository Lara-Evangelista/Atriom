-- Migration 014: fix the complete_chore_event overload split and give
-- complete_onetime_task feature parity, plus fix a calendar-token race.
--
-- What happened: 011_fix_ambiguous_overloads.sql correctly dropped the old
-- 2-arg complete_chore_event(uuid, text) to keep only the 3-arg version
-- (with credited-user-ids + approval support) from 007/010. But
-- 012_fix_onetime_resource_deduction.sql then re-created that exact 2-arg
-- signature to add resource/stock deduction — recreating the ambiguity
-- 011 had just fixed, and splitting the function's behavior across two
-- overloads: the 3-arg one credits users and handles approval but never
-- deducts stock; the 2-arg one deducts stock but ignores credited users
-- and approval. Depending on which the client's named-argument call
-- happens to match, you get one behavior or the other. This is why
-- completing a rotational chore wasn't decrementing resources.
--
-- complete_onetime_task was never given resource deduction, credited
-- users, or approval/coin logic at all, causing a hard "could not find
-- the function" error whenever the client tried to credit a helper.
--
-- This migration merges everything into a single, current signature for
-- each function, with all behaviors combined.

drop function if exists complete_chore_event(uuid, text);
drop function if exists complete_chore_event(uuid, text, uuid[]);

create or replace function complete_chore_event(
  p_event_id uuid,
  p_photo_url text default null,
  p_credited_user_ids uuid[] default null
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct    chore_types%rowtype;
  v_uid   uuid;
  v_needs_approval boolean;
  v_person_name text;
  r       record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from chore_event_assignees where chore_event_id = v_event.id and user_id = auth.uid()
  ) then raise exception 'This turn is assigned to someone else'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This chore requires a photo to mark it done';
  end if;

  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  v_needs_approval := coalesce(v_ct.requires_approval, false);

  update chore_events
     set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
   where id = p_event_id;

  -- Credit all selected users with appropriate approval status.
  insert into chore_event_completions (event_id, user_id, approval_status)
  select p_event_id, unnest(p_credited_user_ids),
    case when v_needs_approval then 'pending' else 'approved' end
  on conflict do nothing;

  if not v_needs_approval then
    foreach v_uid in array p_credited_user_ids loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  end if;

  -- Deduct resources: query chore_type_resources directly rather than
  -- trusting the has_resources flag, which can be stale.
  for r in
    select resource_id, qty_per_completion
      from chore_type_resources
     where chore_type_id = v_ct.id
  loop
    update resources
       set qty = greatest(0, qty - r.qty_per_completion)
     where id = r.resource_id;
    perform check_resource_alert(r.resource_id);
  end loop;

  update chore_types
     set has_resources = exists(select 1 from chore_type_resources where chore_type_id = v_ct.id)
   where id = v_ct.id;

  select display_name into v_person_name
    from memberships
   where group_id = v_event.group_id and user_id = auth.uid();

  insert into activity_log(group_id, text, type)
    values (v_event.group_id,
            coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".',
            'done');
end;
$$;

drop function if exists complete_onetime_task(uuid, text);

create or replace function complete_onetime_task(
  p_event_id uuid,
  p_photo_url text default null,
  p_credited_user_ids uuid[] default null
)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct    chore_types%rowtype;
  v_uid   uuid;
  v_needs_approval boolean;
  v_person_name text;
  r       record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;

  -- Only someone actually offered this task can complete it (matters for
  -- the multi-assignee case — first eligible person to tap "done" wins it).
  if not exists (select 1 from chore_event_assignees where chore_event_id = p_event_id and user_id = auth.uid()) then
    raise exception 'You are not one of the people this task was assigned to';
  end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.has_schedule then
    raise exception 'This is a recurring task — use complete_chore_event instead';
  end if;
  if v_ct.requires_photo and p_photo_url is null then
    raise exception 'This task requires a photo to mark it done';
  end if;

  if p_credited_user_ids is null or array_length(p_credited_user_ids, 1) is null then
    p_credited_user_ids := array[auth.uid()];
  end if;

  v_needs_approval := coalesce(v_ct.requires_approval, false);

  update chore_events set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
    where id = p_event_id;

  insert into chore_event_completions (event_id, user_id, approval_status)
  select p_event_id, unnest(p_credited_user_ids),
    case when v_needs_approval then 'pending' else 'approved' end
  on conflict do nothing;

  if not v_needs_approval then
    foreach v_uid in array p_credited_user_ids loop
      update memberships set coin_balance = coin_balance + v_ct.coin_reward
        where group_id = v_event.group_id and user_id = v_uid;
    end loop;
  end if;

  for r in
    select resource_id, qty_per_completion
      from chore_type_resources
     where chore_type_id = v_ct.id
  loop
    update resources
       set qty = greatest(0, qty - r.qty_per_completion)
     where id = r.resource_id;
    perform check_resource_alert(r.resource_id);
  end loop;

  update chore_types
     set has_resources = exists(select 1 from chore_type_resources where chore_type_id = v_ct.id)
   where id = v_ct.id;

  select display_name into v_person_name from memberships where group_id = v_event.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".', 'done');
end;
$$;

-- Calendar token race fix: get_or_create and rotate both used a
-- check-then-insert pattern, which can lose a race between two
-- concurrent calls (e.g. the mount effect calling get_or_create at the
-- same moment the user clicks "Rotate") and hit the primary-key
-- constraint on (user_id, group_id). Upsert via ON CONFLICT is atomic.

create or replace function get_or_create_calendar_token(p_group_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_token uuid;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  insert into calendar_tokens(user_id, group_id) values (auth.uid(), p_group_id)
    on conflict (user_id, group_id) do update set user_id = excluded.user_id
    returning token into v_token;
  return v_token;
end;
$$;

create or replace function rotate_calendar_token(p_group_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_token uuid;
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  insert into calendar_tokens(user_id, group_id, token) values (auth.uid(), p_group_id, gen_random_uuid())
    on conflict (user_id, group_id) do update set token = gen_random_uuid()
    returning token into v_token;
  return v_token;
end;
$$;
