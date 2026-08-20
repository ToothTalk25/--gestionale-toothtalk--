/**
 * Promemoria in cima a ogni sezione del Registro globale: cosa si fa qui e
 * a cosa fare attenzione. Solo informativo, nessuna azione — l'obiettivo è
 * far leggere il rischio prima di cliccare, non dopo.
 */
export default function PromemoriaSezione({
  cosa,
  attenzione,
}: {
  cosa: string;
  attenzione?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-slate-200 sm:flex-row sm:gap-4">
      <p className="text-slate-600">
        <span className="font-medium text-slate-700">Cosa fai qui: </span>
        {cosa}
      </p>
      {attenzione && (
        <p className="text-amber-800">
          <span className="font-medium">⚠ Attenzione: </span>
          {attenzione}
        </p>
      )}
    </div>
  );
}
