"use client";

import { useState } from "react";
import { IconaOcchio, IconaOcchioBarrato } from "@/components/icone-azioni";

/**
 * Campo password con occhietto per mostrare/nascondere il testo mentre si
 * digita. Stessa resa visiva del campo standard del progetto (il bottone non
 * invia il form: type="button").
 */
export default function CampoPassword({
  value,
  onChange,
  required,
  minLength,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [visibile, setVisibile] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        type={visibile ? "text" : "password"}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-9 text-sm"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisibile((v) => !v)}
        aria-label={visibile ? "Nascondi password" : "Mostra password"}
        title={visibile ? "Nascondi password" : "Mostra password"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600"
      >
        {visibile ? <IconaOcchioBarrato size={18} /> : <IconaOcchio size={18} />}
      </button>
    </div>
  );
}
