-- =====================================================================
-- 0049_verifiche_riconoscimento.sql
-- Tabella per i risultati del controllo automatico di riconoscimento
-- persone esterne (Fase D). La Edge Function di IA scrive qui l'esito
-- dopo aver confrontato i frame del video con le foto profilo dei
-- partecipanti che hanno dato il consenso 'riconoscimento_foto'.
-- =====================================================================

create table if not exists public.verifiche_riconoscimento (
  id            uuid primary key default gen_random_uuid(),
  pacchetto_id  uuid not null references public.pacchetti_video(id) on delete cascade,
  esito         text not null check (esito in ('nessuna_persona_esterna', 'persona_non_riconosciuta', 'errore')),
  dettaglio     text,
  corretto_da   uuid references public.profiles(id),
  creato_at     timestamptz not null default now()
);

create index if not exists idx_verifiche_riconoscimento_pacchetto
  on public.verifiche_riconoscimento(pacchetto_id, creato_at desc);

alter table public.verifiche_riconoscimento enable row level security;

drop policy if exists verifiche_riconoscimento_select on public.verifiche_riconoscimento;
create policy verifiche_riconoscimento_select on public.verifiche_riconoscimento
  for select to authenticated
  using (
    exists (
      select 1 from public.pacchetti_video pv
      join public.tasks t on t.id = pv.task_id
      where pv.id = pacchetto_id and public.can_read_polo(t.polo_id)
    )
  );

comment on table public.verifiche_riconoscimento is
  'Esito del controllo automatico IA: riconoscimento di persone esterne nei frame del video.';
