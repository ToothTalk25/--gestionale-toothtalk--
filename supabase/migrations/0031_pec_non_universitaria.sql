-- =====================================================================
-- 0031_pec_non_universitaria.sql — basta che sia una PEC vera, di
--                                  qualunque intestatario
-- =====================================================================
-- 0030 legava la PEC del partecipante al dominio del proprio ateneo, ma
-- gli atenei italiani in genere non forniscono una PEC personale agli
-- studenti: quel vincolo avrebbe bloccato quasi tutti.
--
-- Nuovo criterio: non importa chi ha intestato la PEC (personale, di un
-- familiare, condivisa) — basta che sia una PEC vera, non un indirizzo
-- email qualunque. Una email gratuita (Gmail, Outlook, ecc.) non può
-- esserlo per definizione: la PEC è un servizio a pagamento erogato da un
-- gestore accreditato. Si scartano quindi solo i domini di posta
-- gratuita più diffusi; qualunque altro dominio passa, perché non è
-- possibile verificare l'accreditamento PEC di un dominio dalla sola
-- stringa dell'indirizzo.
--
-- La funzione mantiene nome e firma di prima (stesso punto di chiamata
-- in actions-profilo.ts): cambia solo cosa fa dentro.
-- =====================================================================

create or replace function public.pec_universitaria_valida(p_polo uuid, p_pec text)
returns boolean
language sql stable as $$
  select lower(split_part(lower(btrim(p_pec)), '@', 2)) not in (
    'gmail.com', 'googlemail.com',
    'outlook.com', 'outlook.it', 'hotmail.com', 'hotmail.it', 'live.com', 'live.it', 'msn.com',
    'yahoo.com', 'yahoo.it', 'ymail.com',
    'icloud.com', 'me.com', 'mac.com',
    'libero.it', 'virgilio.it', 'tin.it', 'alice.it', 'tiscali.it', 'fastwebnet.it', 'inwind.it',
    'aol.com', 'protonmail.com', 'gmx.com'
  );
$$;

comment on function public.pec_universitaria_valida(uuid, text) is
  'Nonostante il nome (rimasto per compatibilità), non verifica più il '
  'legame con un ateneo: scarta solo i domini di posta gratuita più '
  'diffusi. Qualunque altra PEC, di qualsiasi intestatario, è ammessa.';
