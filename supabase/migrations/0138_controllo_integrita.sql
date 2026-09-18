-- =====================================================================
-- 0138 — l'integrità dei depositi si controlla da sola, ogni notte
-- =====================================================================
-- Perché. La promessa del progetto è che una manomissione si VEDA. I due
-- controlli che la mantengono — la catena delle impronte di ogni deliverable
-- (verifica_catena) e il manifesto di ogni pacchetto sigillato
-- (verifica_manifesto) — giravano però solo a richiesta, quando qualcuno
-- apriva la pagina del verbale. Su cento video quella pagina non la apre
-- nessuno: una rottura sarebbe rimasta invisibile finché non fosse servita
-- la prova, cioè nel momento peggiore.
--
-- Qui il controllo diventa un fatto notturno: una volta al giorno il
-- database ricontrolla tutto e scrive l'esito in una riga. Se qualcosa non
-- torna, l'accesso globale viene avvisato (email e notifica, dal cron Vercel
-- /api/cron/integrita: il database non manda email).
--
-- Cosa controlla:
--   1. la catena delle impronte di ogni deliverable, versione per versione;
--   2. l'impronta del manifesto di ogni pacchetto sigillato (anche
--      annullato: il suo verbale PEC è già partito);
--   3. che i file dei pacchetti sigillati esistano ancora nello storage e
--      abbiano la dimensione dichiarata.
--
-- Cosa NON può controllare, ed è bene saperlo: l'impronta del CONTENUTO dei
-- file grandi. Ricalcolarla significherebbe riscaricare centinaia di MB ogni
-- notte; quella prova vive nella PEC e nella copia di chi ha girato il video.
-- E una riscrittura coerente di dati e impronte, fatta da chi ha le chiavi
-- del database, passerebbe qualsiasi controllo interno (CONTESTO §11): è la
-- PEC a chiudere quel cerchio.
-- =====================================================================

-- ------------------------------------------------------------ il registro
-- Tabella separata dal registro degli eventi (audit_log) di proposito: una
-- riga per notte riempirebbe la vista del Registro, che mostra gli ultimi
-- eventi e serve a leggere le azioni delle persone, non i battiti del
-- sistema. Qui il controllo ha la sua casa, e la sezione "Integrità" del
-- Registro la legge.
create table if not exists public.controlli_integrita (
  id                        uuid primary key default gen_random_uuid(),
  eseguita_at               timestamptz not null default now(),
  -- 'cron' (sveglia nel database), 'cron-vercel' (sveglia dall'app quando
  -- quella nel database non è disponibile), 'manuale' (pulsante del Registro)
  origine                   text not null default 'cron',
  esito                     text not null,            -- 'integro' | 'problemi'
  deliverable_controllate   int not null default 0,
  versioni_controllate      int not null default 0,
  catene_rotte              int not null default 0,
  pacchetti_controllati     int not null default 0,
  manifesti_rotti           int not null default 0,
  file_mancanti             int not null default 0,
  file_dimensione_diversa   int not null default 0,
  -- Solo i problemi trovati (elenco corto, con l'identificativo di cosa non
  -- torna): null quando è tutto a posto, per non lasciare rumore da leggere.
  problemi                  jsonb,
  -- Quando l'accesso globale è stato avvisato di questi problemi (una volta
  -- sola: il cron non deve rispedire lo stesso avviso ogni ora).
  notificata_at             timestamptz
);

comment on table public.controlli_integrita is
  'Esito dei controlli automatici di integrità (catene di impronte, manifesti '
  'dei pacchetti sigillati, presenza dei file). Una riga per controllo: è un '
  'registro di battiti, non si modifica e non si cancella.';

alter table public.controlli_integrita enable row level security;

-- Lo legge solo chi ha accesso globale. Nessuna policy di scrittura: la riga
-- la scrive la funzione qui sotto (SECURITY DEFINER) e il cron, che passa
-- col service_role. L'assenza di policy di insert significa divieto totale
-- dal client, ed è il comportamento voluto.
drop policy if exists controlli_integrita_select on public.controlli_integrita;
create policy controlli_integrita_select on public.controlli_integrita
  for select using (public.is_admin());

revoke delete on public.controlli_integrita from authenticated, anon;
-- E nemmeno l'aggiornamento: il campo "avviso già mandato" lo scrive solo il
-- server. Se potesse scriverlo il client, chi ha accesso globale potrebbe
-- zittire l'avviso di una manomissione prima ancora di leggerlo.
revoke update on public.controlli_integrita from authenticated, anon;

-- -------------------------------------------------------------- il controllo
create or replace function public.controlla_integrita(p_origine text default 'cron')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_esito text;
  v_riassunto jsonb;
  v_deliverable int := 0;
  v_versioni int := 0;
  v_catene_rotte int := 0;
  v_pacchetti int := 0;
  v_manifesti_rotti int := 0;
  v_file_mancanti int := 0;
  v_size_diverse int := 0;
  v_problemi jsonb := '[]'::jsonb;
  v_meta jsonb;
  d record;
  c record;
  m record;
