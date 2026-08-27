"use client";

import { useRouter } from "next/navigation";
import { esci } from "@/app/actions-auth";

export default function LogoutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        window.localStorage.removeItem("tt_ricordami");
        await esci();
        router.replace("/login");
        router.refresh();
      }}
      className="tt-btn border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
    >
      Esci
    </button>
  );
}
