-- =====================================================================
-- 0067_otp_liberatoria_rate_limit.sql
-- L'OTP della liberatoria non aveva alcun limite: si poteva richiedere un
-- nuovo codice all'infinito (spam sulla casella del contatto) e tentare la
-- verifica senza limite di prova (bruteforce delle 6 cifre, 1 su 1.000.000,
-- fattibile entro i 10 minuti di validità con richieste automatizzate).
-- Si aggiunge un contatore di tentativi di verifica falliti.
-- =====================================================================

alter table public.richieste_liberatoria
  add column if not exists otp_tentativi integer not null default 0;

comment on column public.richieste_liberatoria.otp_tentativi is
  'Tentativi di verifica falliti sul codice OTP corrente; azzerato a ogni nuovo invio.';
