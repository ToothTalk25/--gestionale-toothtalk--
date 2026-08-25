/**
 * Icone per le azioni ricorrenti sui file (scarica/elimina/carica) — stesso
 * tratto minimale di IconaKind in KindCard.tsx, per restare coerenti col
 * resto del gestionale. Solo grafica: il nome accessibile va sempre
 * passato dal chiamante via title/aria-label sul <button>, l'icona da
 * sola non basta a chi usa uno screen reader.
 */
type Props = { size?: number; className?: string };

const comuni = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
});

export function IconaScarica({ size = 16, className }: Props) {
  return (
    <svg {...comuni(size)} className={className}>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function IconaCarica({ size = 16, className }: Props) {
  return (
    <svg {...comuni(size)} className={className}>
      <path d="M12 13V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function IconaElimina({ size = 16, className }: Props) {
  return (
    <svg {...comuni(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function IconaConferma({ size = 16, className }: Props) {
  return (
    <svg {...comuni(size)} className={className}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function IconaAnnulla({ size = 16, className }: Props) {
  return (
    <svg {...comuni(size)} className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function IconaSpinner({ size = 16, className = "" }: Props) {
  return (
    <svg {...comuni(size)} className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
