-- Add shopping list toggle to groups
alter table groups add column if not exists enable_shopping_list boolean not null default false;

-- Create shopping list items table
create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  quantity text,
  status text not null default 'pending', -- pending | bought
  added_by uuid references auth.users(id),
  bought_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table shopping_items enable row level security;

drop policy if exists "members access shopping_items" on shopping_items;
create policy "members access shopping_items" on shopping_items for all
  using (is_group_member(group_id)) with check (is_group_member(group_id));

alter publication supabase_realtime add table shopping_items;

-- Function to toggle shopping list
create or replace function toggle_shopping_list(p_group_id uuid, p_enabled boolean)
returns void
language plpgsql security definer
as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not authorized'; end if;
  update groups set enable_shopping_list = p_enabled where id = p_group_id;
end;
$$;
