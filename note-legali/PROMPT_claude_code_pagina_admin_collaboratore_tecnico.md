# Prompt per Claude Code — pagina admin per il Collaboratore Tecnico

## Contesto

Questo prompt sostituisce, ampliandolo, il punto 3 ("Sezione admin dedicata") di
`PROMPT_claude_code_rinnovo_tecnico_invio_automatico.md`: invece di una card dentro `/admin`, Enrico
vuole una pagina propria, admin-only, dove gestire tutto ciò che riguarda il Collaboratore Tecnico.
Resta valida la Decisione Opzione A/B descritta in quel prompt (tabella `collaboratori_tecnici` a
parte, non `profiles.role`) — leggi prima quel file per il contesto sullo schema dati e sull'aggancio
hash tra Documento 5 e Documento 5bis, questo prompt non lo ripete.

## Parte A — Pagina `/admin/tecnico` (o simile, admin-only)

Contenuti, in ordine di priorità:

1. **Anagrafica del Collaboratore Tecnico**: nome, contatto (email/PEC), data di sottoscrizione del
   Documento 5, `accordo_sha256` mostrato in chiaro e copiabile (serve a Enrico per riportarlo a mano
   sul Documento 5bis prima di mandarlo, come da prompt rinnovo), `accordo_scadenza`.
2. **Registro degli accessi** — la versione digitale dell'Allegato 1 del Documento 5: una tabella
   modificabile (sistema, livello concesso, data concessione, data revoca) invece della tabella Word
   compilata a mano. Non è solo comodità: tenerla nel gestionale invece che su un file Word locale
   significa che è sempre consultabile e verificabile, e si può collegare all'`audit_log` esistente.
   Ogni riga aggiunta/modificata va tracciata in `audit_log`.
3. **Gestione del rinnovo**: upload del documento di rinnovo firmato, bottone "Approva rinnovo" —
   implementazione secondo quanto già descritto in `PROMPT_claude_code_rinnovo_tecnico_invio_automatico.md`
   (invio PEC/email automatico al termine dell'approvazione).
4. Link rapido al Documento 5 e 5bis nella libreria pubblica (`/documenti`), per non dover cercarli.

RLS/accesso: pagina e relative azioni server-side, admin-only, stesso pattern di `requireAdmin()` già
usato altrove nel gestionale.

## Parte B — Domande tecniche del supporto: DECISIONE APERTA, non implementare senza conferma di Enrico

Enrico ha menzionato, nello stesso messaggio in cui ha chiesto questa pagina, che le domande
classificate come "tecniche" dal sistema di supporto (`domande_supporto`, `categoria_ia`) dovrebbero
"arrivare direttamente" al Collaboratore Tecnico — il messaggio si è interrotto a metà frase e non è
chiaro cosa intendesse di preciso. Comportamento ATTUALE, per chiarezza: oggi (`actions-supporto.ts`,
`classificaDomandaSupporto`) una domanda "tecnica" riceve una risposta automatica dell'IA senza alcuna
revisione umana prima dell'invio — Enrico la vede solo per trasparenza in `DomandeSupportoAdmin.tsx`,
non riceve notifica push per quelle. Cambiare questo per instradarle al Collaboratore Tecnico invece
tocca dati personali reali dei Collaboratori che fanno domande (nome, contenuto della domanda, a volte
dettagli operativi) — è esattamente il tipo di trattamento che il Documento 5, Art. 8, disciplina come
"persona autorizzata al trattamento" con obbligo di minimizzazione.

**Confermato da Enrico:** le domande "tecniche" vanno al Collaboratore Tecnico AL POSTO della risposta
automatica dell'IA — l'IA smette di rispondere in autonomia su questa categoria; a rispondere è il
Collaboratore Tecnico.

**Restano due punti aperti, chiedi a Enrico prima di scrivere codice:**

- L'inoltro è una notifica (email? Il Collaboratore Tecnico non ha un login nel gestionale in Opzione
  B, quindi niente push) con il testo della domanda, o un vero accesso a una coda che il Collaboratore
  Tecnico gestisce da qualche interfaccia? Se è quest'ultima, richiede che il Collaboratore Tecnico
  abbia un qualche accesso applicativo — che riapre la domanda Opzione A/B invece che chiuderla. Se è
  un inoltro via email, chi scrive la risposta finale che il Collaboratore riceve: risponde
  direttamente il Collaboratore Tecnico dal proprio client email (fuori gestionale, quindi
  `rispondiDomanda` — oggi admin-only — dovrebbe accettare anche lui, oppure Enrico fa da tramite
  incollando la risposta ricevuta)?
- Il Collaboratore Tecnico deve vedere il nome del Collaboratore che ha fatto la domanda, o è
  sufficiente il contenuto tecnico anonimizzato? La minimizzazione dei dati (Documento 5, Art. 8.2)
  suggerisce la seconda, se tecnicamente possibile senza perdere contesto utile.

Non indovinare questi due punti: implementare la risposta sbagliata significa mandare dati personali
di terzi (i Collaboratori che fanno domande) a una persona esterna senza una base chiara per farlo, o
dare al Collaboratore Tecnico un potere che oggi `rispondiDomanda` riserva esplicitamente all'admin.

## Verifica richiesta (Parte A)

1. La pagina è raggiungibile solo da admin (redirect per chiunque altro, stesso pattern delle altre
   pagine `(app)`).
2. Il registro degli accessi tiene traccia corretta di data concessione/revoca e finisce in
   `audit_log`.
3. `npx tsc --noEmit` e `npm run build` puliti.

Non committare né pushare senza il mio ok esplicito.
