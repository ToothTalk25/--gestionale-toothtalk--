import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import RegistraServiceWorker from "@/components/RegistraServiceWorker";

// Autoospitato da Next (nessuna richiesta a Google a runtime): quattro pesi,
// dal Regular del corpo testo al Bold dei titoli principali.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gestionale ToothTalk",
  description:
    "Gestionale interno ToothTalk: spazio di lavoro dei poli e archivio dei materiali depositati",
  manifest: "/manifest.json",
  applicationName: "Gestionale ToothTalk",
  appleWebApp: {
    capable: true,
    title: "Gestionale ToothTalk",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1b2a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={poppins.variable}>
      <head>
        {/* PWA iOS: questi tag Next.js non li genera da solo. "capable" è
            quello che fa aprire l'app a schermo intero SENZA barra URL quando
            viene aggiunta a Home; status-bar-style rende lo sfondo della
            status bar trasparente col logo. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="min-h-screen antialiased">
        <RegistraServiceWorker />
        {children}
      </body>
    </html>
  );
}
