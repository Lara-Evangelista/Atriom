-- Migration 032: leaderboard prizes.
--
-- Admins can set a coin amount that's awarded to whoever tops the
-- weekly / monthly / yearly leaderboard. A prize of 0 (the default)
-- means that period doesn't award anything -- existing groups are
-- unaffected until an admin opts in.
--
-- award_leaderboard_prizes(p_period_type) is meant to be called once a
-- day by a cron edge function (see supabase/functions/cron-leaderboard-prizes),
-- not by regular users -- it iterates every group, so it's revoked from
-- `authenticated`/`public` and only grantable to `service_role` at the
-- bottom of this file. It's idempotent: leaderboard_prize_log has a
-- unique constraint per (group, period type, period start, winner), so
-- running it more than once for the same period is a no-op the second
-- time, and rows already logged are never re-awarded.
--
-- Ties: if more than one person is tied for the top score, everyone tied
-- gets the full prize (not split) -- simplest to reason about, and
-- avoids fractional coins.

alter table groups add column if not exists weekly_leaderboard_prize_coins int not null default 0;
alter table groups add column if not exists monthly_leaderboard_prize_coins int not null default 0;
alter table groups add column if not exists yearly_leaderboard_prize_coins int not null default 0;

create table if not exists leaderboard_prize_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  period_type text not null check (period_type in ('weekly', 'monthly', 'yearly')),
  period_start date not null,
  period_end date not null,
  user_id uuid not null references auth.users(id),
  coins_awarded int not null,
  created_at timestamptz not null default now(),
  unique (group_id, period_type, period_start, user_id)
);

alter table leaderboard_prize_log enable row level security;
drop policy if exists "members view leaderboard_prize_log" on leaderboard_prize_log;
create policy "members view leaderboard_prize_log" on leaderboard_prize_log for select
  using (is_group_member(group_id));
-- No insert/update/delete policy for regular members -- only
-- award_leaderboard_prizes (security definer, service-role-only) writes here.

alter publication supabase_realtime add table leaderboard_prize_log;

-- ============================================================
-- update_leaderboard_prizes: admin-only setting, same pattern as
-- update_household_settings.
-- ============================================================

create or replace function update_leaderboard_prizes(
  p_group_id uuid,
  p_weekly_coins int default null,
  p_monthly_coins int default null,
  p_yearly_coins int default null
)
returns void
language plpgsql security definer
as $$
begin
  if not is_group_admin(p_group_id) then
    raise exception 'Only group admins can set leaderboard prizes';
  end if;

  if p_weekly_coins is not null and p_weekly_coins < 0 then raise exception 'Prize coins cannot be negative'; end if;
  if p_monthly_coins is not null and p_monthly_coins < 0 then raise exception 'Prize coins cannot be negative'; end if;
  if p_yearly_coins is not null and p_yearly_coins < 0 then raise exception 'Prize coins cannot be negative'; end if;

  update groups set
    weekly_leaderboard_prize_coins  = coalesce(p_weekly_coins, weekly_leaderboard_prize_coins),
    monthly_leaderboard_prize_coins = coalesce(p_monthly_coins, monthly_leaderboard_prize_coins),
    yearly_leaderboard_prize_coins  = coalesce(p_yearly_coins, yearly_leaderboard_prize_coins)
  where id = p_group_id;
end;
$$;

-- ============================================================
-- award_leaderboard_prizes: run daily by cron, one p_period_type at a
-- time ('weekly' | 'monthly' | 'yearly'). Always targets the most
-- recently *completed* period, so it's safe to call every day -- it's a
-- no-op except on the day a period first closes.
-- ============================================================

create or replace function award_leaderboard_prizes(p_period_type text)
returns void
language plpgsql security definer
as $$
declare
  v_group record;
  v_period_start date;
  v_period_end date;
  v_prize_coins int;
  v_top_points bigint;
  v_winner record;
  v_inserted boolean;
begin
  if p_period_type not in ('weekly', 'monthly', 'yearly') then
    raise exception 'Invalid period type: %', p_period_type;
  end if;

  if p_period_type = 'weekly' then
    -- date_trunc('week', ...) lands on Monday. The most recently
    -- *completed* week is the one starting 7 days before this Monday.
    v_period_start := (date_trunc('week', current_date) - interval '7 days')::date;
    v_period_end := v_period_start + 6;
  elsif p_period_type = 'monthly' then
    v_period_start := (date_trunc('month', current_date) - interval '1 month')::date;
    v_period_end := (date_trunc('month', current_date) - interval '1 day')::date;
  else
    v_period_start := (date_trunc('year', current_date) - interval '1 year')::date;
    v_period_end := (date_trunc('year', current_date) - interval '1 day')::date;
  end if;

  for v_group in select id from groups loop
    v_prize_coins := case p_period_type
      when 'weekly' then (select weekly_leaderboard_prize_coins from groups where id = v_group.id)
      when 'monthly' then (select monthly_leaderboard_prize_coins from groups where id = v_group.id)
      else (select yearly_leaderboard_prize_coins from groups where id = v_group.id)
    end;

    if coalesce(v_prize_coins, 0) <= 0 then
      continue;
    end if;

    -- Already awarded for this exact period? Skip the whole group.
    if exists(
      select 1 from leaderboard_prize_log
       where group_id = v_group.id and period_type = p_period_type and period_start = v_period_start
    ) then
      continue;
    end if;

    select max(points) into v_top_points from get_leaderboard(v_group.id, v_period_start, v_period_end);
    if v_top_points is null or v_top_points <= 0 then
      continue;
    end if;

    for v_winner in
      select user_id, display_name from get_leaderboard(v_group.id, v_period_start, v_period_end)
       where points = v_top_points
    loop
      v_inserted := null;
      insert into leaderboard_prize_log(group_id, period_type, period_start, period_end, user_id, coins_awarded)
        values (v_group.id, p_period_type, v_period_start, v_period_end, v_winner.user_id, v_prize_coins)
        on conflict (group_id, period_type, period_start, user_id) do nothing
        returning true into v_inserted;

      if v_inserted then
        update memberships set coin_balance = coin_balance + v_prize_coins
          where group_id = v_group.id and user_id = v_winner.user_id;

        insert into activity_log(group_id, text, type)
          values (v_group.id,
            coalesce(v_winner.display_name, 'Someone') || ' topped the ' || p_period_type ||
            ' leaderboard and won ' || v_prize_coins || ' coins! 🏆',
            'prize');
      end if;
    end loop;
  end loop;
end;
$$;

-- Service-role only: this iterates every group and is meant to be called
-- exclusively by the cron-leaderboard-prizes edge function using the
-- service role key, never directly by a client.
revoke execute on function award_leaderboard_prizes(text) from public;
revoke execute on function award_leaderboard_prizes(text) from authenticated;
grant execute on function award_leaderboard_prizes(text) to service_role;
