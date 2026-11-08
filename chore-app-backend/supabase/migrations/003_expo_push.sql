-- Native Expo push tokens coexist with the Web Push subscriptions added in
-- migration 002. A person can receive both a browser notification and one
-- on each installed Android/iOS app they use.

create table if not exists expo_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table expo_push_tokens enable row level security;
drop policy if exists "own expo push tokens" on expo_push_tokens;
create policy "own expo push tokens" on expo_push_tokens for select using (user_id = auth.uid());

create or replace function save_expo_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer
as $$
begin
  if p_token is null or length(trim(p_token)) = 0 then raise exception 'Push token is required'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'Unsupported push platform'; end if;

  insert into expo_push_tokens(user_id, token, platform)
    values (auth.uid(), trim(p_token), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

create or replace function remove_expo_push_token(p_token text)
returns void
language plpgsql security definer
as $$
begin
  delete from expo_push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

alter publication supabase_realtime add table expo_push_tokens;
