
-- Also harden complete_chore_event: instead of checking the has_resources flag
-- (which can get out of sync), query chore_type_resources directly.
-- This makes stock deduction robust even if has_resources was never set.
create or replace function complete_chore_event(p_event_id uuid, p_photo_url text default null)
returns void
language plpgsql security definer
as $$
declare
  v_event chore_events%rowtype;
  v_ct    chore_types%rowtype;
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

  update chore_events
     set status = 'done', done_at = now(), done_by = auth.uid(), photo_url = p_photo_url
   where id = p_event_id;

  -- Deduct resources: query chore_type_resources directly rather than trusting
  -- the has_resources flag, which can be stale if the flag was never set.
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

  -- Keep has_resources in sync
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
