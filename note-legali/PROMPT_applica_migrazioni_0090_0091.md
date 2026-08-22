Applica al database reale le migrazioni `0090_notifica_art82.sql`,
`0091_dichiarazione_identita_riservata.sql`,
`0092_dichiarazione_in_pacchetto_enum.sql` e
`0093_dichiarazione_in_pacchetto.sql`, già scritte in
`supabase/migrations/`. Poi verifica che tutto funzioni:

1. `npm run migra` (o il comando equivalente del progetto) per applicare
   entrambe le migrazioni in ordine.
2. Verifica che le nuove tabelle esistano: `notifiche_dovute_art82` e le
   RLS policy `originali_select` / `versions_select` aggiornate (la
   funzione `storage_dichiarazione_riservata` deve esistere in `public`).
3. Test funzionale minimo:
   - Un Collaboratore con `on_screen = true` revoca il consenso a
     immagine/voce SENZA spuntare "chiedi anche rimozione pubblicato":
     deve comparire una riga in `notifiche_dovute_art82` per il suo
     user_id, con `scade_at` a 30 giorni da ora.
   - Dalla pagina admin, sezione "Notifiche dovute (Art. 8.2)", il bottone
     "Notifica" deve mandare l'email e marcare `notificata_at`.
   - Crea un task con `coinvolge_terzi = true`, inserisci un'email di
     contatto per la liberatoria (senza cliccare nessun bottone admin):
     verifica che `richieste_liberatoria` riceva una riga automaticamente
     e che l'email/PEC parta da sola (log "Email non configurata" in dev
     va bene, basta vedere il link generato).
   - Con un secondo account NON admin e non uploader, verifica di NON
     riuscire più a scaricare il file `video_grezzo` di quel task (la
     policy `storage_dichiarazione_riservata` deve bloccarlo), mentre
     l'account che l'ha caricato e l'admin devono ancora vederlo.
   - Verifica che un task con `coinvolge_terzi = false` NON sia toccato
     dalla nuova restrizione: il video_grezzo resta visibile a tutto il
     polo come prima.
   - Su un task con `coinvolge_terzi = true`, carica un video_grezzo:
     deve comparire la conferma "questo file contiene la dichiarazione
     di identità...". Confermando, deve comparire una riga in
     `pacchetto_elementi` con `ruolo = 'dichiarazione_identita'` che
     punta alla STESSA `deliverable_versions.id` appena caricata (non
     un file duplicato).
   - Prova a sigillare quel pacchetto SENZA aver confermato la
     dichiarazione: `sigilla_pacchetto` deve rifiutare con l'errore
     "manca il file con la dichiarazione di identità...". Confermala e
     riprova: deve sigillare, e il manifesto (`pacchetto.manifest`)
     deve contenere un elemento con `ruolo: "dichiarazione_identita"`.

Se qualcosa fallisce, il contesto completo (perché ogni pezzo esiste, i
riferimenti agli articoli dell'Accordo/Protocollo) è nei commenti in testa
a ciascuna migrazione — non serve rifare l'analisi da capo.
