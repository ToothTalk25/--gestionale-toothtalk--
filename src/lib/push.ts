import "server-only";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/admin";

function configurato(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function configura(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/**
 * Manda una notifica push a tutti i dispositivi di tutti gli admin attivi.
 * Best-effort e mai bloccante: se le chiavi VAPID mancano o l'invio fallisce
 * per un dispositivo, non lancia — la domanda/azione che l'ha innescata
 * resta comunque valida, la notifica è solo un avviso in più.
 * Le iscrizioni scadute (410/404, il dispositivo non esiste più lato
 * browser) vengono rimosse per non riprovarci a vuoto ogni volta.
 */
export async function inviaPushAdmin(payload: { title: string; body: string; url: string }): Promise<void> {
  if (!configurato()) return;
  configura();

  const admin = supabaseAdmin();
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").eq("attivo", true);
  const idAdmin = (admins ?? []).map((a) => a.id);
  if (idAdmin.length === 0) return;

  const { data: iscrizioni } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, chiave_p256dh, chiave_auth")
    .in("user_id", idAdmin);
  if (!iscrizioni?.length) return;

  const corpo = JSON.stringify(payload);
  await Promise.all(
    iscrizioni.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.chiave_p256dh, auth: s.chiave_auth } },
          corpo,
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          console.error("Invio push fallito:", e);
        }
      }
    }),
  );
}
