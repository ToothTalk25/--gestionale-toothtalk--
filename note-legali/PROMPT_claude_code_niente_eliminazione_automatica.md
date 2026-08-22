Contesto: l'Accordo Editoriale (Art. 7.3, 7.4, 8.2) è già stato corretto
per rimuovere ogni promessa di cancellazione automatica del materiale
grezzo alla revoca del consenso. Il motivo è un difetto di design
concreto, non teorico:

`revoca_video_on_screen(p_user uuid)` (migrazione 0089) purga i file
`video_grezzo`/`audio` filtrando per `uploaded_by = p_user` — cioè per
CHI HA CARICATO il file, non per chi vi compare. Se Luca carica un
girato in cui compare anche Laura, e Luca revoca il consenso ma Laura
no, la funzione cancella comunque il materiale che ritrae Laura, che
non ha chiesto nulla. Al contrario, se è Laura a revocare ma il file lo
ha caricato Luca, non viene cancellato nulla, perché il sistema non ha
modo di sapere che Laura compare in quel file. Il gestionale non può
identificare tecnicamente chi è ritratto in un file — solo chi lo ha
caricato — quindi nessuna cancellazione basata su quel dato può essere
automatica. Deve sempre passare da una verifica umana del Coordinatore.

Questo vale per ENTRAMBI gli ambiti di revoca già esistenti nel flusso:
revoca del solo materiale grezzo (sempre dovuta) e revoca che include
anche la richiesta di rimozione del pubblicato (su richiesta esplicita,
già gestita da `richieste_rimozione_pubblicato`, 0089 — quel pezzo va
bene così com'è, è già "valutazione caso per caso", non automatico).
Il pezzo da correggere è SOLO quello del grezzo, che oggi è automatico
e non dovrebbe esserlo.

**Prima di tutto**: verifica se `revoca_video_on_screen` ha già
eseguito cancellazioni reali in produzione (query su
`deliverable_versions` dove `revocato_gdpr = true`, incrociata con
`richieste_rimozione_pubblicato`/consensi revocati per capire quante
revoche sono già passate da quella RPC). Se sì, il difetto è già
operativo, non solo teorico — riferiscilo a Enrico prima di procedere,
indipendentemente dal resto di questo prompt. In ogni caso, il primo
commit di questo lavoro deve disattivare la chiamata automatica: non
aspettare che l'intera UI di revisione (punto 2 sotto) sia pronta prima
di fermare l'auto-cancellazione — quella è la parte urgente, il resto
può seguire.

## 1. `src/app/actions-profilo.ts` — `revocaImmagineVoce`

Oggi (righe ~264-270) chiama subito `supabase.rpc("revoca_video_on_screen", { p_user: profile.id })`,
che marca `revocato_gdpr = true` e imposta lo stato dei task a
`archived_due_to_revocation` in automatico, per tutti i file caricati
dall'utente. Questo va rimosso da qui.

Al suo posto, la funzione deve SEMPRE (non solo se
`richiediRimozionePubblicato`) aprire una richiesta di revisione
manuale per l'ambito grezzo, con termine di 30 giorni — lo stesso
schema già usato da `richieste_rimozione_pubblicato`, che ha
`termine_scadenza default (now() + interval '30 days')`,
`stato aperta/risolta`, RLS select-self-or-admin /
insert-self-or-admin / update-admin-only, e un trigger guard che
blocca la modifica dei campi originali e imposta `risolta_at`/
`risolta_da` alla chiusura.

Consiglio (non vincolante, valuta tu la soluzione migliore): una
nuova tabella `richieste_eliminazione_grezzo`, stesso pattern di
`richieste_rimozione_pubblicato` ma senza il tipo `esito_rimozione`
(che ha senso per contenuto pubblicato — rimosso/oscurato/rifiutato —
meno per grezzo, dove l'esito è più semplice: quali file sono stati
individuati ed eliminati, quali no e perché). Campi minimi: `id`,
`user_id` (chi ha revocato — cioè chi compare, non chi ha caricato),
`richiesto_at`, `termine_scadenza` (30gg), `stato`
(`aperta`/`risolta`), `versioni_eliminate` (array di `version_id`,
popolato solo alla chiusura), `note_coordinatore`, `risolta_da`,
`risolta_at`. Stesso trigger-guard pattern di `fn_rimozione_guard`.

`revocaImmagineVoce` diventa quindi: 1) marca il consenso come
revocato (invariato); 2) inserisce sempre una riga in
`richieste_eliminazione_grezzo`; 3) se `richiediRimozionePubblicato`,
apre anche la pratica su `richieste_rimozione_pubblicato` (invariato).
Il valore di ritorno `versioniPurgate` non ha più senso a questo punto
del flusso — nulla è stato ancora eliminato — sostituiscilo con
qualcosa come `richiestaGrezzoAperta: true`.

