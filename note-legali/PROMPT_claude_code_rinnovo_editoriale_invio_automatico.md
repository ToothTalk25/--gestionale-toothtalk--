# Prompt per Claude Code — invio automatico del rinnovo dell'Accordo Editoriale

## Contesto

Nuovo documento redatto (fuori dal gestionale, in attesa di revisione legale finale di Enrico):
`DOCUMENTO 1bis - RINNOVO ACCORDO EDITORIALE (BOZZA).docx` — una pagina, sullo stesso schema del
Documento 5bis (rinnovo del Collaboratore Tecnico): identifica l'Accordo tramite l'impronta SHA-256
del documento originale (campo dedicato subito sotto l'identificazione delle parti), qualifica il
rinnovo come mera proroga e non novazione (art. 1230 c.c.), richiama gli articoli dell'Accordo che
restano vigenti (licenza IP Art. 4, GDPR Art. 6, riservatezza/rappresentanza Artt. 13-14, recesso e
cancellazione copie locali Art. 9).

A differenza del Collaboratore Tecnico, qui la modellazione dati esiste già per intero:
`profiles.accordo_sha256`, `rinnovo_path`, `rinnovo_sha256`, `rinnovo_caricato_at`,
`rinnovo_approvato_admin_at`, `accordo_scadenza` (0111_rinnovo_accordo.sql), il componente
`CaricaRinnovo.tsx` (upload lato Collaboratore) e l'azione `approvaRinnovoAccordo()`
(`actions-profilo.ts:2097`). Non serve nessuna nuova migrazione: solo due interventi mirati.

## Interventi richiesti

1. **Superficie per Enrico dell'hash da riportare sul Documento 1bis.** Oggi il rinnovo parte "fuori"
   dal gestionale: secondo il testo già mostrato al Collaboratore in `RinnovoAccordo.tsx`
   ("Enrico ti invierà il documento di rinnovo... firmalo... caricalo qui"), è Enrico a mandare per
   primo il Documento 1bis al Collaboratore. Prima di mandarlo deve poter copiare l'`accordo_sha256`
   di quel Collaboratore: aggiungi il campo, in chiaro e copiabile, nella vista admin dove Enrico vede
   il profilo del Collaboratore (o nella sezione `AccordiDaApprovare.tsx`/pannello admin equivalente),
   così non deve andare a cercarlo nel database ogni volta.
2. **`approvaRinnovoAccordo()` deve anche mandare il documento approvato al Collaboratore**, non solo
   aggiornare i campi in silenzio come fa oggi. Stesso schema già implementato per la controfirma
   (`caricaControfirmaAccordo`) e già richiesto per il Collaboratore Tecnico
   (`PROMPT_claude_code_rinnovo_tecnico_invio_automatico.md`): dopo aver spostato `accordo_scadenza` e
   azzerato `rinnovo_path`/`rinnovo_sha256`, invia PEC o email al Collaboratore (`profile.pec` se
   presente, altrimenti `profile.email`) con il documento di rinnovo appena approvato allegato,
   riusando `spedisciPec()` da `src/lib/pec.ts`. Traccia in `audit_log`
   (`action: "rinnovo_accordo_approvato"`, se non già tracciato — verifica prima di duplicare).
3. Non toccare `CaricaRinnovo.tsx` né il flusso di upload lato Collaboratore: resta invariato, cambia
   solo cosa succede DOPO l'approvazione.

## Verifica richiesta

1. Giro di prova end-to-end (progetto Frankfurt): un profilo di test con accordo scaduto carica un
   rinnovo, Enrico lo approva, verifica che la PEC/email arrivi con l'allegato corretto e che
   `accordo_scadenza` si sposti di 6 mesi dalla data di approvazione.
2. Verifica che l'`accordo_sha256` mostrato ad Enrico nella vista admin corrisponda esattamente
   all'hash del file effettivamente in storage per quel profilo.
3. `npx tsc --noEmit` e `npm run build` puliti.

Non committare né pushare senza il mio ok esplicito.
