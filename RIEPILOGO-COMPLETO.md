# RIEPILOGO COMPLETO — Gestionale ToothTalk

> Documento di riepilogo di tutto il lavoro svolto sul progetto ToothTalk.
> Pronto per essere mostrato a Claude/altro assistente per riprendere il lavoro.
> Ultimo aggiornamento: **18 agosto 2026**

---

## 1. CONTESTO DEL PROGETTO

| Voce | Valore |
|---|---|
| **Progetto** | Gestionale ToothTalk — divulgazione scientifica e odontoiatrica |
| **Stack** | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL + Storage) |
| **Path locale** | `/Users/enricoguarino5/Gestionale ToothTalk` |
| **Repo GitHub** | `ToothTalk25/--gestionale-toothtalk--` (branch `main`) |
| **Deploy Vercel** | `https://gestionale-toothtalk.vercel.app` (regione `fra1` = Francoforte) |
| **Supabase ATTUALE** | `tzveitawihargerrbkqd.supabase.co` — regione `eu-west-1` (Dublino) |
| **Account Supabase** | `tooth.talk25@gmail.com` (co-owner) |
| **PEC** | `toothtalk@pec.it` |
| **Google Drive + OAuth** | account `tooth.talk25@gmail.com` |
| **Modello organizzativo** | Orizzontale/paritario: i poli (Insubria, Genova, Milano, Palermo, Chieti, Messina, UCAM) lavorano allo stesso livello; l'Admin (titolare) ha visione/controllo globale |

---

## 2. CRONOLOGIA DEI LAVORI (tutto ciò che è stato fatto)

### FASE A — Organizzazione Google Drive "GESTIONE VIDEO"

**Richiesta**: sistemare la cartella Drive del polo Genova e omologare i nomi tra tutti i team.

**Cosa è stato fatto (via API Google Drive con OAuth, script Node):**
1. **Spostati 2 documenti** nella nuova suddivisione numerata:
   - "DESCRIZIONI VIDEO" → cartella `4 - Descrizioni`
   - "TITOLI YOUTUBE SHORTS" → cartella `5 - Titoli YouTube`
   - La vecchia cartella "Descrizione e titolo youtube shorts" è stata **cestinata** dall'utente (il proprietario era l'account personale enricoguarino25, non l'OAuth tooth.talk25)
