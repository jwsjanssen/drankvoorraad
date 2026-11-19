-- Drankvoorraad FLOATS & ALTSTADT: databasestructuur (Supabase-project CHECKLIJST).
-- Alles heeft het voorvoegsel voorraad_ en staat los van de tabellen van de checklijst-app.
-- Eén tabel met documenten: 'catalog/<locatie>' (productlijst) en 'counts/<locatie>_<jaar>-W<week>' (telling).
-- Uitvoeren in de SQL Editor. Opnieuw uitvoeren kan zonder schade.

create table if not exists public.voorraad_docs (
  path       text primary key
             check (path ~ '^(catalog|counts)/[A-Za-z0-9_.-]{1,80}$'),
  data       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 400000),
  updated_at timestamptz not null default now()
);

-- Vangnet: hooguit één kopie per document per uur van de vorige inhoud.
-- Niet leesbaar via de website; terugzetten kan via het Supabase-dashboard.
create table if not exists public.voorraad_docs_history (
  id       bigint generated always as identity primary key,
  path     text not null,
  data     jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists voorraad_docs_history_path_idx on public.voorraad_docs_history (path, saved_at desc);

create or replace function public.voorraad_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.data is distinct from new.data then
    if not exists (select 1 from public.voorraad_docs_history h
                   where h.path = old.path and h.saved_at > now() - interval '1 hour') then
      insert into public.voorraad_docs_history (path, data) values (old.path, old.data);
    end if;
  end if;
  return new;
end $$;

create or replace trigger voorraad_before_write before insert or update on public.voorraad_docs
  for each row execute function public.voorraad_before_write();

-- Samenvoegen van een wijziging met het bestaande document, veld voor veld (ook genest),
-- zodat twee mensen die tegelijk tellen elkaars invoer niet overschrijven.
create or replace function public.voorraad_deep_merge(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(k,
               case when a ? k and b ? k then public.voorraad_deep_merge(a -> k, b -> k)
                    when b ? k then b -> k
                    else a -> k end), '{}'::jsonb)
      from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) keys)
    else b
  end
$$;

create or replace function public.voorraad_doc_update(p_path text, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  update public.voorraad_docs
     set data = public.voorraad_deep_merge(data, p_patch)
   where path = p_path
   returning jsonb_build_object('data', data, 'updated_at', updated_at) into r;
  if r is null then
    raise exception 'document % bestaat niet', p_path using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Toegang. Voorlopig zonder inloggen: iedereen met de link mag lezen, toevoegen en wijzigen.
-- Verwijderen kan niet via de website. Bij het inlogsysteem: maak de policies alleen voor 'authenticated'.
alter table public.voorraad_docs enable row level security;
alter table public.voorraad_docs_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'voorraad_docs' and policyname = 'voorraad lezen') then
    create policy "voorraad lezen" on public.voorraad_docs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'voorraad_docs' and policyname = 'voorraad toevoegen') then
    create policy "voorraad toevoegen" on public.voorraad_docs for insert to anon, authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'voorraad_docs' and policyname = 'voorraad wijzigen') then
    create policy "voorraad wijzigen" on public.voorraad_docs for update to anon, authenticated using (true) with check (true);
  end if;
  -- Live meekijken: wijzigingen direct doorsturen naar open schermen.
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voorraad_docs') then
    alter publication supabase_realtime add table public.voorraad_docs;
  end if;
end $$;

grant select, insert, update on public.voorraad_docs to anon, authenticated;
grant execute on function public.voorraad_doc_update(text, jsonb) to anon, authenticated;
grant execute on function public.voorraad_deep_merge(jsonb, jsonb) to anon, authenticated;
