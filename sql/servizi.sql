-- =============================================================================
-- Servizi — RPC per la sezione "Servizi" (dev/servizi.js)
--
-- Applicato al database il 7/8/2026, dopo aver verificato i nomi veri.
-- La tabella dei trattamenti esiste già e NON è come l'aveva ipotizzata la
-- prima stesura di questo file:
--
--   crm.trattamenti(id, centro_id, nome, durata_minuti,
--                   prezzo numeric NULL, colore text NOT NULL default '#6B4E9B',
--                   attivo boolean NOT NULL default true)
--
-- Quindi niente colonne nuove: `prezzo` e `colore` ci sono già, e al posto di
-- `archiviato` c'è `attivo`, al contrario. Le RPC traducono: verso il sito
-- parlano di `archiviato` (è il linguaggio della schermata), dentro scrivono
-- `attivo` (è quello che crm_anagrafiche e l'agenda leggono da sempre —
-- una seconda colonna con lo stesso significato sarebbe la ricetta per
-- ritrovarle in disaccordo).
--
-- Rieseguibile: tutto è `create or replace`.
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
    raise exception 'La tabella crm.trattamenti non esiste piu: adattare sql/servizi.sql';
  end if;
  perform 1 from information_schema.columns
   where table_schema = 'crm' and table_name = 'trattamenti'
     and column_name = 'durata_minuti';
  if not found then
    raise exception 'crm.trattamenti non ha durata_minuti: adattare sql/servizi.sql';
  end if;
end $$;

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
           'durata',     t.durata_minuti,
           'prezzo',     t.prezzo,
           'colore',     t.colore,
           'archiviato', not t.attivo)
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
  v_id     uuid;
  v_colore text := upper(nullif(btrim(coalesce(p_colore, '')), ''));
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
  -- Il colore finisce in uno style inline dell'agenda: o è un #RRGGBB o
  -- non entra. Se non arriva, sul nuovo vale il default della tabella e
  -- sull'aggiornamento resta quello che c'era.
  if v_colore is not null and v_colore !~ '^#[0-9A-F]{6}$' then
    return jsonb_build_object('ok', false, 'errore', 'colore_non_valido');
  end if;

  if p_id is null then
    insert into crm.trattamenti (centro_id, nome, durata_minuti, prezzo, colore)
    values (p_centro, trim(p_nome), p_durata, coalesce(p_prezzo, 0),
            coalesce(v_colore, '#6B4E9B'))
    returning id into v_id;
  else
    update crm.trattamenti t
       set nome          = trim(p_nome),
           durata_minuti = p_durata,
           prezzo        = coalesce(p_prezzo, 0),
           colore        = coalesce(v_colore, t.colore)
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
-- Sotto è la colonna `attivo` a muoversi: sparire da crm_anagrafiche (e
-- quindi dal modale appuntamento dell'agenda) è esattamente l'effetto voluto.
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
     set attivo = not p_archivia
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
