import { STATUS_LABEL, type TaskStatus } from "@/lib/types";

const COLORI: Record<TaskStatus, string> = {
  da_fare: "bg-slate-100 text-slate-600",
  consegnato: "bg-tt-blue-50 text-tt-blue-600",
  in_revisione: "bg-[#fef3e2] text-amber-700",
  modificato_admin: "bg-purple-100 text-purple-800",
  approvato: "bg-emerald-100 text-emerald-800",
  sigillato: "bg-orange-50 text-orange-700",
  archived_due_to_revocation: "bg-rose-100 text-rose-800",
  pubblicato: "bg-tt-blue text-white",
  respinto: "bg-red-100 text-red-800",
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-[11px] py-[3px] text-xs font-semibold ${COLORI[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
