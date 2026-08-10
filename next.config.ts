import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: {
      // I file grossi NON passano dalle server action: il browser carica
      // direttamente su Supabase Storage. Qui viaggiano solo i metadati.
      bodySizeLimit: "1mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Impedisce di caricare la pagina dentro un iframe (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Blocca il MIME-sniffing dei browser.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Non invia il referrer oltre il dominio.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Limita le funzioni browser non usate.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Solo HTTPS quando pubblicato (ignorato in locale su http).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default config;