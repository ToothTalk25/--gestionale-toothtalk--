"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        window.localStorage.removeItem("tt_ricordami");
        await supabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="tt-btn border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
    >
      Esci
    </button>
  );
}
