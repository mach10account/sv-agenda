-- =============================================================================
-- Rubrica Clienti — tabelle e RPC per la sezione "Clienti" (dev/clienti.js)
--
-- Da eseguire A MANO nel SQL editor di Supabase (progetto hypkwdvvrmakqrowbkqw).
-- Lo script è rieseguibile: tutto è `create or replace` / `if not exists`.
--
-- ⚠️ PRIMA DI LANCIARLO: lo script poggia su due ipotesi sui nomi già in uso
-- nello schema crm, che non ho potuto verificare. Controllale con queste due
-- query e, se i nomi reali sono diversi, correggili qui con un cerca-sostituisci:
--
--   1) Tabelle e colonne dello schema crm (mi aspetto crm.clienti con
--      id/centro/nome/cognome/telefono, crm.appuntamenti con
--      centro/cliente/giorno/stato, e una tabella membri crm.membri con
--      centro/utente):
--        select table_name, column_name from information_schema.columns
--         where table_schema = 'crm' order by 1, 2;
--
--   2) Come le RPC esistenti verificano l'appartenenza al centro (se hanno già
--      un loro helper, conviene far usare quello a crm.utente_del_centro):
--        select p.proname, pg_get_functiondef(p.oid) from pg_proc p
--          join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname in ('crm_miei_centri', 'crm_anagrafiche');
--
-- Convenzioni (le stesse delle RPC esistenti):
--   · il frontend chiama solo wrapper sullo schema public, SECURITY DEFINER;
--   · risposta { ok:true, ... } oppure { ok:false, errore:'codice' } — i codici
--     sono macchina-leggibili, i testi italiani vivono nel client;
--   · gli elenchi semplici (segmenti) tornano come array puro.
-- =============================================================================

create schema if not exists crm;

-- --------------------------------------------------------------- appartenenza
-- Ogni RPC comincia da qui: chi chiama deve essere membro del centro. L'helper
-- si crea solo se non esiste già — se le funzioni esistenti ne hanno uno con
-- questo nome è certamente più giusto del nostro e si riusa quello.
-- Se la tabella membri non si chiama crm.membri, la prima chiamata solleva un
-- errore leggibile (che il sito mostra) invece di negare o concedere in silenzio.

do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'crm' and p.proname = 'utente_del_centro'
  ) then
    execute $sql$
      create function crm.utente_del_centro(p_centro uuid) returns boolean
      language plpgsql stable security definer set search_path = '' as $f$
      begin
        if to_regclass('crm.membri') is null then
          raise exception 'Adattare crm.utente_del_centro in sql/clienti.sql: la tabella dei membri non si chiama crm.membri';
        end if;
        return exists (
          select 1 from crm.membri m
          where m.centro = p_centro and m.utente = auth.uid());
      end $f$;
    $sql$;
  end if;
end $do$;

-- ------------------------------------------------------------------- tabelle

create table if not exists crm.clienti (
  id         uuid primary key default gen_random_uuid(),
  centro     uuid not null,
  nome       text not null,
  cognome    text,
  telefono   text,
  created_at timestamptz not null default now()
);

