// Transforma o que a pessoa enviou (imagens ou texto) em lotes de exportação.
// Os erros carregam só um código e o nome do arquivo, nunca o conteúdo do QR.
import { findMigrationUris } from "./collect";
import { fileToImageData, ImageDecodeError, isImageFile } from "./image";
import { decodeMigrationUri, isMigrationUri, type MigrationBatch, MigrationError, type MigrationErrorCode } from "./migration";

export type IntakeErrorCode =
  | "no_qr"
  | "not_migration_qr"
  | "single_account"
  | "image"
  | "heic"
  | "not_image"
  | "reader"
  | MigrationErrorCode;

export interface IntakeError {
  /** Nome do arquivo, ou null quando veio de texto colado. */
  source: string | null;
  code: IntakeErrorCode;
}

export interface IntakeResult {
  batches: MigrationBatch[];
  errors: IntakeError[];
}

function decodeTexts(texts: string[], source: string | null, out: IntakeResult, fromQr: boolean) {
  const migration = texts.filter(isMigrationUri);
  if (migration.length === 0) {
    const single = texts.some((t) => /^otpauth:\/\//i.test(t.trim()));
    out.errors.push({ source, code: single ? "single_account" : fromQr ? "not_migration_qr" : "not_migration" });
    return;
  }
  for (const text of migration) {
    try {
      out.batches.push(decodeMigrationUri(text));
    } catch (error) {
      out.errors.push({ source, code: error instanceof MigrationError ? error.code : "invalid_payload" });
    }
  }
}

export function intakeText(text: string): IntakeResult {
  const out: IntakeResult = { batches: [], errors: [] };
  const uris = findMigrationUris(text);
  decodeTexts(uris.length ? uris : [text], null, out, false);
  return out;
}

export async function intakeFiles(files: readonly File[]): Promise<IntakeResult> {
  const out: IntakeResult = { batches: [], errors: [] };
  for (const file of files) {
    if (!isImageFile(file)) {
      out.errors.push({ source: file.name, code: "not_image" });
      continue;
    }
    let frames: ImageData[];
    try {
      frames = await fileToImageData(file);
    } catch (error) {
      out.errors.push({ source: file.name, code: error instanceof ImageDecodeError && error.heic ? "heic" : "image" });
      continue;
    }
    const texts: string[] = [];
    try {
      const { readQrTexts } = await import("./qr-reader");
      for (const frame of frames) {
        for (const text of await readQrTexts(frame)) if (!texts.includes(text)) texts.push(text);
        if (texts.some(isMigrationUri)) break;
      }
    } catch {
      out.errors.push({ source: file.name, code: "reader" });
      continue;
    }
    if (texts.length === 0) {
      out.errors.push({ source: file.name, code: "no_qr" });
      continue;
    }
    decodeTexts(texts, file.name, out, true);
  }
  return out;
}
