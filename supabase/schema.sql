-- Drankvoorraad FLOATS & ALTSTADT: databasestructuur (Supabase-project CHECKLIJST).
-- Alles heeft het voorvoegsel voorraad_ en staat los van de tabellen van de checklijst-app.
-- Eén tabel met documenten: 'catalog/<locatie>' (productlijst) en 'counts/<locatie>_<jaar>-W<week>' (telling),
-- en voor de temperatuurregistratie 'temp/<plek>' (apparaten) en 'templog/<plek>_<jaar>-<maand>' (metingen).
-- en voor de checklijsten 'check/<plek>' (lijsten en taken) en 'checklog/<plek>_<periode>' (wat is afgetekend).
-- en voor de HACCP-registraties 'haccp/<plek>' (instellingen en normen) en 'haccplog/<plek>_<jaar>-<maand>' (registraties).
-- en voor het parkeren 'park/<plek>' (plekken) en 'parklog/<plek>_<jaar>-<maand>' (verhuringen) en 'parklog/<plek>_kb-<jaar>' (kamerborg).
-- Uitvoeren in de SQL Editor. Opnieuw uitvoeren kan zonder schade.

create table if not exists public.voorraad_docs (
  path       text primary key
             check (path ~ '^(catalog|counts|temp|templog|check|checklog|haccp|haccplog|park|parklog)/[A-Za-z0-9_.-]{1,80}$'),
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
-- Bestaande database: de padcontrole verruimen voor de temperatuurdocumenten.
alter table public.voorraad_docs drop constraint if exists voorraad_docs_path_check;
alter table public.voorraad_docs add constraint voorraad_docs_path_check
  check (path ~ '^(catalog|counts|temp|templog|check|checklog|haccp|haccplog|park|parklog)/[A-Za-z0-9_.-]{1,80}$');

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

alter table public.voorraad_docs enable row level security;
alter table public.voorraad_docs_history enable row level security;

-- Toegang met een code. De website praat alleen via onderstaande functies met de database:
-- eerst voorraad_login(code) -> sessiesleutel, daarna lezen en schrijven met die sleutel.
-- De code zelf staat nergens leesbaar: alleen een hash in voorraad_toegang.
-- Code instellen of wijzigen (in de SQL Editor):  select public.voorraad_code_instellen('....');
-- Daarna moet iedereen opnieuw inloggen.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.voorraad_toegang (
  id         int primary key default 1 check (id = 1),
  code_hash  text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.voorraad_sessies (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists public.voorraad_pogingen (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists voorraad_pogingen_at_idx on public.voorraad_pogingen (at);

alter table public.voorraad_toegang  enable row level security;
alter table public.voorraad_sessies  enable row level security;
alter table public.voorraad_pogingen enable row level security;
revoke all on public.voorraad_toegang, public.voorraad_sessies, public.voorraad_pogingen from public, anon, authenticated;

create or replace function public.voorraad_code_instellen(p_code text) returns void
language plpgsql set search_path = public, extensions as $$
begin
  if p_code is null or length(p_code) < 4 or length(p_code) > 64 then
    raise exception 'de code moet 4 tot 64 tekens hebben';
  end if;
  insert into public.voorraad_toegang (id, code_hash) values (1, crypt(p_code, gen_salt('bf', 10)))
  on conflict (id) do update set code_hash = excluded.code_hash, updated_at = now();
  delete from public.voorraad_sessies;
  delete from public.voorraad_pogingen;
end $$;

-- Inloggen. Rem op raden: hooguit 6 foute pogingen per kwartier per adres en 40 per uur in totaal.
create or replace function public.voorraad_login(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ip text; v_hash text; v_token text; n_ip int; n_all int;
begin
  perform pg_advisory_xact_lock(hashtext('voorraad_login'));
  begin
    v_ip := nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null;
  end;
  v_ip := left(coalesce(v_ip, 'onbekend'), 60);

  delete from public.voorraad_pogingen where at < now() - interval '1 day';
  select count(*) into n_ip  from public.voorraad_pogingen where ip = v_ip and at > now() - interval '15 minutes';
  select count(*) into n_all from public.voorraad_pogingen where at > now() - interval '1 hour';
  if n_ip >= 6 or n_all >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select code_hash into v_hash from public.voorraad_toegang where id = 1;
  if v_hash is null or p_code is null or length(p_code) > 64 or crypt(p_code, v_hash) <> v_hash then
    insert into public.voorraad_pogingen (ip) values (v_ip);
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  delete from public.voorraad_sessies where expires_at < now();
  insert into public.voorraad_sessies (token_hash, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), now() + interval '180 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.voorraad_sessie_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_token is not null and length(p_token) = 64 and exists (
    select 1 from public.voorraad_sessies s
    where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires_at > now());
$$;

-- p_prefixes: alleen documenten van die soorten, bv. '{temp,templog}'. Leeg = alles.
drop function if exists public.voorraad_lezen(text, timestamptz);
create or replace function public.voorraad_lezen(p_token text, p_since timestamptz default null, p_prefixes text[] default null)
returns table (path text, data jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.voorraad_sessie_ok(p_token) then
    raise exception 'geen toegang' using errcode = '28000';
  end if;
  return query
    select d.path, d.data, d.updated_at from public.voorraad_docs d
    where (p_since is null or d.updated_at > p_since)
      and (p_prefixes is null or split_part(d.path, '/', 1) = any (p_prefixes));
end $$;

create or replace function public.voorraad_schrijven(p_token text, p_path text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not public.voorraad_sessie_ok(p_token) then
    raise exception 'geen toegang' using errcode = '28000';
  end if;
  insert into public.voorraad_docs as d (path, data) values (p_path, p_data)
  on conflict (path) do update set data = excluded.data
  returning jsonb_build_object('data', d.data, 'updated_at', d.updated_at) into r;
  return r;
end $$;

create or replace function public.voorraad_bijwerken(p_token text, p_path text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not public.voorraad_sessie_ok(p_token) then
    raise exception 'geen toegang' using errcode = '28000';
  end if;
  update public.voorraad_docs d
     set data = public.voorraad_deep_merge(d.data, p_patch)
   where d.path = p_path
   returning jsonb_build_object('data', d.data, 'updated_at', d.updated_at) into r;
  if r is null then
    raise exception 'document % bestaat niet', p_path using errcode = 'P0002';
  end if;
  return r;
end $$;

revoke execute on function public.voorraad_code_instellen(text) from public, anon, authenticated;
revoke execute on function public.voorraad_sessie_ok(text) from public, anon, authenticated;
revoke execute on function public.voorraad_login(text) from public;
revoke execute on function public.voorraad_lezen(text, timestamptz, text[]) from public;
revoke execute on function public.voorraad_schrijven(text, text, jsonb) from public;
revoke execute on function public.voorraad_bijwerken(text, text, jsonb) from public;
grant execute on function public.voorraad_login(text) to anon, authenticated;
grant execute on function public.voorraad_lezen(text, timestamptz, text[]) to anon, authenticated;
grant execute on function public.voorraad_schrijven(text, text, jsonb) to anon, authenticated;
grant execute on function public.voorraad_bijwerken(text, text, jsonb) to anon, authenticated;

-- Rechtstreekse toegang tot de tabel dicht: alles loopt via de functies met sessiesleutel.
drop policy if exists "voorraad lezen" on public.voorraad_docs;
drop policy if exists "voorraad toevoegen" on public.voorraad_docs;
drop policy if exists "voorraad wijzigen" on public.voorraad_docs;
revoke all on public.voorraad_docs, public.voorraad_docs_history from public, anon, authenticated;
drop function if exists public.voorraad_doc_update(text, jsonb);
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voorraad_docs') then
    alter publication supabase_realtime drop table public.voorraad_docs;
  end if;
end $$;
