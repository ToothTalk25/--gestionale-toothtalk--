import { requireSession } from "@/lib/auth";
import ProfiloPersonale from "@/components/ProfiloPersonale";
import ProfiloAdmin from "@/components/ProfiloAdmin";
import SezioneEliminazioneAccount from "@/components/SezioneEliminazioneAccount";
import FotoProfilo from "@/components/FotoProfilo";

export default async function ProfiloPage() {
  const { profile, isAdmin } = await requireSession();

  const iniziali = (profile.full_name ?? profile.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[25px] font-semibold tracking-[-0.015em]">Il mio profilo</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isAdmin
            ? "I tuoi dati e gli strumenti del Coordinatore."
            : "I tuoi dati personali e l'accordo editoriale. L'accordo, una volta caricato, viene inviato automaticamente a chi ha accesso globale via PEC con data certa."}
        </p>
      </header>

      <div className="tt-card flex items-center gap-4 p-5">
        {profile.foto_path ? (
          <FotoProfilo
            path={profile.foto_path}
            alt=""
            className="h-16 w-16 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-tt-blue-50 text-xl font-semibold text-tt-blue-600">
            {iniziali}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-tt-ink">
            {profile.full_name ?? profile.email}
          </p>
          <p className="truncate text-sm text-slate-500">{profile.email}</p>
        </div>
      </div>

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
