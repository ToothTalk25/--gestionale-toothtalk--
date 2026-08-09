-- =====================================================================
-- 0008_polo_spagna.sql — nome corretto del polo internazionale
-- =====================================================================
-- 0007_poli.sql aveva inserito un polo "Spagna" generico, senza città,
-- in attesa di sapere quale ateneo fosse davvero. È la UCAM — Universidad
-- Católica San Antonio de Murcia.
-- =====================================================================

update public.poli
   set nome = 'UCAM Universidad',
       citta = 'Murcia'
 where slug = 'spagna';
