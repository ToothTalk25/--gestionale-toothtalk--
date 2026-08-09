import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

type Drive = drive_v3.Drive;

// -------------------------------------------------------------------- config

function keyFile(): string | null {
  const path = process.env.GOOGLE_DRIVE_KEYFILE;
  if (!path || !existsSync(path)) return null;
  return path;
}

function rootFolder(): string | null {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER || null;
}

export function driveConfigurato(): boolean {
  return keyFile() !== null && rootFolder() !== null;
}

// ------------------------------------------------------------------ client

let _drive: Drive | null = null;

async function getDrive(): Promise<Drive | null> {
  if (_drive) return _drive;
  const kf = keyFile();
  if (!kf) return null;

  const creds = JSON.parse(readFileSync(kf, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  _drive = google.drive({ version: "v3", auth });
  return _drive;
}

// ------------------------------------------------------------------- folder

/** Trova o crea una cartella dentro `parentId` con il nome `nome`. */
async function findOrCreateFolder(
  drive: Drive,
  parentId: string,
  nome: string,
): Promise<string> {
  const res = await drive.files.list({
    q: [
      `'${parentId}' in parents`,
      `name = '${nome.replace(/'/g, "\\'")}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ].join(" and "),
    fields: "files(id)",
  });

  if (res.data.files?.length) return res.data.files[0].id!;

  const folder = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return folder.data.id!;
}

// -------------------------------------------------------------------- upload

export type FileBuffer = {
  name: string;
  content: Buffer;
  mimeType?: string;
};

/**
 * Esporta i file del pacchetto nella cartella Drive:
 *   <root>/<polo>/<progetto>/
 *
 * Se Drive non è configurato, non fa nulla e restituisce null.
 */
export async function esportaPacchettoSuDrive(opts: {
  polo: string;
  progetto: string;
  files: FileBuffer[];
}): Promise<string | null> {
  const drive = await getDrive();
  const root = rootFolder();
  if (!drive || !root) return null;

  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, "_");

  const poloFolder = await findOrCreateFolder(drive, root, sanitize(opts.polo));
  const projFolder = await findOrCreateFolder(
    drive,
    poloFolder,
    sanitize(opts.progetto),
  );

  const ids: string[] = [];
  for (const f of opts.files) {
    const res = await drive.files.create({
      requestBody: {
        name: f.name,
        parents: [projFolder],
      },
      media: {
        mimeType: f.mimeType ?? "application/octet-stream",
        body: Readable.from(f.content),
      },
      fields: "id",
    });
    ids.push(res.data.id!);
  }

  return projFolder;
}
