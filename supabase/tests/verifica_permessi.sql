-- =====================================================================
-- verifica_permessi.sql — prova sul campo delle garanzie
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO aver creato almeno:
--   * un admin e due membri di poli diversi (scripts/gestisci-utenti.mjs)
--   * una task con una consegna originale caricata dalla dashboard
--
-- Compila i tre UUID nel primo blocco e lancia l'intero file. I risultati
-- compaiono fra i messaggi/NOTICE. Tutto gira in transazione e finisce con
-- ROLLBACK: nessun dato viene modificato.
--
-- Gli UUID li trovi con:  select id, email, role from public.profiles;
-- =====================================================================

begin;

select set_config('app.admin',    '00000000-0000-0000-0000-000000000000', true);
select set_config('app.membro_a', '00000000-0000-0000-0000-000000000000', true);  -- es. Insubria
select set_config('app.membro_b', '00000000-0000-0000-0000-000000000000', true);  -- es. Genova

-- ------------------------------------------------- diventa il MEMBRO A
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.membro_a'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- 1. Isolamento fra poli -----------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
  from public.tasks t
  where t.polo_id not in (
    select polo_id from public.memberships where user_id = auth.uid()
  );
  if n = 0 then
    raise notice 'PASS     il membro A non vede alcuna task fuori dal proprio polo';
  else
    raise notice 'FALLITO  visibili % task di altri poli', n;
  end if;
end $$;

-- 2. Parità dentro al polo ---------------------------------------------
-- Qualunque membro può modificare qualunque task del proprio polo, anche
-- se l'ha creata un altro: è il modello piatto.
do $$
declare v_task uuid;
begin
  select id into v_task
  from public.tasks
  where not locked and created_by is distinct from auth.uid()
  limit 1;

  if v_task is null then
    raise notice 'SKIP     nessuna task altrui non bloccata su cui provare';
    return;
  end if;

  update public.tasks set titolo = titolo where id = v_task;
  raise notice 'PASS     UPDATE consentito su una task creata da un altro membro';
exception when others then
  raise notice 'FALLITO  UPDATE rifiutato: %', left(sqlerrm, 70);
end $$;

-- 3. Nessuna auto-promozione -------------------------------------------
do $$
begin
  update public.profiles set role = 'admin' where id = auth.uid();
  raise notice 'FALLITO  auto-promozione riuscita (GRAVE)';
exception when others then
  raise notice 'PASS     auto-promozione bloccata: %', left(sqlerrm, 70);
end $$;

-- 4. Il membro non può toccare la propria consegna dopo l'invio --------
do $$
declare v_id uuid;
begin
  select id into v_id
  from public.deliverable_versions
  where origin = 'originale' and uploaded_by = auth.uid()
  limit 1;

  if v_id is null then
    raise notice 'SKIP     il membro A non ha consegne in archivio';
    return;
  end if;

  update public.deliverable_versions set note = 'ripensamento' where id = v_id;
  raise notice 'FALLITO  il membro ha modificato la propria consegna (GRAVE)';
exception when others then
  raise notice 'PASS     consegna del membro immutabile: %', left(sqlerrm, 70);
end $$;

reset role;

-- --------------------------------------------------- diventa l'ADMIN
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.admin'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- 5. Nemmeno il Titolare riscrive o cancella un originale --------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.deliverable_versions where origin = 'originale' limit 1;
  if v_id is null then
    raise notice 'SKIP     nessuna consegna originale in archivio';
    return;
  end if;

  begin
    update public.deliverable_versions set sha256 = repeat('0', 64) where id = v_id;
    raise notice 'FALLITO  l''Admin ha riscritto un originale (GRAVE)';
  exception when others then
    raise notice 'PASS     UPDATE su originale bloccata: %', left(sqlerrm, 70);
  end;

  begin
    delete from public.deliverable_versions where id = v_id;
    raise notice 'FALLITO  l''Admin ha cancellato un originale (GRAVE)';
  exception when others then
    raise notice 'PASS     DELETE su originale bloccata: %', left(sqlerrm, 70);
  end;
end $$;

-- 6. Il Titolare non può fabbricare una consegna a nome del team -------
do $$
declare v_del uuid;
begin
  select id into v_del from public.deliverables limit 1;
  if v_del is null then
    raise notice 'SKIP     nessuna deliverable';
    return;
  end if;

  insert into public.deliverable_versions
    (deliverable_id, origin, bucket, storage_path, file_name, sha256, uploaded_by)
  values (v_del, 'originale', 'originali',
          gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '/finto.mp4',
          'finto.mp4', repeat('a', 64), auth.uid());
  raise notice 'FALLITO  l''Admin ha inserito una consegna a nome del team (GRAVE)';
exception when others then
  raise notice 'PASS     inserimento di un finto originale bloccato: %', left(sqlerrm, 70);
end $$;

reset role;

-- 7. Integrità della catena su tutte le deliverable --------------------
do $$
declare r record; totale int := 0; rotte int;
begin
  for r in select id from public.deliverables loop
    select count(*) into rotte from public.verifica_catena(r.id) where not integra;
    totale := totale + rotte;
  end loop;

  if totale = 0 then
    raise notice 'PASS     catena di hash integra su tutte le deliverable';
  else
    raise notice 'FALLITO  % record con catena rotta', totale;
  end if;
end $$;

rollback;
