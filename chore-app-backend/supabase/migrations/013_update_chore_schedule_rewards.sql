-- Migration 013
-- update_chore_schedule was missing p_coin_reward, p_requires_approval,
-- p_due_time, p_overdue_nudge_interval_minutes that the frontend sends.
-- The schema cache error "could not find the function" is because Supabase
-- matches by exact argument list — adding any new param = new overload needed.
-- Drop the old 8-arg overload first, then recreate with 12 args.

drop function if exists update_chore_schedule(uuid, int, uuid[], boolean, jsonb, boolean, boolean, int);

create or replace function update_chore_schedule(
  p_chore_type_id uuid,
  p_interval_days int,
  p_user_ids uuid[],
  p_requires_photo boolean default null,
  p_advanced_schedule jsonb default null,
  p_is_rotational boolean default null,
  p_is_delayable boolean default null,
  p_max_consecutive_delays int default null,
  p_coin_reward int default null,
  p_requires_approval boolean default null,
  p_due_time time default null,
  p_overdue_nudge_interval_minutes int default null
)
returns void
language plpgsql security definer
as $$
declare
  v_ct chore_types%rowtype;
  v_person_count int;
  v_max_coins int;
  i int;
begin
  select * into v_ct from chore_types where id = p_chore_type_id and has_schedule = true;
  if not found then raise exception 'Not a scheduled chore type'; end if;
  if not is_group_member(v_ct.group_id) then raise exception 'Not authorized'; end if;

  if p_interval_days is null or p_interval_days < 1 then
    raise exception 'Interval must be at least 1 day';
  end if;

  v_person_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_person_count = 0 then
    raise exception 'Must provide at least one user id';
  end if;

  -- Clamp coin_reward to group max if provided
  if p_coin_reward is not null then
    select max_coin_reward into v_max_coins from groups where id = v_ct.group_id;
    if p_coin_reward > coalesce(v_max_coins, 10) then
      p_coin_reward := coalesce(v_max_coins, 10);
    end if;
  end if;

  update chore_types set
    schedule_interval_days = p_interval_days,
    requires_photo         = coalesce(p_requires_photo, requires_photo),
    advanced_schedule      = coalesce(p_advanced_schedule, advanced_schedule),
    is_rotational          = coalesce(p_is_rotational, is_rotational),
    is_delayable           = coalesce(p_is_delayable, is_delayable),
    max_consecutive_delays = coalesce(p_max_consecutive_delays, max_consecutive_delays),
    coin_reward            = coalesce(p_coin_reward, coin_reward),
    requires_approval      = coalesce(p_requires_approval, requires_approval),
    due_time               = coalesce(p_due_time, due_time),
    overdue_nudge_interval_minutes = coalesce(p_overdue_nudge_interval_minutes, overdue_nudge_interval_minutes)
  where id = p_chore_type_id;

  delete from chore_type_rotation where chore_type_id = p_chore_type_id;
  for i in 1..v_person_count loop
    insert into chore_type_rotation (chore_type_id, user_id, sort_order)
      values (p_chore_type_id, p_user_ids[i], i);
  end loop;
end;
$$;
