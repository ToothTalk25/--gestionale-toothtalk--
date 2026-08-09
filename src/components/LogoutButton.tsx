"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
    >
      Esci
    </button>
  );
}
