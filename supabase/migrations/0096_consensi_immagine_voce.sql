-- =====================================================================
-- 0096_consensi_immagine_voce.sql — consenso immagine/voce nel registro
-- =====================================================================
-- Bug confermato: consensi.tipo ammette solo ('privacy','cookie',
-- 'riconoscimento_foto') e nessun percorso di codice inserisce mai una
-- riga di consenso 'immagine_voce'. La revoca (revoca_consenso) quindi
-- aggiornava ZERO righe: il consenso si considerava prestato con la firma
-- dell'Accordo (Art. 7.1) ma non era mai registrato, rendendo impossibile
-- dimostrare quando è stato dato e quando ritirato (artt. 5(2) e 7(1) GDPR).
--
-- Due interventi:
--   1. estende il CHECK per ammettere 'immagine_voce';
--   2. backfill: per i collaboratori GIÀ attivi con accordo approvato
--      inserisce la riga di concessione (con data = approvazione accordo).
--      Per i nuovi, la riga la inserisce approvaAccordoManualmente
--      (modifica applicativa, vedi actions-profilo.ts).
-- =====================================================================

alter table public.consensi drop constraint if exists consensi_tipo_check;
alter table public.consensi
  add constraint consensi_tipo_check
  check (tipo in ('privacy', 'cookie', 'riconoscimento_foto', 'immagine_voce'));

comment on column public.consensi.tipo is
  'Tipi di consenso tracciati: privacy, cookie, riconoscimento_foto (legacy, '
  'rimosso dal flusso) e immagine_voce (concesso con la firma dell''Accordo, '
  'revocabile dal profilo — vedi Art. 7.1/8.1 Accordo Editoriale).';

insert into public.consensi (user_id, tipo, versione, accettato_at)
select p.id, 'immagine_voce', 'implicito', p.accordo_approvato_admin_at
  from public.profiles p
 where p.accordo_approvato_admin_at is not null
   and p.attivo = true
   and p.role <> 'admin'
   and not exists (
     select 1 from public.consensi c
      where c.user_id = p.id and c.tipo = 'immagine_voce'
   );
