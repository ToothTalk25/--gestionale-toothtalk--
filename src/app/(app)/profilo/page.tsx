import { requireSession } from "@/lib/auth";
import ProfiloPersonale from "@/components/ProfiloPersonale";
import ProfiloAdmin from "@/components/ProfiloAdmin";
import SezioneEliminazioneAccount from "@/components/SezioneEliminazioneAccount";

export default async function ProfiloPage() {
  const { profile, isAdmin } = await requireSession();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Il mio profilo</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isAdmin
            ? "I tuoi dati e gli strumenti del Coordinatore."
            : "I tuoi dati personali e l'accordo editoriale. L'accordo, una volta caricato, viene inviato automaticamente a chi ha accesso globale via PEC con data certa."}
        </p>
      </header>

      {isAdmin ? (
        <ProfiloAdmin profile={profile} />
      ) : (
        <>
          <ProfiloPersonale profile={profile} isAdmin={isAdmin} />
          <SezioneEliminazioneAccount userId={profile.id} />
        </>
      )}
    </div>
  );
}
