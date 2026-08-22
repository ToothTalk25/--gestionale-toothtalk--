Contesto: il Protocollo Operativo (Art. 4.1) prevede ora un "video di
dichiarazione" — un video breve, separato dall'intervista, in cui la
persona intervistata dichiara nome, contatto e le domande specifiche a
cui risponderà. Questo video deve finire nel pacchetto da sigillare (con
liberatoria, video montato, copertina), non essere mai visibile agli
altri Collaboratori, ed essere archiviato su Drive in una cartella
dedicata "Dichiarazioni" al momento del sigillo.

Parte dell'infrastruttura è GIÀ SCRITTA in questo repo (non riscriverla,
solo verificarla/applicarla):

- `supabase/migrations/0090_notifica_art82.sql` — tabella
  `notifiche_dovute_art82` (obbligo Art. 8.2 dell'Accordo, non
  correlato a questo task ma da applicare insieme).
- `supabase/migrations/0091_dichiarazione_identita_riservata.sql` —
  funzione `storage_dichiarazione_riservata(name)` + policy RLS che
  restringono la visibilità dei file `video_grezzo`/`audio` (bucket
  `originali`) ai task con `coinvolge_terzi = true`: solo chi li ha
  caricati e l'admin li vedono (sia lo storage sia i metadati in
  `deliverable_versions`).
- `supabase/migrations/0092_dichiarazione_in_pacchetto_enum.sql` —
  aggiunge `'dichiarazione_identita'` all'enum `ruolo_elemento`. **Deve
  girare DA SOLO**, in una migrazione a parte (Postgres non permette di
  usare un valore di enum appena creato nella stessa transazione — vedi
  commento nel file e il precedente analogo `0012_enum_liberatoria.sql`).
- `supabase/migrations/0093_dichiarazione_in_pacchetto.sql` — aggiorna
  `pacchetto_completo()` e `sigilla_pacchetto()`: quando
  `coinvolge_terzi = true`, il sigillo ora RICHIEDE un elemento con
  `ruolo = 'dichiarazione_identita'` in `pacchetto_elementi`, esattamente
  come già richiede la liberatoria firmata via OTP.
- `src/lib/types.ts` — `RuoloElemento` include già
  `"dichiarazione_identita"`.
- `src/app/actions-pacchetto.ts` — esiste già
  `collegaDichiarazioneIdentita(taskId, versionId)` e l'helper
  `assicuraPacchettoServer`: agganciano una versione già caricata al
  pacchetto con quel ruolo. Puoi riusarli o no a seconda di come
  implementi il punto 1 sotto.
- `src/app/actions-liberatoria.ts` — l'invio della liberatoria ora parte
  IN AUTOMATICO quando il Collaboratore salva l'email/PEC di contatto
  (prima serviva un click admin): vedi `inviaAutomaticamenteSeNecessario`.
- `src/app/actions-profilo.ts` — `revocaImmagineVoce` e `notificaArt82`
  (non correlati a questo task).
- `src/components/NotificheDovuteArt82.tsx`, sezione admin collegata in
  `src/app/(app)/admin/page.tsx` (non correlati a questo task).

## Cosa manca — 3 cose da fare

### 1. Spostare l'upload dalla card "Materiali di lavorazione" a uno slot dedicato in "Video completo"

Oggi (`src/components/KindCard.tsx`) c'è un tentativo precedente non
definitivo: dopo l'upload di un `video_grezzo` su un task con
`coinvolge_terzi = true`, un `window.confirm()` chiede "è questo il
video con la dichiarazione?" e in caso di sì chiama
`collegaDichiarazioneIdentita`. **Questo va rimosso**: la richiesta
esplicita del Titolare è che il video di dichiarazione si carichi
direttamente in un campo dedicato dentro `src/components/PacchettoVideo.tsx`
("Video completo"), accanto a copertina e liberatoria — non dentro i
materiali di lavorazione con un popup di conferma a posteriori. Motivo:
più esplicito, ed evita che un secondo membro del gruppo, non vedendo il
file per via della RLS, lo ricarichi per sbaglio sopra quello giusto.

Da fare:

- In `KindCard.tsx`: rimuovi `dopoUploadGrezzo`, la prop `coinvolgeTerzi`,
  l'import di `collegaDichiarazioneIdentita` e i passaggi di `onCaricato`
  ai due `UploadDeliverable` — torna alla versione senza queste aggiunte.
