import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

for (const riga of readFileSync(".env.local", "utf8").split("\n")) {
  const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: admins } = await db.from("profiles").select("id, email").eq("role", "admin").eq("attivo", true);
console.log("accessi globali attivi:", (admins ?? []).map((a) => a.email).join(", "));

const { data: iscrizioni } = await db
  .from("push_subscriptions")
  .select("id, user_id, endpoint, chiave_p256dh, chiave_auth, created_at")
  .in("user_id", (admins ?? []).map((a) => a.id));
console.log(`dispositivi iscritti alle notifiche: ${iscrizioni?.length ?? 0}`);
for (const i of iscrizioni ?? []) {
  console.log(`  ${i.created_at?.slice(0, 16)} · ${i.endpoint.slice(0, 50)}…`);
}

if (!iscrizioni?.length) {
  console.log("\nNessun dispositivo iscritto: va prima attivato dal telefono (con l'app installata).");
  process.exit(0);
}

const mancanti = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].filter((k) => !process.env[k]);
if (mancanti.length) {
  console.log("chiavi mancanti in .env.local:", mancanti.join(", "));
  process.exit(1);
}

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
const payload = JSON.stringify({
  title: "ToothTalk — prova notifiche",
  body: "Se leggi questo avviso, le notifiche arrivano sul tuo telefono.",
  url: "/admin",
});

for (const i of iscrizioni) {
  try {
    await webpush.sendNotification(
      { endpoint: i.endpoint, keys: { p256dh: i.chiave_p256dh, auth: i.chiave_auth } },
      payload,
    );
    console.log("inviata ✓");
  } catch (e) {
    const stato = e?.statusCode;
    console.log(`invio fallito ✗ ${stato ?? ""} ${e?.body ?? e?.message ?? ""}`.slice(0, 160));
    if (stato === 404 || stato === 410) {
      await db.from("push_subscriptions").delete().eq("id", i.id);
      console.log("  iscrizione scaduta rimossa");
    }
  }
}