2. **Confronto completo dei titoli** tra 4 fonti (cartella Video, cartella Copertina, doc "DESCRIZIONI VIDEO", doc "TITOLI YOUTUBE SHORTS") su tutti i 49 video: trovate **5 incongruenze**.
3. **Rinominate le 5 incongruenze** (con conferma dell'utente):
   | # | Prima | Dopo |
   |---|---|---|
   | 5 | Odontoiatra vs Odontotecnico | Odontoiatra o odontotecnico? |
   | 13 | I 3 consigli per un odontoiatra | Salvare la polpa dentale: l'endodonzia |
   | 17 | Forma e funzione dei denti (copertina) | A cosa servono i nostri denti |
   | 48 | Toothtest scovolino (video+copertina) | Quante ne sai sullo scovolino? |
   | 49 | Le carie da Biberon (copertina, caricata da giadatripo) | Rimossa dalla cartella (file di terzi) |
4. **Omologazione struttura Drive su tutti i 7 poli**: Genova aveva `2 - Copertina` (singolare), gli altri 6 `2 - Copertine` → rinominata a `2 - Copertine`. Ora la struttura "GESTIONE VIDEO" è identica ovunque: `1 - Video`, `2 - Copertine`, `3 - Script`, `4 - Descrizioni`, `5 - Titoli YouTube`, `Liberatorie`, `Verbali`.
5. **Coerenza con l'automazione**: `esporta-drive` ora usa il separatore **`—`** (trattino lungo) per i nomi file (`Video N — Titolo`), come i file già presenti su Drive.

---

### FASE B — Performance (velocità del gestionale)

**Richiesta**: il gestionale era lento, bisognava velocizzarlo.

**Cosa è stato fatto:**
1. **`getSession()` al posto di `getUser()`** nel proxy e in `getSessionContext` → elimina la chiamata HTTP a Supabase per ogni navigazione (il JWT è locale, istantaneo; la validazione resta nella RLS + check `profile.attivo`)
2. **`React cache()`** su `getSessionContext` → 1 sola risoluzione di sessione per render
3. **`hash-wasm` import dinamico** → -2MB dal bundle iniziale
4. **Font ridotti da 4 a 3 pesi** → -31% peso font
5. **Query della pagina task in parallelo** (`Promise.all` a onde)
6. **Cron ping** ogni 10 min → niente cold start
7. Verificato: il DB Supabase è in **Dublino (eu-west-1)**, Vercel in **Francoforte (fra1)** → ogni query fa ~4000 km. **Pianificata la migrazione a Francoforte** (vedi FASE F).


---

### FASE C — Sicurezza informatica (Zero Trust / Defense-in-Depth)

**Richiesta**: blindatura di sicurezza enterprise contro BOLA/IDOR, injection, XSS, JWT, SSRF, CORS/CSRF.

**Analisi completa eseguita** (tabelle, RLS, storage, trigger, viste, action, API routes):

**Già solido (verificato, non toccato):**
- RLS attiva su **tutte le 18 tabelle**, policy granulari per ruolo-polo, `revoke delete` globale
- Trigger difensivi: `fn_tasks_guard` (blocca cambio polo/lock/stati riservati), `fn_protect_profile` (niente auto-promozione admin)
- Storage: `originali`/`finali` solo-INSERT, `revisioni` solo-admin, `profili` solo self/colleghi
- Immutabilità prove: `deliverable_versions` senza UPDATE/DELETE
- Viste tutte `security_invoker = true`
- service_role confinata in `server-only`
- Query parametrizzate (client ufficiale Supabase)

**Vulnerabilità trovate e CORRETTE:**
1. 🔴 **API cron senza autenticazione** (`/api/cron/report-settimanale`, `liberatorie-scadute`, `retry-drive`) → ora protette con **`Authorization: Bearer CRON_SECRET`** + header Vercel `x-vercel-cron`. Testate: **401 senza chiave, 200 con chiave**.
2. 🔴 **Open redirect nel login** (`?next=https://maligno.com`) → ora accettati solo percorsi interni (regex `^/[/a-zA-Z0-9_-]*$`).
3. 🟠 **IDOR parziale** in `urlFirmato`, `registraVersione`, `eliminaVersione` → ora validazione esplicita server-side della proprietà (polo, deliverable↔task, versione↔task).
4. 🟠 **Cookie** → `HttpOnly` + `Secure` + `SameSite=Strict` + `Path=/`.
5. 🟡 **`briefing-gestionale`** chiave in query string → ora in **header Authorization** (query accettata per retro-compatibilità).
6. **Migrazione `0071_hardening_rls.sql`**: riafferma RLS su tutte le tabelle, `revoke delete`, estende `fn_protect_profile` (attivo/email/role solo admin), vincolo `role IN ('member','admin')`.
7. **Test RLS reale**: utente membro del polo Messina vede SOLO le task di Messina (nessuna fuga cross-polo).
8. **npm audit**: 0 vulnerabilità.

**Nuovo modulo** `src/lib/api-auth.ts` (cron auth) e `src/lib/percorsi.ts` (validazione redirect client-safe).

---

### FASE D — GDPR: revoca consenso + profili uscenti

**Richiesta**: pulsante "revoca consenso" (GDPR) + sezione profili uscenti con promemoria.

**Cosa è stato fatto:**
1. **Migrazione `0072_revoca_consenso.sql`**:
   - `consensi` → colonne `revocato_at`, `revocato_da`
   - RPC `revoca_consenso(tipo)` — append-only, registra la revoca senza cancellare
   - Funzione `consenso_attivo(user, tipo, versione)`
2. **UI revoca**: sezione "Consensi e privacy" nel profilo con 2 pulsanti ("Revoca consenso privacy" / "Revoca consenso cookie"), conferma esplicita, messaggio di esito.
3. **BannerConsenso** aggiornato: considera le revoche → il banner ricompare se il consenso è revocato.
4. **Sezione "Profili uscenti"** nell'admin (`ProfiliUscenti.tsx`):
   - Elenca profili `attivo=false` con poli, materiali depositati, stato accordo
   - Riquadri informativi: *Cosa si perde* / *Cosa si conserva* / *Perché conservare* (difesa legale, Art. 17(3)(e), prescrizione 10 anni)
   - **Nessuna cancellazione automatica**: gestione 100% manuale (decisione esplicita dell'utente)
5. **Promemoria nel report settimanale**: sezione "Profili uscenti da oltre 180 giorni" (solo informativa).


---

### FASE E — Infrastruttura legale enterprise (GDPR Art. 5, 6, 7, 17, 20, 28, 32)

**Richiesta**: registro granulare consensi, WORM, DSAR, data retention, cookie banner, audit log a catena, tracciabilità media.

**Cosa è stato fatto:**

**1. Registro granulare `consents_and_releases`** (migrazione `0073`):
- Tabella con: `task_id`, `user_id`, `richiesta_id`, `tipo_soggetto` (maggiorenne/minore/collaboratore), `tipo` (liberatoria/accordo_collaboratore/nda), `nome_soggetto`, `email_soggetto`, `storage_path`, `sha256`, `metodo_firma` (otp/canvas/upload_manuale), `firmato_at`, `is_revoked`, `revocato_at`, `revocato_da`
- RLS (admin tutto, membri solo proprio polo), `revoke delete` (append-only)
- **Integrato nel flusso reale**: `firmaConOtpLiberatoria`, `firmaLiberatoriaOnline` (canvas), `caricaAccordo` → tutti registrano il documento firmato nel registro

**2. Guardrail applicativo (Blocco Logico)**:
- Trigger `fn_task_consenso_guard`: se la task `coinvolge_terzi`, il passaggio a `in_revisione`/`approvato` è **BLOCCATO** senza liberatoria valida e non revocata
- **Testato sul DB**: CASO 1 senza liberatoria → BLOCCATA ✓ · CASO 2 con liberatoria → CONSENTITA ✓

**3. Sezione admin "Registro liberatorie e accordi"**: tabella consultabile con soggetto, tipo, metodo firma, SHA-256, stato (Valido/Revocato).

**4. Audit log a catena crittografica** (migrazione `0074`):
- Colonne `prev_hash` + `row_hash` su `audit_log`
- Trigger `fn_audit_chain`: ogni riga contiene SHA-256 della precedente
- Funzione `audit_verifica_catena()`: ricalcola l'intera catena e segnala tutte le incongruenze
- **Testato sul DB**: 3 righe con catena integra → manomissione simulata della riga #2 → la verifica **segnala esattamente la riga manomessa**

**5. Portabilità dati GDPR (Art. 20)**:
- Action `esportaDatiPersonali()`: genera JSON con profilo, consensi (incluse revoche), appartenenze poli, materiali depositati
- Pulsante "Esporta i miei dati (GDPR)" nel profilo → scarica il file
- Non tocca/cancella nulla: è una copia per l'interessato

**6. Termini di Servizio**: nuova pagina `/termini` (pubblica), 9 sezioni. Link nel login.

**7. Privacy Policy resa pubblica**: prima era dietro login (violazione GDPR — un contatto esterno deve poterla leggere) → ora `/privacy` e `/privacy#cookie` sono pubbliche.

**8. Tracciabilità dei download (media traceability)**:
- `urlFirmato` ora registra ogni download di file sensibile nell'audit log a catena con: attore, bucket, storage_path, **SHA-256 del file**, polo.

**9. Fix vari**: `supabase/.temp/` aggiunto al `.gitignore`.

---

### FASE F — Migrazione Supabase a Francoforte (PIANIFICATA, NON eseguita)

**Richiesta**: trasferire tutto il progetto sotto l'account `tooth.talk25@gmail.com` e spostare il DB in `eu-central-1` (Francoforte), stessa regione di Vercel.

**Documento completo**: `MIGRAZIONE-SUPABASE.md` (nella cartella del progetto).

**Piano** (quando l'utente vorrà):
1. Creare nuovo progetto Supabase in `eu-central-1` con account tooth.talk25
2. Riapplicare le migrazioni SQL (70+) → schema identico
3. Migrare dati + storage + ricreare utenti Auth (pochi)
4. Aggiornare env (locale + Vercel)
5. Deploy e test end-to-end
6. Cancellare il vecchio progetto (Dublino)

---

## 3. INFRASTRUTTURA OPERATIVA ATTUALE

### Cron Vercel (`vercel.json`)
| Endpoint | Schedule |
|---|---|
| `/api/cron/report-settimanale` | lunedì 08:00 |
| `/api/cron/liberatorie-scadute` | ogni giorno 09:00 |
| `/api/cron/retry-drive` | ogni giorno 10:00 |
| (ping per warm-up) | frequente |

### Environment Variables (Vercel)
| Variabile | Valore | Stato |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tzveitawihargerrbkqd.supabase.co` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chiave anon legacy | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | chiave service_role | ✅ |
| `BRIEFING_API_KEY` | `132753ea978178a463040fa6d15dc93aa159bbf8e4436237` | ✅ testata (200) |
| `CRON_SECRET` | `e0120ad2dab2e14d7a45268ed34113a2f2f7af80fbcb98b28545ab85365fe856` | ✅ testata (200) |
| Altre | GEMINI, GOOGLE OAUTH, PEC, MAIL, ecc. | ✅ |

### Edge Functions Supabase (deployate via CLI `supabase functions deploy`)
- `esporta-drive` — esportazione pacchetti su Drive (con separatore `—`)
- `esporta-immagine-montaggio`

---

## 4. STRUTTURA DB LEGALE (tabelle chiave)

| Tabella | Scopo | Append-only |
|---|---|---|
| `profiles` | Profili utente (ruolo, attivo, accordo) | no (ma protetta) |
| `poli` / `memberships` | Poli e appartenenze | no |
| `tasks` | Progetti (stato, coinvolge_terzi, locked) | no (ma protetta) |
| `deliverables` / `deliverable_versions` | Materiali + versioni (WORM) | ✅ versions |
| `consensi` | Consensi privacy/cookie/riconoscimento (con revoca) | ✅ |
| `consents_and_releases` | Registro granulare liberatorie/accordi | ✅ |
| `richieste_liberatoria` | Flusso OTP liberatorie | ✅ |
| `audit_log` | Audit a catena di hash | ✅ |
| `pacchetti_video` / `pacchetto_elementi` | Pacchetti pubblicabili + PEC | parziale |
| `esportazioni_drive` | Stato esportazioni Drive | — |

---

## 5. COMPONENTI / PAGINE PRINCIPALI

| Percorso | Funzione |
|---|---|
| `src/app/(app)/` | Pagine protette: dashboard, task, polo, admin, profilo, revisione |
| `src/app/login/` + `LoginForm` | Login + reset password + open-redirect-safe |
| `src/app/privacy/` | Privacy Policy (pubblica) |
| `src/app/termini/` | Termini di Servizio (pubblica) |
| `src/app/api/cron/*` | Cron autenticati (CRON_SECRET) |
| `src/app/api/briefing-gestionale/` | Briefing JSON (BRIEFING_API_KEY in header) |
| `src/components/BannerConsenso` | Banner cookie GDPR al primo accesso |
| `src/components/ProfiliUscenti` | Sezione admin profili uscenti (promemoria) |
| `src/components/ProfiloPersonale` | Profilo: anagrafica, accordo, consensi, revoca, esporta dati |
| `src/lib/auth.ts` | Sessione (getSession locale, React cache) |
| `src/lib/supabase/admin.ts` | Client service_role (server-only) |
| `src/lib/api-auth.ts` / `percorsi.ts` | Auth API route / validazione path |
| `src/lib/formato.ts` | Regole di forma uniformi sui testi (Fase 1) |
| `src/lib/google-doc.ts` | Google Docs di lavorazione |
| `scripts/` | `migra.mjs`, `gestisci-utenti.mjs`, `deploy-drive.sh` |


---

## 6. REGOLE DI FORMA UNIFORMI SUI TESTI (Fase 1 — LIVE)

**`src/lib/formato.ts`**: normalizza titoli, descrizioni, script, titoli YouTube al salvataggio (server-side, non bypassabile):
- Trim, spazi doppi, maiuscola iniziale, niente punto finale
- Rimuove prefissi "Video 5 - ..." / "5. ..."
- Blocca caratteri che rompono i file: `\ / : * < > |`
- Max 80 caratteri (titolo) / 100 (YouTube) / 5000 (descrizione) / 20000 (script)
- Feedback "Titolo corretto: X → Y" quando il server normalizza

Applicato in: `creaTask`, `aggiornaTesti`, `salvaPacchetto`, `importaTestoGoogleDoc`, e nei componenti UI (NewTaskForm, TaskTextEditor, PacchettoVideo, AzioniProgetto, AzioniProgettoRiga).

---

## 7. STATO ATTUALE (verificato)

- ✅ App web live su Vercel (pagina `/login`, `/privacy`, `/termini` = 200; `/dashboard` = 307 senza sessione)
- ✅ Edge function `esporta-drive` deployata (separatore `—`)
- ✅ RLS su tutte le 18 tabelle (verificato via SQL)
- ✅ Audit log a catena di hash (verificato: manomissione rilevata)
- ✅ Guardrail liberatoria obbligatoria (verificato: bloccato/consentito)
- ✅ Cron autenticati (401 senza chiave, 200 con)
- ✅ Privacy/Termini pubblici
- ✅ 0 vulnerabilità npm

---

## 8. COSE IN SOSPESO / PROSSIMI PASSI

1. **Migrazione Supabase a Francoforte** (Art. 28 GDPR — territorialità UE) → documento `MIGRAZIONE-SUPABASE.md`
2. **Fase 2 del protocollo operativo** (riconoscimento contenuto: come devono essere descrizioni/titoli/script) — l'utente deve prima scrivere il protocollo operativo, poi si implementa l'architettura di regole configurabili
3. **Data retention automatica** — scelta esplicita: gestione MANUALE dei profili uscenti (nessun cron automatico di cancellazione)
4. **NDA** — il tipo `nda` esiste già nell'enum di `consents_and_releases`, pronto per eventuale uso futuro

---

*Documento generato automaticamente come riepilogo di handoff.*
