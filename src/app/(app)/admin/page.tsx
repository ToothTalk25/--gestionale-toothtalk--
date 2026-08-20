import Link from "next/link";
import { requireAdmin, ordinaPoli } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { KIND_LABEL, type DeliverableKind, type Polo } from "@/lib/types";
import GestioneInviti, { type RigaInvito } from "@/components/GestioneInviti";
import FotoProfilo from "@/components/FotoProfilo";
import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";
import TerminaCollaborazione from "@/components/TerminaCollaborazione";
import ScaricaRicevuta from "@/components/ScaricaRicevuta";
import ProfiliUscenti from "@/components/ProfiliUscenti";
import NavigazioneAdmin, { type SezioneAdmin } from "@/components/NavigazioneAdmin";
import SezioneAudit, { type RigaAudit } from "@/components/SezioneAudit";
import SezioneConsensi, { type RigaConsenso } from "@/components/SezioneConsensi";
import SezioneLiberatorie, { type RigaLiberatoria } from "@/components/SezioneLiberatorie";
import CaricaModelloAccordo, { type RigaModelloAccordo } from "@/components/CaricaModelloAccordo";
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
            contenuto: <GestioneInviti poli={ordinaPoli(poli ?? [])} inviti={inviti ?? []} />,
          },
          {
            id: "confronto",
            etichetta: "Originale vs versione finale",
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
                    {r.originale_file}
                    <div className="text-xs text-slate-400">
                      {r.originale_sigillata_il
                        ? new Date(r.originale_sigillata_il).toLocaleString("it-IT")
                        : ""}
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
            contenuto: <SezioneAudit audit={audit ?? []} nomi={nomi} />,
          },
          {
            id: "richieste",
            etichetta: "Richieste di registrazione",
            contenuto: <RichiesteRegistrazione richieste={richieste ?? []} />,
          },
          {
            id: "partecipanti",
            etichetta: "Registro partecipanti",
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
                      {p.full_name ?? "—"}
                      <div className="text-xs text-slate-400">{p.email}</div>
                      {p.on_screen && (
                        <span className="mt-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                          In video
                        </span>
                      )}
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
            contenuto: <SezioneConsensi consensi={consensi ?? []} nomi={nomi} />,
          },
          {
            id: "liberatorie",
            etichetta: "Liberatorie e accordi",
            contenuto: <SezioneLiberatorie documenti={registoConsensi ?? []} />,
          },
          {
            id: "modello-accordo",
            etichetta: "Modello accordo",
            contenuto: <CaricaModelloAccordo modelli={modelli} />,
          },
        ]}
      />
    </div>
  );
}
