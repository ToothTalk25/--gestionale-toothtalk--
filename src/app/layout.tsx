import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import RegistraServiceWorker from "@/components/RegistraServiceWorker";

// Autoospitato da Next (nessuna richiesta a Google a runtime): quattro pesi,
// dal Regular del corpo testo al Bold dei titoli principali.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ToothTalk — Gestionale",
  description:
    "Gestionale interno ToothTalk: spazio di lavoro dei gruppi universitari e archivio dei materiali depositati",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Gestionale ToothTalk",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1b2a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={poppins.variable}>
      <body className="min-h-screen antialiased">
        <RegistraServiceWorker />
        {children}
      </body>
    </html>
  );
}
