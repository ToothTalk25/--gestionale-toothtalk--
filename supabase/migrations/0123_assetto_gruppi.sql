-- =====================================================================
-- 0123_assetto_gruppi.sql — gruppi reali: Messina ripulita, Genova pronta
-- =====================================================================
-- Le appartenenze di prova (account .local e +test…) non rappresentano
-- persone: lasciarle dentro gonfia il conteggio dei partecipanti e fa
-- credere che un gruppo abbia membri che non esistono. Restano solo le
-- appartenenze reali.
--
-- L'accesso globale resta quello che è (role = admin, non si tocca): qui
-- si aggiunge soltanto l'appartenenza al gruppo Genova, così chi ha
-- accesso globale può lavorare con quel gruppo anche dal lato
-- partecipante (deposito dei materiali, composizione del pacchetto).
-- È il doppio ruolo: il gruppo lo vede come uno dei suoi, la piattaforma
-- continua a riconoscergli l'accesso globale.
-- =====================================================================

delete from public.memberships m
using public.profiles p
where p.id = m.user_id
  and m.polo_id = (select id from public.poli where slug = 'messina')
  and p.email in (
    'test@toothtalk.local',
    'enricoguarino25+testcontrofirma@gmail.com',
    'enricoguarino2@gmail.com'
  );

insert into public.memberships (user_id, polo_id)
select p.id, po.id
  from public.profiles p
  join public.poli po on po.slug = 'genova'
 where p.email = 'enricoguarino25@gmail.com'
on conflict (user_id, polo_id) do nothing;
