-- =====================================================================
-- 0149_limiti_dello_storage.sql — quanto può essere grande un file
-- =====================================================================
-- Perché. I tre bucket dei video (`finali`, `originali`, `revisioni`) avevano
-- un limite di **5 GB per file** — il massimo che Supabase consente di
-- impostare — e nessuno dei bucket dichiarava i tipi di file accettati. Con un
-- account approvato (o un account compromesso) si potevano quindi caricare
-- centinaia di GB: sullo spazio incluso nel piano si arriva al blocco del
-- progetto, e senza il tetto di spesa attivo la differenza diventa una fattura.
--
-- Non è un'ipotesi da manuale: è la stessa cosa che si vede fare nei video
-- sull'abuso delle chiavi pubbliche, applicata all'unica chiave che nel
-- gestionale è davvero pubblica (quella del browser, che serve all'app).
--
-- Cosa cambia: il tetto per file scende a 500 MB nei tre bucket dei video. Nel
-- progetto il file più grande è di pochi MB (tutto lo storage occupa 23 MB), e
-- il "video di dichiarazione" registrato nel browser sta ampiamente sotto
-- quella soglia: 500 MB è dieci volte il massimo che serve.
--
-- Cosa NON cambia: i tipi di file. Si potrebbe restringere a video/immagini/PDF,
-- ma un elenco sbagliato rompe un caricamento vero — e rompere un caricamento
-- è peggio di accettare un .zip inutile. Restano come sono, con la nota qui
-- sotto per chi vorrà farlo con calma.
--
-- Gli altri bucket restano come sono (magazzino 100 MB, profili 20 MB,
-- branding 10 MB): erano già ragionevoli.
-- =====================================================================

update storage.buckets set file_size_limit = 524288000 where id in ('finali', 'originali', 'revisioni');

do $$
declare
  troppi text;
begin
  select string_agg(id || ' (' || pg_size_pretty(file_size_limit) || ')', ', ' order by id)
    into troppi
    from storage.buckets
   where id in ('finali', 'originali', 'revisioni')
     and file_size_limit > 524288000;

  if troppi is not null then
    raise exception 'Bucket ancora senza tetto ragionevole: %', troppi;
  end if;
  raise notice 'Tetto per file: 500 MB nei bucket dei video, invariati gli altri.';
end;
$$;
