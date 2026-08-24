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
          // Limita da dove pagina/script/stili/immagini possono essere
          // caricati: riduce l'impatto di un eventuale XSS. 'unsafe-inline'
          // su script/style resta necessario per l'hydration di Next.js e
          // per le classi Tailwind; niente domini di terze parti altrove.
          // 'wasm-unsafe-eval' è sempre presente (anche in produzione): serve
          // a hash-wasm per calcolare l'impronta SHA-256 di ogni file
          // caricato — senza, ogni upload fallisce con un errore CSP. È un
          // permesso molto più ristretto di 'unsafe-eval' (consente solo
          // WebAssembly.instantiate, non eval()/Function()), quindi non
          // riapre la superficie che 'unsafe-eval' proteggeva.
          // 'unsafe-eval' pieno resta solo in sviluppo: Turbopack/webpack lo
          // usano per l'hot-reload, React non lo usa mai in produzione.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;