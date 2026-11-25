import { decodeMigrationUri, type MigrationBatch, type OtpAccount } from "./migration";

/**
 * Junta as contas de vários QRs (exportação em "1 de 3"), sem repetir a mesma
 * conta, e guarda quais partes de cada lote já foram lidas para avisar o que falta.
 */
export interface Collection {
  accounts: OtpAccount[];
  /** batchId → tamanho do lote e índices (base 0) já lidos. */
  batches: Map<number, { size: number; indexes: Set<number> }>;
  /** Chaves das contas já vistas, para a deduplicação. */
  seen: Set<string>;
}

export interface MissingParts {
  batchId: number;
  size: number;
  read: number;
  /** Números das partes que faltam, contando de 1, como o app mostra ("2 de 3"). */
  missing: number[];
}

export function emptyCollection(): Collection {
  return { accounts: [], batches: new Map(), seen: new Set() };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function accountKey(account: OtpAccount): string {
  return JSON.stringify([account.issuer, account.name, hex(account.secret)]);
}

/** Acrescenta um lote já decodificado. Devolve quantas contas novas entraram. */
export function addBatch(collection: Collection, batch: MigrationBatch): number {
  const entry = collection.batches.get(batch.batchId) ?? { size: batch.batchSize, indexes: new Set<number>() };
  entry.size = Math.max(entry.size, batch.batchSize);
  entry.indexes.add(batch.batchIndex);
  collection.batches.set(batch.batchId, entry);
  let added = 0;
  for (const account of batch.accounts) {
    const key = accountKey(account);
    if (!collection.seen.has(key)) {
      collection.seen.add(key);
      collection.accounts.push(account);
      added += 1;
    }
  }
  return added;
}

/** Decodifica cada URI de exportação e junta tudo. Lança MigrationError na primeira inválida. */
export function collectFromUris(uris: readonly string[], collection = emptyCollection()): Collection {
  for (const uri of uris) addBatch(collection, decodeMigrationUri(uri));
  return collection;
}

export function missingParts(collection: Collection): MissingParts[] {
  const result: MissingParts[] = [];
  for (const [batchId, { size, indexes }] of collection.batches) {
    if (indexes.size < size) {
      const missing: number[] = [];
      for (let i = 0; i < size; i += 1) if (!indexes.has(i)) missing.push(i + 1);
      result.push({ batchId, size, read: indexes.size, missing });
    }
  }
  return result;
}

/** Acha as URIs de exportação num texto colado (uma ou várias, separadas por espaço ou linha). */
export function findMigrationUris(text: string): string[] {
  return text.match(/otpauth-migration:\S+/gi) ?? [];
}
