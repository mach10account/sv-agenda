-- =============================================================================
-- Servizi — colonne e RPC per la sezione "Servizi" (dev/servizi.js)
--
-- NON ancora applicato al database: questa sessione non aveva accesso al
-- progetto Supabase, quindi i nomi della tabella dei trattamenti sono
-- ipotizzati sul modello di crm.clienti / crm.centri. Il blocco di guardia
-- qui sotto ferma tutto se non combaciano: in quel caso cercare la tabella
-- che crm_anagrafiche legge (quella con nome/durata dei trattamenti) e
-- adattare i nomi in questo file prima di rieseguirlo.
--
-- Rieseguibile: tutto è `create or replace` / `if not exists`.
--
-- Nomi presupposti (da verificare sul database reale):
--   crm.trattamenti(id, centro_id, nome, durata)   ← durata in minuti
--   crm.e_membro(uuid), crm.e_titolare(uuid)       ← helper già esistenti
--
-- Convenzioni (le stesse delle RPC esistenti):
--   · il frontend chiama solo wrapper sullo schema public;
--   · risposta { ok:true, ... } oppure { ok:false, errore:'codice' } — i codici
--     sono macchina-leggibili, i testi italiani vivono nel client.
-- =============================================================================

-- ---------------------------------------------------------------- guardia

do $$
begin
  if to_regclass('crm.trattamenti') is null then
    raise exception 'Adattare sql/servizi.sql: la tabella dei trattamenti non si chiama crm.trattamenti (cercare quella che crm_anagrafiche legge)';
  end if;
end $$;

-- ---------------------------------------------------------------- colonne

-- La tabella esiste già (la usa l'agenda): prezzo, colore e archiviazione
-- sono le sole novità che il listino richiede. Un servizio non si elimina
-- mai — gli appuntamenti passati lo nominano — si archivia.
alter table crm.trattamenti add column if not exists prezzo     numeric(8,2);
alter table crm.trattamenti add column if not exists colore     text;
alter table crm.trattamenti add column if not exists archiviato boolean not null default false;

-- ------------------------------------------------------------------ lettura

-- Tutto il listino, archiviati compresi: è la stessa schermata a mostrarli,
-- in fondo e spenti. Legge chiunque sia del centro, come l'agenda.
create or replace function public.crm_servizi(p_centro uuid)
returns jsonb
language plpgsql security definer set search_path = crm, public
as $$
declare
  v_servizi jsonb;
begin
  if not crm.e_membro(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         t.id,
           'nome',       t.nome,
           'durata',     t.durata,
           'prezzo',     t.prezzo,
           'colore',     t.colore,
           'archiviato', t.archiviato)
         order by t.nome), '[]'::jsonb)
    into v_servizi
    from crm.trattamenti t
   where t.centro_id = p_centro;

  return jsonb_build_object('ok', true, 'servizi', v_servizi);
end $$;

-- -------------------------------------------------------------- salvataggio

-- Crea o aggiorna (p_id nullo = nuovo). Solo la titolare: chi sta al bancone
-- i servizi li sceglie in agenda, non li cambia.
create or replace function public.crm_servizi_salva(
  p_centro uuid,
  p_nome   text,
  p_durata int,
  p_prezzo numeric,
  p_colore text,
  p_id     uuid default null
)
returns jsonb
language plpgsql security definer set search_path = crm, public
as $$
declare
  v_id uuid;
begin
  if not crm.e_titolare(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return jsonb_build_object('ok', false, 'errore', 'nome_mancante');
  end if;
  if p_durata is null or p_durata < 5 or p_durata > 480 then
    return jsonb_build_object('ok', false, 'errore', 'durata_non_valida');
  end if;
  if coalesce(p_prezzo, 0) < 0 then
    return jsonb_build_object('ok', false, 'errore', 'prezzo_non_valido');
  end if;

  if p_id is null then
    insert into crm.trattamenti (centro_id, nome, durata, prezzo, colore)
    values (p_centro, trim(p_nome), p_durata, coalesce(p_prezzo, 0), p_colore)
    returning id into v_id;
  else
    update crm.trattamenti t
       set nome   = trim(p_nome),
           durata = p_durata,
           prezzo = coalesce(p_prezzo, 0),
           colore = p_colore
     where t.id = p_id and t.centro_id = p_centro
    returning t.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'errore', 'servizio_inesistente');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ------------------------------------------------------------ archiviazione

-- Una funzione sola nei due versi: p_archivia true spegne, false riaccende.
create or replace function public.crm_servizi_archivia(
  p_centro   uuid,
  p_id       uuid,
  p_archivia boolean
)
returns jsonb
language plpgsql security definer set search_path = crm, public
as $$
declare
  v_id uuid;
begin
  if not crm.e_titolare(p_centro) then
    return jsonb_build_object('ok', false, 'errore', 'non_autorizzato');
  end if;

  update crm.trattamenti t
     set archiviato = p_archivia
   where t.id = p_id and t.centro_id = p_centro
  returning t.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'errore', 'servizio_inesistente');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------- permessi
-- Le wrapper le chiama solo chi ha una sessione; gli helper crm.* non li
-- chiama nessuno da fuori (PostgREST espone solo public, ed è voluto).

revoke all on function public.crm_servizi(uuid) from public, anon;
revoke all on function public.crm_servizi_salva(uuid, text, int, numeric, text, uuid) from public, anon;
revoke all on function public.crm_servizi_archivia(uuid, uuid, boolean) from public, anon;

grant execute on function public.crm_servizi(uuid) to authenticated;
grant execute on function public.crm_servizi_salva(uuid, text, int, numeric, text, uuid) to authenticated;
grant execute on function public.crm_servizi_archivia(uuid, uuid, boolean) to authenticated;