-- La tabella clienti quasi certamente esiste già (la usa l'agenda): queste due
-- colonne sono le sole novità che la rubrica richiede.
alter table crm.clienti add column if not exists email text;
alter table crm.clienti add column if not exists created_at timestamptz not null default now();

-- Un telefono, un cliente (per centro): il controllo duplicati del modale e il
-- dedup dell'import contano su questo. Se fallisce ci sono doppioni
-- preesistenti da ripulire prima — il notice sotto dice come trovarli.
do $do$
begin
  create unique index if not exists clienti_centro_telefono_uniq
    on crm.clienti (centro, telefono)
    where telefono is not null and telefono <> '';
exception when others then
  raise notice 'Indice unico su (centro, telefono) NON creato: %. Probabile causa: telefoni doppi preesistenti. Trovali con:  select centro, telefono, count(*) from crm.clienti where telefono is not null and telefono <> '''' group by 1, 2 having count(*) > 1;', sqlerrm;
end $do$;

-- I segmenti sono filtri salvati con un nome: compaiono nella barra "Liste".
create table if not exists crm.segmenti_clienti (
  id         uuid primary key default gen_random_uuid(),
  centro     uuid not null,
  nome       text not null,
  filtri     jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ filtri (helper)
-- Un filtro è { campo, cond, v1, v2 }; campi e condizioni sono a lista chiusa,
-- tutto il resto torna false: niente SQL dinamico, niente iniezioni. I valori
-- arrivano come testo dal client; un cast che fallisce fa fallire il filtro,
-- non la query. Le date si confrontano nel fuso italiano: è l'orologio dei
-- centri, non quello del server.

create or replace function crm.clienti_condizione(
  f jsonb, p_nome text, p_cognome text, p_telefono text,
  p_creato timestamptz, p_n bigint, p_ultimo date
) returns boolean
language plpgsql stable set search_path = '' as $f$
declare
  v_campo text := f->>'campo';
  v_cond  text := f->>'cond';
  v1      text := f->>'v1';
  v2      text := f->>'v2';
  v_pieno text := lower(trim(p_nome || ' ' || coalesce(p_cognome, '')));
  v_tel1  text;
  v_data  date;
begin
  if v_campo = 'nome' then
    if v1 is null or trim(v1) = '' then return true; end if;
    if v_cond = 'contiene' then return v_pieno like '%' || lower(trim(v1)) || '%'; end if;
    if v_cond = 'uguale'   then return v_pieno = lower(trim(v1)); end if;
    return false;
  end if;

  if v_campo = 'telefono' then
    v_tel1 := regexp_replace(coalesce(v1, ''), '\D', '', 'g');
    if v_tel1 = '' then return true; end if;
    if v_cond = 'contiene' then return coalesce(p_telefono, '') like '%' || v_tel1 || '%'; end if;
    if v_cond = 'uguale'   then return coalesce(p_telefono, '') = v_tel1; end if;
    return false;
  end if;

  if v_campo = 'creato' then
    v_data := (p_creato at time zone 'Europe/Rome')::date;
    if v_cond = 'il'    then return v_data = v1::date; end if;
    if v_cond = 'prima' then return v_data < v1::date; end if;
    if v_cond = 'dopo'  then return v_data > v1::date; end if;
    if v_cond = 'tra'   then return v_data between v1::date and v2::date; end if;
    return false;
  end if;

  if v_campo = 'n_appuntamenti' then
    if v_cond = 'uguale' then return p_n = v1::bigint; end if;
    if v_cond = 'almeno' then return p_n >= v1::bigint; end if;
    if v_cond = 'al_piu' then return p_n <= v1::bigint; end if;
    if v_cond = 'tra'    then return p_n between v1::bigint and v2::bigint; end if;
    return false;
  end if;

  if v_campo = 'ultimo_appuntamento' then
    -- Chi non ha mai avuto un appuntamento non risponde a nessuna condizione
    -- sull'ultimo: per trovarlo c'è "n. appuntamenti uguale a 0".
    if p_ultimo is null then return false; end if;
    if v_cond = 'il'    then return p_ultimo = v1::date; end if;
    if v_cond = 'prima' then return p_ultimo < v1::date; end if;
    if v_cond = 'dopo'  then return p_ultimo > v1::date; end if;
    if v_cond = 'tra'   then return p_ultimo between v1::date and v2::date; end if;
    return false;
  end if;

  return false;
exception when others then
  return false;   -- valore non castabile = il filtro non passa, la query vive
end $f$;

-- ------------------------------------------------------------------- elenco
-- Il cuore della rubrica: ricerca, filtri, ordinamento e pagina in un colpo
-- solo, con i conteggi presi dall'agenda. Gli annullati non contano come
-- appuntamenti; "ultimo" è l'ultimo giorno già passato (o odierno).
-- p_per_pagina ha un tetto a 10000: è la stessa via che usa l'export CSV.

create or replace function public.crm_clienti(
  p_centro uuid,
  p_cerca text default null,
  p_filtri jsonb default '[]',
  p_ordine jsonb default null,
  p_pagina int default 1,
  p_per_pagina int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare
  v_per    int  := least(greatest(coalesce(p_per_pagina, 25), 1), 10000);
  v_pag    int  := greatest(coalesce(p_pagina, 1), 1);
  v_campo  text := coalesce(p_ordine->>'campo', 'nome');
  v_verso  text := coalesce(p_ordine->>'verso', 'asc');
  v_cifre  text := regexp_replace(coalesce(p_cerca, ''), '\D', '', 'g');
  v_filtri jsonb := case when jsonb_typeof(p_filtri) = 'array' then p_filtri else '[]'::jsonb end;
  v_ris    jsonb;
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  if v_campo not in ('nome', 'telefono', 'creato', 'n_appuntamenti', 'ultimo_appuntamento')
     or v_verso not in ('asc', 'desc') then
    v_campo := 'nome'; v_verso := 'asc';
  end if;

  with agg as (
    select a.cliente,
           count(*) filter (where a.stato <> 'annullato')                                          as n,
           (max(a.giorno) filter (where a.stato <> 'annullato' and a.giorno <= current_date))::date as ultimo
    from crm.appuntamenti a
    where a.centro = p_centro and a.cliente is not null
    group by a.cliente
  ), base as (
    select c.id, c.nome, c.cognome, c.telefono, c.email, c.created_at,
           coalesce(g.n, 0) as n_appuntamenti, g.ultimo as ultimo_appuntamento
    from crm.clienti c
    left join agg g on g.cliente = c.id
    where c.centro = p_centro
      and (p_cerca is null or trim(p_cerca) = ''
           or (c.nome || ' ' || coalesce(c.cognome, '')) ilike '%' || trim(p_cerca) || '%'
           or (v_cifre <> '' and coalesce(c.telefono, '') like '%' || v_cifre || '%'))
  ), filtrata as (
    select * from base b
    where not exists (
      select 1 from jsonb_array_elements(v_filtri) f
      where not crm.clienti_condizione(f, b.nome, b.cognome, b.telefono,
                                       b.created_at, b.n_appuntamenti, b.ultimo_appuntamento))
  )
  -- Il totale si conta sull'insieme filtrato intero, non sulla fetta: una
  -- pagina chiesta oltre la fine deve comunque dire quanti clienti ci sono,
  -- o il sito non saprebbe rientrare sull'ultima pagina vera.
  -- L'aggregato pesca da una sottoquery già ordinata (la via che indica la
  -- documentazione di Postgres): un row_number() senza ordine qui sarebbe
  -- calcolato PRIMA dell'order by e mischierebbe le pagine.
  , fetta as (
    select jsonb_build_object(
             'id', f.id, 'nome', f.nome, 'cognome', f.cognome,
             'telefono', f.telefono, 'email', f.email,
             'creato', (f.created_at at time zone 'Europe/Rome')::date,
             'n_appuntamenti', f.n_appuntamenti,
             'ultimo_appuntamento', f.ultimo_appuntamento) as riga
    from filtrata f
    order by
      case when v_campo = 'nome'     and v_verso = 'asc'  then lower(f.nome || ' ' || coalesce(f.cognome, '')) end asc nulls last,
      case when v_campo = 'nome'     and v_verso = 'desc' then lower(f.nome || ' ' || coalesce(f.cognome, '')) end desc nulls last,
      case when v_campo = 'telefono' and v_verso = 'asc'  then f.telefono end asc nulls last,
      case when v_campo = 'telefono' and v_verso = 'desc' then f.telefono end desc nulls last,
      case when v_campo = 'creato'   and v_verso = 'asc'  then f.created_at end asc nulls last,
      case when v_campo = 'creato'   and v_verso = 'desc' then f.created_at end desc nulls last,
      case when v_campo = 'n_appuntamenti' and v_verso = 'asc'  then f.n_appuntamenti end asc nulls last,
      case when v_campo = 'n_appuntamenti' and v_verso = 'desc' then f.n_appuntamenti end desc nulls last,
      case when v_campo = 'ultimo_appuntamento' and v_verso = 'asc'  then f.ultimo_appuntamento end asc nulls last,
      case when v_campo = 'ultimo_appuntamento' and v_verso = 'desc' then f.ultimo_appuntamento end desc nulls last,
      lower(f.nome || ' ' || coalesce(f.cognome, '')) asc
    offset (v_pag - 1) * v_per
    limit v_per
  )
  select jsonb_build_object(
           'ok', true,
           'totale', (select count(*) from filtrata),
           'clienti', coalesce((select jsonb_agg(riga) from fetta), '[]'::jsonb))
  into v_ris;

  return v_ris;
end $f$;

-- ------------------------------------------------------------------ salva
-- Crea (p_id nullo) o aggiorna (p_id pieno). Funzione NUOVA e non un overload
-- di crm_salva_cliente: un secondo crm_salva_cliente con firma diversa
-- renderebbe ambigue le chiamate dell'agenda — compresa la radice congelata,
-- che non si può toccare. Il telefono qui è obbligatorio (è la rubrica), a
-- differenza dell'agenda dove può mancare.

create or replace function public.crm_clienti_salva(
  p_centro uuid,
  p_nome text,
  p_cognome text default null,
  p_telefono text default null,
  p_email text default null,
  p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_id  uuid;
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return jsonb_build_object('ok', false, 'errore', 'nome_mancante');
  end if;
  if v_tel = '' then
    return jsonb_build_object('ok', false, 'errore', 'telefono_mancante');
  end if;
  if v_tel !~ '^\d{6,15}$' then
    return jsonb_build_object('ok', false, 'errore', 'telefono_non_valido');
  end if;

  if p_id is null then
    insert into crm.clienti (centro, nome, cognome, telefono, email)
    values (p_centro, trim(p_nome), nullif(trim(coalesce(p_cognome, '')), ''),
            v_tel, nullif(trim(coalesce(p_email, '')), ''))
    returning id into v_id;
  else
    update crm.clienti
       set nome = trim(p_nome),
           cognome = nullif(trim(coalesce(p_cognome, '')), ''),
           telefono = v_tel,
           email = nullif(trim(coalesce(p_email, '')), '')
     where id = p_id and centro = p_centro
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'errore', 'cliente_inesistente');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'errore', 'telefono_duplicato');
end $f$;

-- ---------------------------------------------------------------- eliminazione
-- Un cliente con appuntamenti non si elimina: la storia dell'agenda non si
-- butta (e c'è la FK a impedirlo comunque). Contano anche gli annullati.
-- La multipla elimina chi può e riporta gli id bloccati, così il sito può
-- dire "eliminati X, Y avevano appuntamenti".

create or replace function public.crm_clienti_elimina(
  p_centro uuid,
  p_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare
  v_bloccati uuid[];
  v_n int;
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;

  select coalesce(array_agg(distinct a.cliente), '{}')
    into v_bloccati
    from crm.appuntamenti a
   where a.centro = p_centro and a.cliente = any(coalesce(p_ids, '{}'));

  delete from crm.clienti
   where centro = p_centro and id = any(coalesce(p_ids, '{}'))
     and not (id = any(v_bloccati));
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'eliminati', v_n, 'bloccati', to_jsonb(v_bloccati));
end $f$;

-- -------------------------------------------------------------------- import
-- p_righe: array di { nome, cognome, telefono, email }. Il sito manda blocchi
-- da 500; il tetto a 2000 para le chiamate costruite a mano. Righe senza nome
-- o con telefono non valido, doppie nel file o già presenti in rubrica si
-- saltano: l'import non sovrascrive mai un cliente esistente.

create or replace function public.crm_clienti_importa(
  p_centro uuid,
  p_righe jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare
  v_tot int;
  v_importati int;
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' then
    return jsonb_build_object('ok', false, 'errore', 'righe_non_valide');
  end if;
  v_tot := jsonb_array_length(p_righe);
  if v_tot > 2000 then
    return jsonb_build_object('ok', false, 'errore', 'troppe_righe');
  end if;

  with grezze as (
    select trim(coalesce(r->>'nome', ''))                          as nome,
           nullif(trim(coalesce(r->>'cognome', '')), '')           as cognome,
           regexp_replace(coalesce(r->>'telefono', ''), '\D', '', 'g') as tel,
           nullif(trim(coalesce(r->>'email', '')), '')             as email
    from jsonb_array_elements(p_righe) r
  ), valide as (
    select distinct on (tel) nome, cognome, tel, email
    from grezze
    where nome <> '' and tel ~ '^\d{6,15}$'
    order by tel
  )
  insert into crm.clienti (centro, nome, cognome, telefono, email)
  select p_centro, v.nome, v.cognome, v.tel, v.email
  from valide v
  where not exists (select 1 from crm.clienti c
                    where c.centro = p_centro and c.telefono = v.tel);
  get diagnostics v_importati = row_count;

  return jsonb_build_object('ok', true, 'importati', v_importati,
                            'saltati', v_tot - v_importati);
end $f$;

-- ------------------------------------------------------------------ segmenti

-- Elenco come array puro, la convenzione degli elenchi semplici. A chi non è
-- membro non si dice niente: elenco vuoto.
create or replace function public.crm_segmenti(p_centro uuid)
returns table (id uuid, nome text, filtri jsonb)
language plpgsql stable security definer set search_path = '' as $f$
begin
  if not crm.utente_del_centro(p_centro) then return; end if;
  return query
    select s.id, s.nome, s.filtri
    from crm.segmenti_clienti s
    where s.centro = p_centro
    order by lower(s.nome);
end $f$;

create or replace function public.crm_segmenti_salva(
  p_centro uuid,
  p_nome text,
  p_filtri jsonb default '[]',
  p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare
  v_nome text := trim(coalesce(p_nome, ''));
  v_id uuid;
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  if v_nome = '' or length(v_nome) > 80 then
    return jsonb_build_object('ok', false, 'errore', 'nome_mancante');
  end if;

  if p_id is null then
    insert into crm.segmenti_clienti (centro, nome, filtri)
    values (p_centro, v_nome, coalesce(p_filtri, '[]'))
    returning id into v_id;
  else
    update crm.segmenti_clienti s
       set nome = v_nome, filtri = coalesce(p_filtri, '[]')
     where s.id = p_id and s.centro = p_centro
    returning s.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'errore', 'segmento_inesistente');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;

create or replace function public.crm_segmenti_elimina(
  p_centro uuid,
  p_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $f$
begin
  if not crm.utente_del_centro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  delete from crm.segmenti_clienti s where s.id = p_id and s.centro = p_centro;
  return jsonb_build_object('ok', true);
end $f$;

-- ------------------------------------------------------------------- permessi
-- Le wrapper le chiama solo chi ha una sessione; gli helper crm.* non li
-- chiama nessuno da fuori (PostgREST espone solo public, ed è voluto).

revoke all on function public.crm_clienti(uuid, text, jsonb, jsonb, int, int) from public, anon;
revoke all on function public.crm_clienti_salva(uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.crm_clienti_elimina(uuid, uuid[]) from public, anon;
revoke all on function public.crm_clienti_importa(uuid, jsonb) from public, anon;
revoke all on function public.crm_segmenti(uuid) from public, anon;
revoke all on function public.crm_segmenti_salva(uuid, text, jsonb, uuid) from public, anon;
revoke all on function public.crm_segmenti_elimina(uuid, uuid) from public, anon;

grant execute on function public.crm_clienti(uuid, text, jsonb, jsonb, int, int) to authenticated;
grant execute on function public.crm_clienti_salva(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.crm_clienti_elimina(uuid, uuid[]) to authenticated;
grant execute on function public.crm_clienti_importa(uuid, jsonb) to authenticated;
grant execute on function public.crm_segmenti(uuid) to authenticated;
grant execute on function public.crm_segmenti_salva(uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.crm_segmenti_elimina(uuid, uuid) to authenticated;

revoke all on function crm.clienti_condizione(jsonb, text, text, text, timestamptz, bigint, date) from public, anon, authenticated;
