-- LX Planner — schéma Supabase
-- À coller une seule fois dans Supabase → SQL Editor → New query → Run.

-- 1. Une table générique : chaque ligne = un enregistrement de l'app (tâche, projet, habitude…)
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,          -- horodatage de modification côté appareil (résolution des conflits)
  deleted boolean not null default false,   -- suppression synchronisée
  server_updated_at timestamptz not null default clock_timestamp(), -- curseur de récupération
  primary key (user_id, collection, id)
);
create index if not exists records_pull_idx on public.records (user_id, server_updated_at);

-- 2. Versions perdantes lors d'un conflit (jamais supprimées silencieusement)
create table if not exists public.record_conflicts (
  pk bigint generated always as identity primary key,
  user_id uuid not null,
  collection text not null,
  id text not null,
  lost jsonb,
  kept jsonb,
  at timestamptz not null default now()
);

-- 3. Sauvegardes complètes quotidiennes (envoyées par l'app)
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists backups_user_idx on public.backups (user_id, created_at desc);

-- 4. Sécurité : chaque compte ne voit et ne modifie que ses propres données
alter table public.records enable row level security;
alter table public.record_conflicts enable row level security;
alter table public.backups enable row level security;

drop policy if exists "records_own" on public.records;
create policy "records_own" on public.records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "conflicts_own_read" on public.record_conflicts;
create policy "conflicts_own_read" on public.record_conflicts for select using (auth.uid() = user_id);

drop policy if exists "backups_own" on public.backups;
create policy "backups_own" on public.backups for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. « Dernière modification gagnante » appliquée côté serveur :
--    une écriture plus ancienne que la version stockée est refusée et archivée dans record_conflicts.
create or replace function public.records_lww() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    insert into public.record_conflicts (user_id, collection, id, lost, kept)
    values (old.user_id, old.collection, old.id, new.data, old.data);
    return null; -- on garde la version la plus récente
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
  for each row execute function public.records_lww();

-- 6. Ne garder que les 30 dernières sauvegardes par compte
--    (30 au total, quotidiennes et « Sauvegarde de sécurité avant restauration » confondues : règle en place dans Supabase.)
--    Évolution « 30 quotidiennes + 30 de sécurité » EN PAUSE (décision du 26/11/2026) : ne pas modifier cette fonction
--    sans la procédure validée par l’utilisatrice (sauvegarde, lectures 4.A–4.C, essai annulé 4.D, accord explicite).
create or replace function public.backups_prune() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.backups b
  where b.user_id = new.user_id
    and b.id not in (select id from public.backups where user_id = new.user_id order by created_at desc limit 30);
  return null;
end $$;

drop trigger if exists backups_prune on public.backups;
create trigger backups_prune after insert on public.backups
  for each row execute function public.backups_prune();

-- 7. Droits d'accès via l'API (le projet n'expose pas automatiquement les nouvelles tables).
--    Seuls les utilisateurs connectés y ont accès, et la sécurité par compte (RLS ci-dessus) limite chacun à ses propres lignes.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select, insert, delete on public.backups to authenticated;
grant select on public.record_conflicts to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.records, public.backups, public.record_conflicts from anon;

-- 8. Images (couvertures de contenus, simulations de feed) : espace de stockage PRIVÉ.
--    Chaque compte range ses images dans un dossier à son identifiant et ne peut accéder qu'à celui-ci.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "media_own_read" on storage.objects;
create policy "media_own_read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_own_insert" on storage.objects;
create policy "media_own_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_own_update" on storage.objects;
create policy "media_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_own_delete" on storage.objects;
create policy "media_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
