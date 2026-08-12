-- =====================================================================
-- 0051_metodo_firma_liberatoria.sql
-- Aggiunge la tracciabilità del metodo di firma: OTP (email), canvas
-- o upload manuale. Necessario per sigilla_pacchetto: solo le
-- liberatorie firmate via OTP sbloccano il sigillo.
-- =====================================================================

alter table public.richieste_liberatoria
  add column if not exists metodo_firma text
  check (metodo_firma in ('otp', 'canvas', 'upload_manuale'));

create or replace function public.registra_upload_liberatoria(
  p_token    text,
  p_version  uuid,
  p_metodo   text default 'upload_manuale'
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.richieste_liberatoria
     set stato = 'caricata',
         version_id = p_version,
         caricato_at = now(),
         metodo_firma = p_metodo
   where token = p_token and stato = 'inviata';

  if not found then
    raise exception 'Token non valido, gia usato o scaduto';
  end if;
end $$;

grant execute on function public.registra_upload_liberatoria(text, uuid, text) to anon;
