import { requireSession } from "@/lib/auth";
import ProfiloPersonale from "@/components/ProfiloPersonale";
import SezioneEliminazioneAccount from "@/components/SezioneEliminazioneAccount";

export default async function ProfiloPage() {
  const { profile, isAdmin } = await requireSession();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Il mio profilo</h1>
        <p className="mt-1 text-sm text-slate-500">
          I tuoi dati personali e l'accordo editoriale. L'accordo, una volta
          caricato, viene inviato automaticamente a chi ha accesso globale via
          PEC con data certa.
        </p>
      </header>

      <ProfiloPersonale profile={profile} isAdmin={isAdmin} />

      {!isAdmin && <SezioneEliminazioneAccount userId={profile.id} />}
    </div>
  );
}