## 2. Nuova azione admin: revisione ed eliminazione manuale del grezzo

Serve un'azione (es. `eseguiEliminazioneGrezzo(richiestaId, versionIds: string[])`,
admin-only) che: mostra al Coordinatore i file `video_grezzo`/`audio`
candidati — puoi usare `uploaded_by = user_id della richiesta` SOLO
come filtro di partenza per restringere la lista da controllare a
schermo, mai come criterio automatico di cancellazione — il
Coordinatore deve poter vedere/scaricare i file e decidere a occhio
quali ritraggono davvero la persona che ha revocato, poi selezionarli
esplicitamente. Solo i `versionIds` selezionati vengono marcati
`revocato_gdpr = true` (puoi riusare `revoca_video_on_screen` come RPC
di esecuzione, ma modificata per accettare un array di `version_id`
espliciti invece di filtrare per `uploaded_by` — restringi il
permesso a `is_admin()` soltanto, visto che ora non è più
un'auto-revoca self-service). Alla fine, la funzione chiude la riga in
`richieste_eliminazione_grezzo` (stato `risolta`, `versioni_eliminate`
popolato, `risolta_da`/`risolta_at`).

UI: estendi il pattern già usato da `NotificheDovuteArt82.tsx`/sezione
admin — una lista di richieste aperte con countdown ai 30 giorni, e per
ciascuna un modo di aprire i file candidati e confermare la selezione.
Non è necessario che sia elaborata: anche una tabella con link ai file
e checkbox è sufficiente per ora.

## 3. Testi da allineare (perché promettono ancora cancellazione automatica)

Questi tre punti sono diretta conseguenza del punto 1 — se non li
correggi, il codice smette di cancellare in automatico ma il testo
continua a dire che lo fa, il che è esattamente l'incoerenza che ha
fatto scoprire il problema originale:

- `src/components/ProfiloPersonale.tsx` righe ~91-95: il testo del
  `confirm()` dice "verrà eliminato definitivamente, sempre e senza
  bisogno di confermarlo di nuovo" — va cambiato in qualcosa come "verrà
  individuato ed eliminato dal Coordinatore entro 30 giorni, previa
  verifica di quali file ti ritraggono davvero".
- Stesso file, righe ~413-417 (banner informativo nella pagina): stessa
  correzione.
- Stesso file, riga ~115: il messaggio di esito
  `` `Consenso a immagine/voce revocato. ${esito.dati.versioniPurgate} file grezzi non pubblicati eliminati.` ``
  non ha più senso — sostituiscilo con qualcosa come "Consenso a
  immagine/voce revocato. Il Coordinatore individuerà ed eliminerà il
  materiale grezzo che ti ritrae entro 30 giorni."
- `src/lib/informativa-privacy.ts` riga 84, dentro "Consenso per chi
  appare nei contenuti": "La revoca comporta la cancellazione
  immediata del materiale grezzo non pubblicato" va sostituito con "La
  revoca comporta l'individuazione e la cancellazione, da parte del
  Coordinatore, del materiale grezzo non pubblicato che ti ritrae,
  entro 30 (trenta) giorni dalla revoca — non è una cancellazione
  automatica: il sistema registra chi ha caricato un file, non chi vi
  compare, quindi la verifica di quali file eliminare è sempre umana."
  (testo indicativo, allinealo a quello che scrivi nei punti 1-2 se usi
  parole diverse).

## 4. Test

1. Utente A revoca senza chiedere rimozione pubblicato: nessun file
   viene marcato `revocato_gdpr` subito; si apre una riga in
   `richieste_eliminazione_grezzo` con `termine_scadenza` a 30 giorni.
2. L'admin apre la richiesta, vede la lista dei file candidati (filtrata
   per chi li ha caricati, ma senza cancellazione automatica), seleziona
   solo quelli che davvero ritraggono l'utente A, conferma: solo quei
   `version_id` vengono marcati `revocato_gdpr = true`, la richiesta
   passa a `risolta`.
3. Verifica che un file caricato da un altro utente B che ritrae
   ANCHE l'utente A, ma dove B non ha revocato nulla, non venga toccato
   a meno che l'admin non lo selezioni esplicitamente dalla lista.
4. `tsc --noEmit` pulito.
