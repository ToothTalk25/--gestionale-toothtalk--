-- =====================================================================
-- 0045_liberatoria_otp.sql — firma con codice monouso via email
-- =====================================================================
-- Sostituisce la firma disegnata su canvas con un codice OTP di 6 cifre
-- inviato all'email del contatto. Modello: contratti luce/gas/telefonia.
-- Valore legale: solo chi ha accesso a quella casella email può firmare.
-- =====================================================================

alter table public.richieste_liberatoria
  add column if not exists otp_hash text,
  add column if not exists otp_generato_at timestamptz;
