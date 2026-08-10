-- =====================================================================
-- 0030_pec_universitaria.sql — la PEC dei partecipanti deve essere
--                              la PEC dell'università
-- =====================================================================
-- Ogni partecipante deve avere la PEC emessa dal proprio ateneo (es.
-- nome.cognome@studenti.unime.it), non una PEC privata qualsiasi. I domini
-- ammessi sono configurati per gruppo (ogni gruppo = un ateneo).
-- =====================================================================

alter table public.poli
  add column if not exists domini_pec text[];

comment on column public.poli.domini_pec is
  'Domini PEC universitari ammessi per questo gruppo (es. studenti.unime.it). '
  'La PEC del partecipante deve appartenere a uno di questi domini.';

-- Valori iniziali: da verificare con gli atenei. Il controllo non blocca
-- se la lista è vuota (finché non viene confermata).
update public.poli set domini_pec = array['studenti.unime.it']      where slug = 'messina'   and domini_pec is null;
update public.poli set domini_pec = array['studenti.unige.it']      where slug = 'genova'    and domini_pec is null;
update public.poli set domini_pec = array['studenti.uninsubria.it'] where slug = 'insubria'  and domini_pec is null;
update public.poli set domini_pec = array['studenti.unimi.it']      where slug = 'milano'    and domini_pec is null;
update public.poli set domini_pec = array['studenti.unipa.it']      where slug = 'palermo'   and domini_pec is null;
update public.poli set domini_pec = array['studenti.unich.it']      where slug = 'chieti'    and domini_pec is null;
update public.poli set domini_pec = array['alu.ucam.edu']           where slug = 'spagna'    and domini_pec is null;

-- Helper SQL: la PEC appartiene a uno dei domini del gruppo?
create or replace function public.pec_universitaria_valida(p_polo uuid, p_pec text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case
      when pl.domini_pec is null or cardinality(pl.domini_pec) = 0 then true
      else exists (
        select 1
        from unnest(pl.domini_pec) as d
        where lower(split_part(lower(p_pec), '@', 2)) = lower(d)
           or lower(split_part(lower(p_pec), '@', 2)) like '%.' || lower(d)
      )
    end
  from public.poli pl
  where pl.id = p_polo;
$$;