- In `src/app/(app)/task/[taskId]/page.tsx`: rimuovi la prop
  `coinvolgeTerzi={task.coinvolge_terzi}` passata a `KindCard` (non serve
  più lì).
- In `PacchettoVideo.tsx`: aggiungi un nuovo `Slot` "7 · Video di
  dichiarazione", visibile solo quando `coinvolgeTerzi` è true, con le
  stesse regole di `componibile` già usate per video/copertina (upload
  possibile solo mentre il pacchetto è in bozza, non bloccato, e chi
  carica non è admin — è il gruppo che lo deposita, non il Titolare).
  Usa `kind="video_grezzo"` (così eredita automaticamente la RLS di
  0091) e, dopo l'upload, aggancia con `ruolo: "dichiarazione_identita"`
  tramite lo stesso pattern già usato da `dopoUpload("video", v)` /
  `dopoUpload("copertina", v)` in quel file (puoi riusare
  `collegaElemento` via server action, o l'esistente
  `collegaDichiarazioneIdentita` se preferisci — sono equivalenti, la
  seconda in più crea il pacchetto se non esiste ancora).
- La variabile `dichiarazione` e il controllo su `completo` in
  `PacchettoVideo.tsx` esistono già (cercali: sono già stati aggiunti in
  un giro precedente) — non serve ritoccarli, solo aggiungere lo Slot che
  li alimenta.
- Limite noto e accettato dal Titolare: un membro del gruppo diverso da
  chi ha caricato il video di dichiarazione lo vedrà come "assente" (per
  via della RLS), anche se in realtà esiste — a questa scala (piccoli
  gruppi) è un limite tollerato, non serve risolverlo con altra
  infrastruttura. Metti comunque una didascalia onesta sotto lo slot tipo
  "Visibile solo a chi l'ha caricato e al Coordinatore" invece di
  lasciare che sembri vuoto senza spiegazione.

### 2. Cartella Drive dedicata "Dichiarazioni"

`supabase/functions/esporta-drive/index.ts` (Edge Function, gira su Deno)
copia gli elementi del pacchetto sigillato su Drive. Oggi la mappa
`CARTELLA_PER_RUOLO` (riga ~354) ha solo `video`, `copertina`,
`liberatoria` — se un elemento ha un ruolo non mappato viene SALTATO in
silenzio (`if (!dest) continue;`). Serve aggiungere:

```ts
const cartDichiarazioni = await trovaOCreaCartella(token, cartellaGV, "Dichiarazioni");
// ...
const CARTELLA_PER_RUOLO: Record<string, string> = {
  video: cartVideo,
  copertina: cartCopertine,
  liberatoria: cartLiberatorie,
  dichiarazione_identita: cartDichiarazioni,
};
```

Nota per il Titolare (da riferirgli, non da risolvere nel codice): questa
funzione gira con service role e scrive su Drive con le credenziali
OAuth del Gmail di ToothTalk — la cartella "Dichiarazioni" erediterà i
permessi della cartella padre su Drive. Se vuole che SOLO lui la veda,
deve impostarlo lui stesso nelle condivisioni di Google Drive: non è
qualcosa che questo codice possa configurare.

### 3. Applicare e testare

Applica in ordine `0090` → `0091` → `0092` → `0093`, poi fai il deploy
della Edge Function `esporta-drive` aggiornata (`supabase functions
deploy esporta-drive`, o il comando equivalente del progetto). Poi test
end-to-end:

1. Task con `coinvolge_terzi = true`: inserisci l'email di contatto (deve
   partire da sola la liberatoria — vedi punto già costruito in
   `actions-liberatoria.ts`).
2. Carica un video nel nuovo slot "Video di dichiarazione": deve comparire
   solo per chi lo carica (e per l'admin), non per altri membri del
   gruppo con accesso allo stesso task.
3. Prova a sigillare senza quel video: `sigilla_pacchetto` deve rifiutare
   con l'errore "manca il file con la dichiarazione di identità...".
4. Carica il video, sigilla: deve riuscire, e il manifesto deve contenere
   un elemento `ruolo: "dichiarazione_identita"`.
5. Dopo il sigillo, verifica che l'esportazione Drive crei la cartella
   "Dichiarazioni" dentro GESTIONE VIDEO del polo, con il file dentro,
   rinominato come gli altri (`Video N — Titolo.ext`).

Se qualcosa non torna con `tsc --noEmit`, il resto del repo è già pulito
(verificato prima di scrivere questo prompt): un errore nuovo viene
sicuramente da queste modifiche.
