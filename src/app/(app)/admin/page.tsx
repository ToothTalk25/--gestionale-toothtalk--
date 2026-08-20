import Link from "next/link";
import { requireAdmin, ordinaPoli } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { KIND_LABEL, type DeliverableKind, type Polo } from "@/lib/types";
import GestioneInviti, { type RigaInvito } from "@/components/GestioneInviti";
import FotoProfilo from "@/components/FotoProfilo";
import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";
import TerminaCollaborazione from "@/components/TerminaCollaborazione";
import ToggleOnScreen from "@/components/ToggleOnScreen";
import ScaricaRicevuta from "@/components/ScaricaRicevuta";
import ProfiliUscenti from "@/components/ProfiliUscenti";
import NavigazioneAdmin, { type SezioneAdmin } from "@/components/NavigazioneAdmin";
import SezioneAudit, { type RigaAudit } from "@/components/SezioneAudit";
import SezioneConsensi, { type RigaConsenso } from "@/components/SezioneConsensi";
import SezioneLiberatorie, { type RigaLiberatoria } from "@/components/SezioneLiberatorie";
import CaricaModelloAccordo, { type RigaModelloAccordo } from "@/components/CaricaModelloAccordo";
import AccordiDaApprovare, {
  type RigaAccordoDaApprovare,
} from "@/components/AccordiDaApprovare";
import RichiesteRegistrazione, {
  type RigaRichiestaRegistrazione,
} from "@/components/RichiesteRegistrazione";

