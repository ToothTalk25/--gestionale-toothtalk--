# Migrazione Supabase — Piano e Stato (per Claude)

> Documento di handoff. Riprendere da qui il **18/08/2026**.

---

## 1. Contesto del progetto

| Voce | Valore |
|---|---|
| **Progetto** | Gestionale ToothTalk (Next.js App Router + Supabase + Vercel) |
| **Path locale** | `/Users/enricoguarino5/Gestionale ToothTalk` |
| **Repo GitHub** | `ToothTalk25/--gestionale-toothtalk--` (branch `main`) |
| **Deploy Vercel** | `https://gestionale-toothtalk.vercel.app` (regione `fra1` = Francoforte) |
| **Supabase ATTUALE** | `tzveitawihargerrbkqd.supabase.co` — regione `eu-west-1` (Dublino/Irlanda) |
| **Account Supabase** | `tooth.talk25@gmail.com` è **co-owner** del progetto attuale |
| **PEC** | `toothtalk@pec.it` |
| **Google Drive + OAuth** | account `tooth.talk25@gmail.com` |
| **Vercel** | già collegato a GitHub |

---

## 2. Obiettivo della migrazione

Spostare tutto il progetto Supabase da **Dublino (`eu-west-1`)** a **Francoforte (`eu-central-1`)**, stessa regione di Vercel, per:

1. **Velocità**: oggi ogni query fa il giro `browser → Vercel fra1 → DB Dublino → ritorno` (~4.000 km andata+ritorno). Con DB e Vercel nella stessa regione la latenza si dimezza.
2. **Proprietà**: tutto il progetto finisce sotto l'account `tooth.talk25@gmail.com`.

> ⚠️ Supabase **NON permette** di cambiare regione a un progetto esistente → serve creare un **nuovo progetto** e migrarci tutto.

---

## 3. COSA DEVE FARE L'UTENTE (primo step, ~10 min)

Con l'account **`tooth.talk25@gmail.com`** loggato su `https://supabase.com/dashboard`:

1. **New project** → Name: `toothtalk` → **Region: `eu-central-1 (Frankfurt)`** → Database Password (appuntarla).
2. Aspettare lo stato "Active".
3. Copiare **4 valori** da **Settings → API**:
   - `Project URL` → `https://nuovo-ref.supabase.co`
   - `anon public key` → chiave legacy `eyJ...` (NON la publishable `sb_publishable_...`)
   - `service_role key` → `sb_secret_...`
   - `Database Password`


---

## 4. COSA DEVE FARE CLAUDE (dopo i 4 valori)

