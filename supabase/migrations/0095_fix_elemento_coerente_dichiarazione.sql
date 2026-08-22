-- =====================================================================
-- 0095_fix_elemento_coerente_dichiarazione.sql — la dichiarazione di
--                                                identità punta al grezzo
-- =====================================================================
-- 0093 ha aggiunto il ruolo 'dichiarazione_identita' a pacchetto_elementi
-- e lo richiede per il sigillo dei task con persone esterne coinvolte
-- (Art. 4.1 Protocollo Operativo): quell'elemento deve essere un
-- RIFERIMENTO alla stessa riga di deliverable_versions del video/audio
-- grezzo che contiene la dichiarazione di identità e recapito — non una
-- copia in bucket finali (anzi, proprio perché contiene dati di un terzo,
-- resta nel bucket originali con la visibilità ristretta di 0091).
--
-- Ma il trigger fn_elemento_coerente (0006/0016) impone ancora che OGNI
-- elemento del pacchetto punti a un file del bucket 'finali' ("Nel video
-- completo entrano solo i file caricati come materiale finale"). La 0093
-- non lo ha rilassato: così l'inserimento della dichiarazione veniva
-- SEMPRE respinto e il sigillo dei task con terzi diventava impossibile
-- (bloccato prima ancora del controllo sul ruolo mancante).
--
-- Questa migrazione apre UNA sola eccezione: il ruolo
-- 'dichiarazione_identita' può (e deve) puntare a un video_grezzo o audio
-- del bucket 'originali' (origin='originale'). Per tutti gli altri ruoli
-- (video, copertina, liberatoria) resta invariato l'obbligo di bucket
-- 'finali'.
-- =====================================================================

create or replace function public.fn_elemento_coerente()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task_pacchetto uuid;
  v_task_versione  uuid;
  v_origin public.version_origin;
  v_bucket text;
  v_kind   text;
begin
  select task_id into v_task_pacchetto from public.pacchetti_video where id = new.pacchetto_id;

  select d.task_id, v.origin, v.bucket, d.kind
    into v_task_versione, v_origin, v_bucket, v_kind
  from public.deliverable_versions v
  join public.deliverables d on d.id = v.deliverable_id
  where v.id = new.version_id;

  if v_task_versione is distinct from v_task_pacchetto then
    raise exception 'Il file non appartiene a questo progetto' using errcode = '42501';
  end if;

  -- La dichiarazione di identità è l'unico elemento che punta al grezzo
  -- (video_grezzo/audio del bucket originali), non a un materiale finale.
  if new.ruolo = 'dichiarazione_identita' then
    if v_origin <> 'originale' or v_bucket <> 'originali' or v_kind not in ('video_grezzo', 'audio') then
      raise exception 'La dichiarazione di identità deve puntare a un video o audio grezzo (bucket originali)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_origin <> 'originale' or v_bucket <> 'finali' then
    raise exception 'Nel video completo entrano solo i file caricati come materiale finale'
      using errcode = '42501';
  end if;
  return new;
end $$;
