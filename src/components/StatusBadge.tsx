import { STATUS_LABEL, type TaskStatus } from "@/lib/types";

const COLORI: Record<TaskStatus, string> = {
  da_fare: "bg-slate-100 text-slate-700",
  consegnato: "bg-blue-100 text-blue-800",
  in_revisione: "bg-amber-100 text-amber-800",
  modificato_admin: "bg-purple-100 text-purple-800",
  approvato: "bg-emerald-100 text-emerald-800",
  sigillato: "bg-orange-100 text-orange-800",
  pubblicato: "bg-tt-blue text-white",
  respinto: "bg-red-100 text-red-800",
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORI[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
