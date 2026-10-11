-- Notely cloud workspaces. Apply in the Supabase SQL editor or with `supabase db push`.
create table if not exists public.notely_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  updated_at timestamptz not null default now()
);
create table if not exists public.notely_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.notely_groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  content text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists notely_groups_user_updated on public.notely_groups(user_id, updated_at desc);
create index if not exists notely_documents_group on public.notely_documents(group_id, updated_at desc);
alter table public.notely_groups enable row level security;
alter table public.notely_documents enable row level security;
drop policy if exists "Users manage own Notely groups" on public.notely_groups;
create policy "Users manage own Notely groups" on public.notely_groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own Notely documents" on public.notely_documents;
create policy "Users manage own Notely documents" on public.notely_documents for all using (auth.uid() = user_id) with check (
  auth.uid() = user_id and exists (select 1 from public.notely_groups g where g.id = group_id and g.user_id = auth.uid())
);