### 4a. Applicare lo schema
- Le migrazioni SQL stanno in `supabase/migrations/` (70+ file numerati).
- Riapplicarle in ordine al nuovo progetto. Possibili approcci:
  - `npx supabase db push` se configurata la CLI con la connection string del nuovo DB (usa la **Database Password** fornita + l'host pooler `aws-0-eu-central-1.pooler.supabase.com`).
  - Oppure script custom (stile `scripts/_salva-codici.mjs`) che esegue i file SQL in ordine.

### 4b. Migrare i dati (tabelle)
- Tabelle principali: `poli`, `tasks`, `pacchetti_video`, `deliverables`, `deliverable_versions`, `richieste_modifica`, `consensi`, `ricevute`, `liberatorie`/OTP, `profiles`, `task_status_history`, ecc.
- Copiare con service role key (leggere dal vecchio progetto, scrivere nel nuovo).
- ⚠️ **Attento ai trigger RLS** durante la copia: usare la service role (bypassa RLS) e disabilitare eventuali trigger che non devono riscattare (es. auto-incrementi, `updated_at`).

### 4c. Migrare lo Storage
- Bucket: video deliverable, liberatorie firmate, ricevute, foto profilo, immagini montaggio.
- Copiare i file da bucket vecchio → nuovo con service role.

### 4d. Ricreare gli utenti Auth
- **Pochi utenti** (confermato dall'utente). Ricrearli con password provvisorie.
- `profiles` va ricreato/collegato ai nuovi `auth.users.id` (ATTENZIONE: gli id cambiano! → fare una mappatura `old_id → new_id` e aggiornare tutte le FK `user_id` / `actor` / `created_by` nelle tabelle).

### 4e. Configurare il nuovo progetto
- Secret **Vault** (chiavi Gemini, credenziali PEC, Google OAuth client/secret, ecc.).
- **Edge Functions** `esporta-drive` e `esporta-immagine-montaggio` → ricrearle con `supabase functions deploy`.
- **Email template** `reset-password.html` (sta in `supabase/email-templates/`).
- **Cron** / pg_cron se usati.

### 4f. Aggiornare le env var
- `.env.local` (locale): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, ecc.
- **Vercel** → Settings → Environment Variables: aggiornare gli stessi valori.

### 4g. Deploy e test
- `npm run build` + push → deploy Vercel.
- Test end-to-end: login, navigazione, upload deliverable, sigillo, PEC, Drive, liberatoria OTP, report cron.

### 4h. Pulizia
- Solo quando tutto è verificato → cancellare il vecchio progetto (Dublino).

---

## 5. Dettagli tecnici utili (già in essere)

### 5a. Auth nel codice
- `src/lib/auth.ts`:
  - `getSessionContext()` usa **`getSession()`** (locale, JWT) — NON `getUser()` (era la chiamata HTTP che rallentava).
  - `requireSession()` → redirect a `/login?next=...` se non autenticato.
  - Il check di sicurezza è doppio: RLS su ogni query + `profile.attivo`.
- `src/proxy.ts`: proxy che fa `getSession()` e redirect a `/login` per le pagine protette. **Il matcher** esclude `/api`, `_next`, ecc.

### 5b. Struttura routes
- `src/app/(app)/` = pagine protette (dashboard, task, polo, admin, profilo, revisione).
- `src/app/login/page.tsx`, `carica-liberatoria`, ecc. = pubbliche.
- `src/app/api/cron/*` = cron endpoints (liberatorie-scadute, report-settimanale, retry-drive) — protetti da header `Authorization: Bearer CRON_SECRET`.

### 5c. Scripts esistenti in `scripts/`
- Molti script `.mjs` di utilità (backfill consensi/ricevute, drive-*, reset-passwords, salva-codici). Servono come riferimento per lo stile di accesso a Supabase (service role).

### 5d. Env attuali (nomi chiave)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (connection string con pooler `aws-1-eu-west-1.pooler.supabase.com` per il vecchio DB)

---

## 6. Checklist rapida di fine lavoro

- [ ] Nuovo progetto creato in `eu-central-1`
- [ ] Migrazioni applicate in ordine
- [ ] Dati tabelle migrati (con mappatura id)
- [ ] Storage migrato
- [ ] Utenti Auth ricreati + profiles ricollegati
- [ ] Vault + Edge Functions + email template configurati
- [ ] Env var aggiornate (locale + Vercel)
- [ ] Deploy Vercel ok
- [ ] Test end-to-end ok
- [ ] Vecchio progetto cancellato

---

## 7. Stato performance (già ottimizzato, NON rifare)

| Ottimizzazione | Stato |
|---|---|
| `getSession()` nel proxy (niente HTTP per asset) | ✅ fatto |
| `getSession()` in `getSessionContext` (niente `getUser()` HTTP) | ✅ fatto |
| `React cache()` per la sessione | ✅ fatto |
| `hash-wasm` import dinamico (fuori dal bundle) | ✅ fatto |
| Font ridotti 4→3 pesi | ✅ fatto |
| Query pagina task in parallelo (`Promise.all`) | ✅ fatto |
| Cron ping per evitare cold start | ✅ fatto |
| Layout mobile (KindCard compatta) | ✅ fatto |
