/**
 * Contenuto condiviso fra l'email di onboarding (actions-onboarding.ts) e la
 * pagina pubblica /benvenuto: un solo posto dove aggiornare le istruzioni di
 * installazione PWA, invece di tenerle allineate a mano in due punti.
 */

export const URL_APP = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export type PassiPiattaforma = { titolo: string; passi: string[] };

export const ISTRUZIONI_INSTALLAZIONE: PassiPiattaforma[] = [
  {
    titolo: "iPhone (in Safari — non funziona da altri browser)",
    passi: [
      "Apri il link del Gestionale",
      "Tocca l'icona di condivisione (il quadrato con la freccia verso l'alto, in basso al centro)",
      'Scorri e tocca "Aggiungi a Home"',
      'Conferma con "Aggiungi" in alto a destra',
    ],
  },
  {
    titolo: "Android (in Chrome)",
    passi: [
      "Apri il link del Gestionale",
      "Tocca i tre puntini in alto a destra",
      'Tocca "Installa app" (oppure "Aggiungi a schermata Home")',
      "Conferma",
    ],
  },
  {
    titolo: "Mac",
    passi: [
      'Chrome o Edge: apri il link, clicca l\'icona di installazione nella barra degli indirizzi (a destra, un monitor con una freccia), poi "Installa"',
      'Safari: apri il link, dal menu File scegli "Aggiungi al Dock"',
    ],
  },
  {
    titolo: "Windows (Chrome o Edge)",
    passi: [
      "Apri il link del Gestionale",
      'Clicca l\'icona di installazione nella barra degli indirizzi (o, su Edge, i tre puntini in alto → "App" → "Installa questo sito come app")',
      "Conferma",
    ],
  },
];
