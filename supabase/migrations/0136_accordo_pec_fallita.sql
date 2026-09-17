-- Traccia quando l'invio PEC dell'accordo (in approvaRegistrazione) fallisce
-- e il gestionale spedisce lo stesso documento via Gmail come ripiego: serve
-- per ritrovare chi va ricertificato via PEC quando il blocco IP di Aruba
-- (ticket 19039798A) sara' davvero risolto, non solo dichiarato tale.
-- NULL = mai fallito (o non ancora tentato). Valorizzato = in attesa di
-- ricertificazione; torna a NULL quando la ricertificazione riesce.
alter table public.profiles
  add column if not exists accordo_pec_fallita_at timestamptz;
