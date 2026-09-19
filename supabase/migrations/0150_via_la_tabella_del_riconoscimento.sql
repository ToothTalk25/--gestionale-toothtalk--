-- =====================================================================
-- 0150_via_la_tabella_del_riconoscimento.sql
-- =====================================================================
-- Perché. La tabella `verifiche_riconoscimento` (migrazione 0049) serviva al
-- confronto automatico dei volti fra i video e le foto del profilo. Quella
-- funzione è stata **rimossa dal codice** dopo l'audit GDPR — non disattivata,
-- rimossa — perché l'informativa privacy dichiarava assente ogni trattamento
-- automatico di riconoscimento facciale, mentre la funzione lo effettuava.
--
-- La tabella è rimasta: **vuota** (0 righe, verificato) e non citata da nessuna
-- parte del codice. In sé non fa danno, ma davanti a un controllo è la prima
-- cosa che fa chiedere «e questo che cos'è?»: meglio un commento che lo spiega
-- (questo file) che un oggetto che lascia il dubbio.
--
-- Se un giorno servisse una verifica sul riconoscimento delle persone, non va
-- ricreata qui: un sistema del genere ricade fra quelli ad alto rischio
-- dell'Allegato III del regolamento europeo sull'IA, e richiede una procedura
-- tutta diversa (vedi IA-NEL-GESTIONALE.md, §4).
-- =====================================================================

drop table if exists public.verifiche_riconoscimento;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'verifiche_riconoscimento'
  ) then
    raise exception 'La tabella del riconoscimento esiste ancora.';
  end if;
  raise notice 'Tabella del riconoscimento rimossa (era vuota e non usata).';
end;
$$;