begin
  -- Il controllo si chiede dall'accesso globale o dal server: un
  -- Collaboratore non deve poter riempire di battiti il registro.
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'Operazione non disponibile da qui.' using errcode = '42501';
  end if;

  -- 1. La catena delle impronte, deliverable per deliverable
  for d in select id from public.deliverables loop
    v_deliverable := v_deliverable + 1;
    for c in select * from public.verifica_catena(d.id) loop
      v_versioni := v_versioni + 1;
      if not c.integra then
        v_catene_rotte := v_catene_rotte + 1;
        v_problemi := v_problemi || jsonb_build_object(
          'tipo', 'catena_rotta',
          'deliverable', d.id,
          'versione', c.version_no,
          'file', c.file_name
        );
      end if;
    end loop;
  end loop;

  -- 2. L'impronta del manifesto dei pacchetti sigillati (anche annullati:
  --    il loro verbale PEC è già partito, quindi la prova deve reggere)
  for m in
    select id, stato
      from public.pacchetti_video
     where manifest is not null
       and stato in ('sigillato', 'pec_inviata', 'pec_confermata', 'pec_errore', 'annullato')
  loop
    v_pacchetti := v_pacchetti + 1;
    select * into c from public.verifica_manifesto(m.id);
    if c.integro is not true then
      v_manifesti_rotti := v_manifesti_rotti + 1;
      v_problemi := v_problemi || jsonb_build_object(
        'tipo', 'manifesto_non_torna',
        'pacchetto', m.id,
        'stato', m.stato
      );
    end if;
  end loop;

  -- 3. I file dei pacchetti sigillati esistono ancora e hanno la stessa
  --    dimensione dichiarata? È l'unico controllo possibile senza
  --    riscaricare i file (l'impronta del contenuto la certifica la PEC).
  for m in
    select dv.id as version_id, dv.bucket, dv.storage_path, dv.size_bytes, pe.pacchetto_id
      from public.pacchetto_elementi pe
      join public.pacchetti_video pv on pv.id = pe.pacchetto_id
      join public.deliverable_versions dv on dv.id = pe.version_id
     where pv.stato in ('sigillato', 'pec_inviata', 'pec_confermata', 'annullato')
  loop
    select o.metadata into v_meta
      from storage.objects o
     where o.bucket_id = m.bucket and o.name = m.storage_path;

    if v_meta is null then
      v_file_mancanti := v_file_mancanti + 1;
      v_problemi := v_problemi || jsonb_build_object(
        'tipo', 'file_mancante',
        'pacchetto', m.pacchetto_id,
        'versione', m.version_id,
        'percorso', m.storage_path
      );
    elsif m.size_bytes is not null
      and (v_meta->>'size')::bigint is distinct from m.size_bytes then
      v_size_diverse := v_size_diverse + 1;
      v_problemi := v_problemi || jsonb_build_object(
        'tipo', 'dimensione_diversa',
        'pacchetto', m.pacchetto_id,
        'versione', m.version_id,
        'attesa', m.size_bytes,
        'trovata', v_meta->>'size'
      );
    end if;
  end loop;

  v_esito := case
    when v_catene_rotte + v_manifesti_rotti + v_file_mancanti + v_size_diverse = 0
    then 'integro' else 'problemi'
  end;

  insert into public.controlli_integrita (
    origine, esito, deliverable_controllate, versioni_controllate, catene_rotte,
    pacchetti_controllati, manifesti_rotti, file_mancanti, file_dimensione_diversa, problemi
  ) values (
    p_origine, v_esito,
    v_deliverable, v_versioni, v_catene_rotte,
    v_pacchetti, v_manifesti_rotti, v_file_mancanti, v_size_diverse,
    -- nulla quando è tutto a posto: un elenco vuoto non serve a nessuno
    nullif(v_problemi, '[]'::jsonb)
  );

  v_riassunto := jsonb_build_object(
    'esito', v_esito,
    'deliverable_controllate', v_deliverable,
    'versioni_controllate', v_versioni,
    'catene_rotte', v_catene_rotte,
    'pacchetti_controllati', v_pacchetti,
    'manifesti_rotti', v_manifesti_rotti,
    'file_mancanti', v_file_mancanti,
    'file_dimensione_diversa', v_size_diverse
  );
  return v_riassunto;
end $$;

comment on function public.controlla_integrita(text) is
  'Ricontrolla la catena delle impronte di ogni deliverable, l''impronta del '
  'manifesto di ogni pacchetto sigillato e la presenza dei file; scrive l''esito '
  'in controlli_integrita e lo restituisce. Solo accesso globale o server.';

grant execute on function public.controlla_integrita(text) to authenticated;

-- ---------------------------------------------------- la sveglia ogni notte
-- pg_cron è l'unico pezzo che potrebbe non essere disponibile: lo si prova a
-- creare e, se non riesce, la migrazione va comunque a buon fine. In quel caso
-- il controllo lo fa il cron Vercel /api/cron/integrita, che chiama questa
-- stessa funzione: la garanzia non dipende da quale delle due sveglie suona.
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'pg_cron non disponibile (%): il controllo lo fara'' il cron Vercel', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'controllo-integrita-notte') then
      perform cron.unschedule('controllo-integrita-notte');
    end if;
    perform cron.schedule(
      'controllo-integrita-notte',
      '0 4 * * *',
      'select public.controlla_integrita(''cron'');'
    );
    raise notice 'CONTROLLO NOTTURNO PROGRAMMATO: ogni notte alle 04:00';
  else
    raise notice 'pg_cron assente: il controllo lo fara'' il cron Vercel /api/cron/integrita';
  end if;
exception when others then
  raise notice 'sveglia notturna NON programmata (%): il controllo lo fara'' il cron Vercel', sqlerrm;
end $$;
