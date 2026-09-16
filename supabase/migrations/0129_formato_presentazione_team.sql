-- =====================================================================
-- 0129_formato_presentazione_team.sql — nuovo formato "Presentazione del
-- team", per il video di benvenuto che un nuovo team gira quando entra
-- nel progetto ("Script video di benvenuto per un nuovo team").
-- =====================================================================
-- richiede_liberatoria = false: chi compare nel video sono i componenti
-- del team stesso, già Collaboratori con accordo firmato — non persone
-- esterne al progetto. Non serve quindi la liberatoria né il video di
-- dichiarazione (slot 6/7/7b), che restano comunque disattivabili a
-- livello di singolo progetto tramite "coinvolge_terzi" (0013), non
-- legati al formato.
--
-- script_richiesto = 'completo': lo script è fisso (vedi la guida), ma
-- resta comunque il testo integrale di ciò che si dice nel video — va
-- solo adattato con nomi e città reali, non scritto da zero.
-- =====================================================================

insert into public.formati (slug, nome, richiede_liberatoria, script_richiesto, istruzioni_script)
values (
  'presentazione_team',
  'Presentazione del team',
  false,
  'completo',
  'Lo script è FISSO (vedi "Script video di benvenuto per un nuovo team", '
    'Parte 1): incolla qui il testo con [UNIVERSITÀ]/[Città] e i nomi dei '
    'componenti già sostituiti con quelli reali del tuo team — non va '
    'scritto da zero.'
)
on conflict (slug) do update set
  nome = excluded.nome,
  richiede_liberatoria = excluded.richiede_liberatoria,
  script_richiesto = excluded.script_richiesto,
  istruzioni_script = excluded.istruzioni_script;