type Confronto = {
  deliverable_id: string;
  task_id: string;
  kind: DeliverableKind;
  originale_file: string | null;
  originale_sigillata_il: string | null;
  finale_file: string | null;
  modificata_da_admin: boolean;
};

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const [
    { data: audit },
    { data: confronti },
    { data: profili },
    { data: poli },
    { data: inviti },
    { data: membri },
    { data: consensi },
    { data: materialiPerUtente },
    { data: registoConsensi },
    { data: richieste },
    { data: modelliAccordo },
    { data: accordiDaApprovare },
  ] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, at, action, entity_type, entity_id, actor, meta")
      .order("at", { ascending: false })
      .limit(80)
      .returns<RigaAudit[]>(),
    supabase
      .from("v_confronto_versioni")
      .select("*")
      .not("originale_version_id", "is", null)
      .limit(50)
      .returns<Confronto[]>(),
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, role, universita, foto_path, accordo_path, accordo_caricato_at, accordo_verificato, attivo, on_screen",
      )
      .order("role")
      .returns<
        {
          id: string;
          full_name: string | null;
          email: string;
          role: string;
          universita: string | null;
          foto_path: string | null;
          accordo_path: string | null;
          accordo_caricato_at: string | null;
          accordo_verificato: string | null;
          attivo: boolean;
          on_screen: boolean;
        }[]
      >(),
    supabase
      .from("poli")
      .select("id, nome, slug, citta, attivo")
      .eq("attivo", true)
      .order("nome")
      .returns<Polo[]>(),
    supabase
      .from("v_inviti")
      .select("*")
      .order("gruppo")
      .returns<RigaInvito[]>(),
    supabase
      .from("memberships")
      .select("user_id, poli!inner(nome)")
      .returns<{ user_id: string; poli: { nome: string } }[]>(),
    supabase
      .from("consensi")
      .select("id, user_id, tipo, versione, accettato_at, storage_path, sha256")
      .order("accettato_at", { ascending: false })
      .returns<RigaConsenso[]>(),
    supabaseAdmin()
      .from("deliverable_versions")
      .select("uploaded_by")
      .returns<{ uploaded_by: string }[]>(),
    supabaseAdmin()
      .from("consents_and_releases")
      .select(
        "id, task_id, user_id, tipo_soggetto, tipo, nome_soggetto, email_soggetto, sha256, metodo_firma, firmato_at, is_revoked, revocato_at",
      )
      .order("firmato_at", { ascending: false })
      .limit(200)
      .returns<RigaLiberatoria[]>(),
    // Richieste di registrazione: account creati ma non approvati (attivo=false,
    // senza approvato_at, non admin). È la coda di lavoro dell'admin.
    supabase
      .from("profiles")
      .select("id, full_name, email, universita, pec, on_screen")
      .eq("attivo", false)
      .is("approvato_at", null)
      .neq("role", "admin")
      .order("created_at", { ascending: true })
      .returns<RigaRichiestaRegistrazione[]>(),
    // Modelli dell'accordo editoriale (ultimo = attivo), con nome di chi ha caricato.
    supabaseAdmin()
      .from("modello_accordo")
      .select("id, storage_path, sha256, caricato_at, caricato_da, profiles!inner(full_name)")
      .order("caricato_at", { ascending: false })
      .returns<
        {
          id: string;
          storage_path: string;
          sha256: string;
          caricato_at: string;
          caricato_da: string | null;
          profiles: { full_name: string | null } | null;
        }[]
      >(),
    // Accordi caricati e verificati OK dall'IA ma in attesa di approvazione
    // MANUALE del Titolare (quarta condizione per sbloccare i progetti).
    supabase
      .from("profiles")
      .select("id, full_name, email, accordo_caricato_at, accordo_verificato, accordo_verifica_note")
      .not("accordo_path", "is", null)
      .eq("accordo_letto_confermato", true)
      .eq("accordo_verificato", "ok")
      .is("accordo_approvato_admin_at", null)
      .neq("role", "admin")
      .order("accordo_caricato_at", { ascending: true })
      .returns<RigaAccordoDaApprovare[]>(),
  ]);

  const nomi = Object.fromEntries(
    (profili ?? []).map((p) => [p.id, p.full_name ?? p.email]),
  );

  const poliDi: Record<string, string[]> = {};
  for (const m of membri ?? []) {
    (poliDi[m.user_id] ??= []).push(m.poli.nome);
  }

  // Conteggio materiali depositati per utente (per i riquadri "profili uscenti").
  const materialiDi: Record<string, number> = {};
  for (const v of materialiPerUtente ?? []) {
    materialiDi[v.uploaded_by] = (materialiDi[v.uploaded_by] ?? 0) + 1;
  }

  // Modelli dell'accordo nel formato atteso dal componente (nome caricatore).
  const modelli: RigaModelloAccordo[] = (modelliAccordo ?? []).map((m) => ({
    id: m.id,
    storage_path: m.storage_path,
    sha256: m.sha256,
    caricato_at: m.caricato_at,
    caricato_da: m.caricato_da,
    caricato_da_nome: m.profiles?.full_name ?? null,
  }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Registro globale</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vista trasversale su tutti i gruppi. Il registro è append-only:
          nessuna voce può essere modificata o cancellata, nemmeno da questa
          pagina.
        </p>
      </header>

      <NavigazioneAdmin
        sezioni={[
          {
            id: "inviti",
            etichetta: "Inviti",
            promemoria: {
              cosa: "crei o disattivi i codici che permettono a nuovi collaboratori di registrarsi in un polo.",
              attenzione: "disattivare un codice blocca subito nuove registrazioni con quel codice — non tocca chi si è già registrato.",
            },
            contenuto: <GestioneInviti poli={ordinaPoli(poli ?? [])} inviti={inviti ?? []} />,
          },
          {
            id: "confronto",
            etichetta: "Originale vs versione finale",
            promemoria: {
              cosa: "confronti il materiale depositato dal gruppo con l'eventuale versione che hai modificato tu prima della pubblicazione.",
              attenzione: "solo consultazione — nessuna azione possibile da qui.",
            },
            contenuto: (
              <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:p-6">
        <h2 className="text-lg font-medium">Originale vs versione finale</h2>
        <div className="mt-3 overflow-x-auto md:overflow-visible">
          <table className="tabella-mobile w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Materiale</th>
                <th className="py-2 pr-4">Deposito del gruppo</th>
                <th className="py-2 pr-4">Versione editata</th>
                <th className="py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {(confronti ?? []).map((r) => (
                <tr key={r.deliverable_id} className="border-t border-slate-100">
                  <td className="py-2 pr-4" data-label="Materiale">
                    <Link href={`/task/${r.task_id}`} className="hover:underline">
                      {KIND_LABEL[r.kind]}
                    </Link>
                  </td>
                  <td className="py-2 pr-4" data-label="Deposito del gruppo">
                    <div className="flex flex-col items-start gap-0.5">
                      <span>{r.originale_file}</span>
                      <span className="text-xs text-slate-400">
                        {r.originale_sigillata_il
                          ? new Date(r.originale_sigillata_il).toLocaleString("it-IT")
                          : ""}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-4" data-label="Versione editata">
                    {r.finale_file ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-2 text-xs" data-label="Stato">
                    {r.modificata_da_admin ? (
                      <span className="text-purple-700">editata</span>
                    ) : (
                      <span className="text-slate-500">originale invariato</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
            </section>
            )
          },
          {
            id: "log",
            etichetta: "Log delle operazioni",
            promemoria: {
              cosa: "consulti il registro immutabile di tutte le azioni amministrative (chi ha fatto cosa e quando).",
              attenzione: "solo lettura — il registro non si può modificare né cancellare, nemmeno da qui.",
            },
            contenuto: <SezioneAudit audit={audit ?? []} nomi={nomi} />,
          },
          {
            id: "richieste",
            etichetta: "Richieste di registrazione",
            promemoria: {
              cosa: "approvi o respingi le domande di chi si è appena registrato.",
              attenzione: "\"Approva\" attiva subito l'account e spedisce l'accordo editoriale via PEC alla persona — controlla prima che il modello caricato in \"Modello accordo\" sia quello giusto. Respingere/eliminare una richiesta è definitivo, non recuperabile.",
            },
            contenuto: <RichiesteRegistrazione richieste={richieste ?? []} />,
          },
          {
            id: "accordi-da-approvare",
            etichetta: "Accordi da approvare",
            promemoria: {
              cosa: "approvi MANUALMENTE l'accordo di chi l'ha già caricato, confermato la lettura e superato la verifica IA — è l'ultimo passaggio che sblocca l'accesso ai progetti.",
              attenzione: "L'approvazione è irreversibile e vale come tua firma sul controllo. Se l'esito IA non è 'ok' il profilo non compare qui; se per qualsiasi motivo compare con esito diverso, controllalo con particolare attenzione prima di approvare.",
            },
            contenuto: <AccordiDaApprovare accordi={accordiDaApprovare ?? []} />,
          },
          {
            id: "partecipanti",
            etichetta: "Registro partecipanti",
            promemoria: {
              cosa: "gestisci anagrafica, stato \"in video\" e chiusura della collaborazione di ogni partecipante attivo.",
              attenzione: "\"Termina Collaborazione\" per un partecipante on-screen cancella per sempre i video/audio grezzi che lo ritraggono (revoca GDPR incondizionata, irreversibile) — verifica lo stato \"in video\" prima di procedere, perché determina cosa viene distrutto.",
            },
            contenuto: (
              <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:p-6">
        <h2 className="text-lg font-medium">Registro partecipanti per sede</h2>
        <p className="mt-1 text-sm text-slate-500">
          Anagrafica e accordo editoriale dei partecipanti, raggruppati per
          gruppo.
        </p>
        <div className="mt-3 overflow-x-auto md:overflow-visible">
          <table className="tabella-mobile w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Gruppo</th>
                <th className="py-2 pr-4">Partecipante</th>
                <th className="py-2 pr-4">Università</th>
                <th className="py-2 pr-4">Foto</th>
                <th className="py-2 pr-4">Accordo editoriale</th>
                <th className="py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {(profili ?? [])
                .filter((p) => p.role !== "admin")
                .map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 text-xs text-slate-500" data-label="Gruppo">
                      {poliDi[p.id]?.join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-4" data-label="Partecipante">
                      <div className="flex flex-col items-start gap-1">
                        <span>{p.full_name ?? "—"}</span>
                        <span className="text-xs text-slate-400">{p.email}</span>
                        <ToggleOnScreen userId={p.id} appare={p.on_screen} />
                      </div>
                    </td>
                    <td className="py-2 pr-4" data-label="Università">{p.universita ?? "—"}</td>
                    <td className="py-2 pr-4" data-label="Foto">
                      {p.foto_path ? (
                        <FotoProfilo path={p.foto_path} className="h-12 w-12 rounded-lg object-cover" />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2" data-label="Accordo editoriale">
                      {p.accordo_path ? (
                        <span className="text-xs">
                          <span className="text-emerald-700">Caricato</span>
                          {p.accordo_caricato_at
                            ? ` · ${new Date(p.accordo_caricato_at).toLocaleDateString("it-IT")}`
                            : ""}
                          {p.accordo_verificato === "ok" && (
                            <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                              IA ok
                            </span>
                          )}
                          {p.accordo_verificato === "attenzione" && (
                            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                              IA: attenzione
                            </span>
                          )}
                          {p.accordo_verificato === "errato" && (
                            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
                              IA: errato
                            </span>
                          )}
                          {p.accordo_verificato === "non_valutato" && (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                              IA: non valutato
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Non caricato</span>
                      )}
                    </td>
                    <td className="py-2" data-label="Azioni">
                      <div className="flex flex-col items-start gap-1">
                        <TerminaCollaborazione
                          userId={p.id}
                          fullName={p.full_name}
                          onScreen={p.on_screen}
                          giaTerminata={!p.attivo}
                        />
                        <EliminaAccountAdmin userId={p.id} />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Creazione utenti e assegnazione ai poli:{" "}
          <code className="rounded bg-slate-100 px-1">npm run utente</code>
        </p>
      </section>
            )
          },
          {
            id: "uscenti",
            etichetta: "Profili uscenti",
            promemoria: {
              cosa: "vedi chi ha un account disattivato e cosa comporta eliminarlo del tutto (il dettaglio, per ciascuno, è già qui sotto).",
              attenzione: "\"Elimina account\" è definitivo — leggi il riquadro rosso/verde per ogni profilo prima di confermare.",
            },
            contenuto: (
              <ProfiliUscenti
                profili={profili ?? []}
                poliDi={poliDi}
                materialiDi={materialiDi}
              />
            ),
          },
          {
            id: "consensi",
            etichetta: "Consensi GDPR",
            promemoria: {
              cosa: "consulti il registro dei consensi privacy/cookie/riconoscimento-foto raccolti, con le ricevute firmate scaricabili.",
              attenzione: "solo consultazione — nessuna azione qui modifica lo stato di un consenso.",
            },
            contenuto: <SezioneConsensi consensi={consensi ?? []} nomi={nomi} />,
          },
          {
            id: "liberatorie",
            etichetta: "Liberatorie e accordi",
            promemoria: {
              cosa: "consulti il registro delle liberatorie firmate da soggetti esterni e degli accordi caricati dai collaboratori.",
              attenzione: "solo consultazione — i documenti restano protetti, non sono scaricabili da qui per tutela della privacy dei terzi.",
            },
            contenuto: <SezioneLiberatorie documenti={registoConsensi ?? []} />,
          },
          {
            id: "modello-accordo",
            etichetta: "Modello accordo",
            promemoria: {
              cosa: "carichi il documento dell'accordo editoriale che verrà inviato automaticamente a ogni nuova registrazione approvata.",
              attenzione: "l'ultimo modello caricato diventa SUBITO quello attivo, usato dalla prossima approvazione — controllalo bene prima di caricarlo.",
            },
            contenuto: <CaricaModelloAccordo modelli={modelli} />,
          },
        ]}
      />
    </div>
  );
}
