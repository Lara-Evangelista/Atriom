-- Close client-visible authorization gaps in the original RPC layer.
-- Group membership alone is not enough: a household member must not be able
-- to complete, delay, or accept a trade for someone else's assigned turn.

create or replace function complete_chore_event(p_event_id uuid, p_photo_url text default null)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct chore_types%rowtype;
  v_person_name text;
  r record;
begin
  select * into v_event from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_event.group_id) then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from chore_event_assignees where chore_event_id = v_event.id and user_id = auth.uid()
  ) then raise exception 'This turn is assigned to someone else'; end if;

  select * into v_ct from chore_types where id = v_event.chore_type_id;
  if v_ct.requires_photo and p_photo_url is null then raise exception 'This chore requires a photo to mark it done'; end if;

  update chore_events set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url where id = p_event_id;
  if v_ct.has_resources then
    for r in select resource_id, qty_per_completion from chore_type_resources where chore_type_id = v_ct.id loop
      update resources set qty = greatest(0, qty - r.qty_per_completion) where id = r.resource_id;
      perform check_resource_alert(r.resource_id);
    end loop;
  end if;

  select display_name into v_person_name from memberships where group_id = v_event.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_event.group_id, coalesce(v_person_name, 'Someone') || ' completed "' || v_ct.name || '".', 'done');
end;
$$;

create or replace function delay_chore_event(p_event_id uuid, p_days int)
returns void
language plpgsql security definer
as $$
declare
  v_target chore_events%rowtype;
  v_ct_name text;
  v_person_name text;
begin
  if p_days is null or p_days < 1 then raise exception 'Delay must be at least one day'; end if;
  select * into v_target from chore_events where id = p_event_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_target.group_id) or v_target.assigned_user_id <> auth.uid() then raise exception 'Only the assigned person can delay this turn'; end if;

  update chore_events set date = date + p_days where chore_type_id = v_target.chore_type_id and status = 'pending' and date >= v_target.date;
  select name into v_ct_name from chore_types where id = v_target.chore_type_id;
  select display_name into v_person_name from memberships where group_id = v_target.group_id and user_id = auth.uid();
  insert into activity_log(group_id, text, type)
    values (v_target.group_id, 'Delayed ' || p_days || ' day(s): ' || v_ct_name || ' (' || coalesce(v_person_name, 'someone') || E'\'s turn) and later turns shifted.', 'delay');
end;
$$;

create or replace function request_trade(p_from_event_id uuid, p_to_event_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_from chore_events%rowtype;
  v_to chore_events%rowtype;
  v_trade_id uuid;
  v_from_name text;
  v_to_name text;
begin
  select * into v_from from chore_events where id = p_from_event_id;
  select * into v_to from chore_events where id = p_to_event_id;
  if v_from.id is null or v_to.id is null or v_from.group_id <> v_to.group_id then raise exception 'Invalid trade'; end if;
  if not is_group_member(v_from.group_id) or v_from.assigned_user_id <> auth.uid() then raise exception 'Only your own turn can be offered'; end if;
  if v_to.assigned_user_id is null or v_to.assigned_user_id = auth.uid() then raise exception 'Pick another person''s turn'; end if;
  if v_from.chore_type_id <> v_to.chore_type_id then raise exception 'Can only trade turns within the same rotation'; end if;
  if v_from.status <> 'pending' or v_to.status <> 'pending' then raise exception 'Can only trade turns that have not happened yet'; end if;
  if exists (select 1 from trades where status = 'pending' and (from_event_id in (p_from_event_id, p_to_event_id) or to_event_id in (p_from_event_id, p_to_event_id))) then raise exception 'One of these turns already has a pending trade'; end if;

  insert into trades(group_id, from_event_id, to_event_id, from_user_id, to_user_id, status)
    values (v_from.group_id, p_from_event_id, p_to_event_id, v_from.assigned_user_id, v_to.assigned_user_id, 'pending') returning id into v_trade_id;
  select display_name into v_from_name from memberships where group_id = v_from.group_id and user_id = v_from.assigned_user_id;
  select display_name into v_to_name from memberships where group_id = v_to.group_id and user_id = v_to.assigned_user_id;
  insert into activity_log(group_id, text, type) values (v_from.group_id, coalesce(v_from_name, 'Someone') || ' proposed a swap with ' || coalesce(v_to_name, 'someone') || '.', 'trade');
  return v_trade_id;
end;
$$;

create or replace function respond_trade(p_trade_id uuid, p_accept boolean)
returns void
language plpgsql security definer
as $$
declare
  v_trade trades%rowtype;
  v_from_name text;
  v_to_name text;
begin
  select * into v_trade from trades where id = p_trade_id and status = 'pending';
  if not found then return; end if;
  if not is_group_member(v_trade.group_id) or v_trade.to_user_id <> auth.uid() then raise exception 'Only the recipient can respond to this trade'; end if;
  update trades set status = case when p_accept then 'accepted' else 'declined' end where id = p_trade_id;
  if p_accept then
    update chore_events set assigned_user_id = v_trade.to_user_id where id = v_trade.from_event_id;
    update chore_events set assigned_user_id = v_trade.from_user_id where id = v_trade.to_event_id;
    update chore_event_assignees set user_id = v_trade.to_user_id where chore_event_id = v_trade.from_event_id;
    update chore_event_assignees set user_id = v_trade.from_user_id where chore_event_id = v_trade.to_event_id;
  end if;
  select display_name into v_from_name from memberships where group_id = v_trade.group_id and user_id = v_trade.from_user_id;
  select display_name into v_to_name from memberships where group_id = v_trade.group_id and user_id = v_trade.to_user_id;
  insert into activity_log(group_id, text, type) values (v_trade.group_id, 'Trade ' || case when p_accept then 'accepted' else 'declined' end || ': ' || coalesce(v_from_name, '?') || ' ↔ ' || coalesce(v_to_name, '?') || '.', 'trade');
end;
$$;
