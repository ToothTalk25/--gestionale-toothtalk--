import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { elencaCollaboratoriTecnici } from "@/app/actions-tecnico";
import PannelloTecnico from "@/components/PannelloTecnico";
import TornaIndietro from "@/components/TornaIndietro";

/**
 * Pagina admin-only per il Collaboratore Tecnico (Documento 5): anagrafica,
 * registro degli accessi (Allegato 1 digitale) e rinnovo — Opzione B, vedi
 * note-legali/PROMPT_claude_code_pagina_admin_collaboratore_tecnico.md.
 * Nessun profilo applicativo corrisponde a queste righe: non c'è nulla da
 * mostrare al Collaboratore Tecnico stesso, solo all'accesso globale.
 */
export default async function TecnicoPage() {
  await requireAdmin();
  const esito = await elencaCollaboratoriTecnici();

  return (
    <div className="space-y-8">
      <TornaIndietro href="/admin" etichetta="Registro globale" />
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Collaboratore Tecnico</h1>
        <p className="mt-1 text-sm text-slate-500">
          Anagrafica, registro degli accessi e rinnovo del Documento 5 — nessun
          login applicativo corrisponde a queste righe.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          <Link href="/documenti" className="text-tt-blue underline">
            Documento 5 nella libreria pubblica
          </Link>
        </p>
      </header>

      {esito.ok ? (
        <PannelloTecnico collaboratori={esito.dati} />
      ) : (
        <p className="tt-card p-6 text-sm text-red-600">Errore: {esito.errore}</p>
      )}
    </div>
  );
}
