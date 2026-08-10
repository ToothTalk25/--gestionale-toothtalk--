import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: {
      // I file grossi NON passano dalle server action: il browser carica
      // direttamente su Supabase Storage. Qui viaggiano solo i metadati.
      bodySizeLimit: "1mb",
    },
  },
};

export default config;