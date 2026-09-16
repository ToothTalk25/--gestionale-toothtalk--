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
              // 'blob:' in script-src serve a ffmpeg.wasm (remux del video di
              // dichiarazione, vedi RegistraVideoDichiarazione): il suo worker
              // viene caricato da un blob: URL, e Chrome verifica questo
              // caricamento con script-src quando script-src-elem non è
              // impostato esplicitamente (non basta worker-src da solo,
              // verificato empiricamente). Il blob deriva comunque da un file
              // che l'app stessa ha scaricato da /ffmpeg (stesso dominio),
              // non da una CDN esterna.
              `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              // 'blob:' serve alla revisione del video di dichiarazione
              // registrato in-app: il blob vive solo nel browser del
              // Collaboratore e non viene mai trasferito prima della
              // conferma esplicita. https://*.supabase.co serve al player
              // del Coordinatore in ControlliAdminDichiarazione, che punta
              // direttamente a un URL firmato di Storage (non a un blob
              // locale) — senza, il browser blocca il caricamento per CSP e
              // sembra un problema di formato/codec quando non lo è
              // (verificato: l'oggetto su Storage è un mp4 valido, con
              // supporto Range/206 corretto).
              "media-src 'self' blob: https://*.supabase.co",
              "font-src 'self' data:",
              // blob: qui serve allo stesso worker di ffmpeg.wasm di cui
              // sopra: comunica col proprio script (caricato da blob:) anche
              // via connect-src, non solo script-src.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // La registrazione in-app del video di dichiarazione (slot 7/7b del
      // "Video completo") usa camera e microfono: la Permissions-Policy
      // globale sopra li nega, quindi qui li riapre SOLO sulle pagine del
      // progetto, dove il componente RegistraVideoDichiarazione vive.
      // Tutto il resto dell'app resta con la policy stretta.
      {
        source: "/task/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;