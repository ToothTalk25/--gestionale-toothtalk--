import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/logo-sintetico.svg");
const raster = await sharp(svg, { density: 150 }).png().toBuffer();
const tagliato = await sharp(raster).trim({ threshold: 10 }).toBuffer();

// Raggio ~22.37% del lato: approssimazione dello "squircle" delle icone
// macOS (Big Sur in poi) — così l'icona nel Dock ha gli stessi angoli
// arrotondati delle app native (VS Code, GitHub Desktop), che Chrome non
// applica da solo alle app installate come PWA.
async function iconaArrotondata(dest, size, riempimento) {
  const interno = Math.round(size * riempimento);
  const bordo = Math.round((size - interno) / 2);
  const base = await sharp(tagliato)
    .resize(interno, interno, { fit: "contain", background: "#ffffff" })
    .extend({ top: bordo, bottom: bordo, left: bordo, right: bordo, background: "#ffffff" })
    .resize(size, size)
    .png()
    .toBuffer();

  const raggio = Math.round(size * 0.2237);
  const maschera = Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${raggio}" ry="${raggio}" fill="#fff"/></svg>`,
  );

  await sharp(base)
    .composite([{ input: maschera, blend: "dest-in" }])
    .png()
    .toFile(dest);
  console.log("creata", dest);
}

await iconaArrotondata("public/icon-192.png", 192, 0.82);
await iconaArrotondata("public/icon-512.png", 512, 0.82);
