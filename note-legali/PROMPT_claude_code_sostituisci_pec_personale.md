# Prompt per Claude Code — sostituisci la PEC personale del Titolare nei testi legali

## Contesto

Nei testi pubblici (Documento 2 già corretto a parte, in .docx/.pdf) e nel codice
compare `enricomariaguarino@postecertifica.it` come PEC di contatto per l'esercizio
dei diritti GDPR. Enrico ha attivato ed effettivamente controlla in ricezione una PEC
brandizzata, `toothtalk@pec.it` (Aruba) — già usata dal gestionale per l'invio (vedi
`PEC_USER`/`PEC_MITTENTE` in `.env.local`, letta da `pec.ts:52-56`). Va usata anche
come recapito pubblico nei testi, al posto di quella personale.

Nome, C.F. e l'email `tooth.talk25@gmail.com` (già sostituita in un fix precedente)
restano invariati — questo prompt tocca solo le occorrenze della PEC.

## Modifiche richieste

Sostituisci `enricomariaguarino@postecertifica.it` con `toothtalk@pec.it` in:

1. `src/lib/liberatoria-documento2.ts`
   - Riga 13 (Sezione 1, punto 1 "Titolare del trattamento")
   - Riga 22 (Sezione 1, punto 10 "Esercizio dei diritti")
2. `src/lib/informativa-privacy.ts`
   - Riga 20 (blocco Titolare)
   - Riga 77 ("Per esercitarli, scrivi a...")
   - Riga 87 (paragrafo "Revoca del consenso...", dove compare "alla PEC
     enricomariaguarino@postecertifica.it")
3. `src/app/termini/page.tsx`
   - Riga 108 ("Contatto: ... (PEC: enricomariaguarino@postecertifica.it)")

Non toccare nient'altro in questi file.

## Verifica richiesta

1. `grep -rn "enricomariaguarino@postecertifica.it" src/` deve dare zero risultati.
2. `npx tsc --noEmit` e `npm run build` puliti.
3. Rendering di `/privacy` e `/termini`: conferma visiva che mostrino
   `toothtalk@pec.it` al posto della PEC personale.

Non committare né pushare senza il mio ok esplicito.
