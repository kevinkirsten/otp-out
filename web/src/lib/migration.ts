// Decodificador do QR de exportação do Google Authenticator
// (otpauth-migration://offline?data=...). Porta do otp_import.py original,
// com o protobuf MigrationPayload lido à mão, sem biblioteca.
//
// Regra de segurança: nenhuma mensagem de erro carrega dado do QR. O erro só
// tem um código fixo, e o texto mostrado na tela vem do dicionário de idiomas.

export type MigrationErrorCode =
  | "not_migration"
  | "missing_data"
  | "invalid_base64"
  | "truncated"
  | "invalid_payload"
  | "missing_secret";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode) {
    super(code);
    this.name = "MigrationError";
    this.code = code;
  }
}

export type OtpType = "totp" | "hotp";
export type Algorithm = "SHA1" | "SHA256" | "SHA512" | "MD5";

export interface OtpAccount {
  secret: Uint8Array;
  name: string;
  issuer: string;
  algorithm: Algorithm;
  digits: number;
  type: OtpType;
  /** uint64 do protobuf; BigInt para não perder precisão acima de 2^53. */
  counter: bigint;
}

export interface MigrationBatch {
  accounts: OtpAccount[];
  batchSize: number;
  batchIndex: number;
  batchId: number;
}

// Enums do MigrationPayload. "0" é "não informado".
const ALGORITHMS: Record<number, Algorithm> = { 0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512", 4: "MD5" };
const DIGIT_COUNTS: Record<number, number> = { 0: 6, 1: 6, 2: 8 };
const OTP_TYPES: Record<number, OtpType> = { 0: "totp", 1: "hotp", 2: "totp" };

export const SUPPORTED_ALGORITHMS: ReadonlySet<Algorithm> = new Set(["SHA1", "SHA256", "SHA512"]);

// --------------------------------------------------------------------- protobuf

function readVarint(data: Uint8Array, start: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let position = start;
  for (;;) {
    if (position >= data.length) throw new MigrationError("truncated");
    const byte = data[position];
    position += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [result, position];
    shift += 7n;
    if (shift > 70n) throw new MigrationError("invalid_payload");
  }
}

type FieldValue = { wire: 0; value: bigint } | { wire: 1 | 2 | 5; value: Uint8Array };

function* iterFields(data: Uint8Array): Generator<[number, FieldValue]> {
  let position = 0;
  while (position < data.length) {
    const [key, afterKey] = readVarint(data, position);
    position = afterKey;
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    if (wireType === 0) {
      const [value, next] = readVarint(data, position);
      position = next;
      yield [fieldNumber, { wire: 0, value }];
    } else if (wireType === 2) {
      const [lengthBig, next] = readVarint(data, position);
      position = next;
      if (BigInt(position) + lengthBig > BigInt(data.length)) throw new MigrationError("truncated");
      const length = Number(lengthBig);
      yield [fieldNumber, { wire: 2, value: data.subarray(position, position + length) }];
      position += length;
    } else if (wireType === 1 || wireType === 5) {
      const size = wireType === 1 ? 8 : 4;
      if (position + size > data.length) throw new MigrationError("truncated");
      yield [fieldNumber, { wire: wireType, value: data.subarray(position, position + size) }];
      position += size;
    } else {
      throw new MigrationError("invalid_payload");
    }
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

/** Tira o "Emissor:" repetido do nome, ou tira o emissor do nome quando ele falta. */
export function splitLabel(rawName: string, rawIssuer: string): [name: string, issuer: string] {
  let name = rawName.trim();
  let issuer = rawIssuer.trim();
  if (issuer && name.toLowerCase().startsWith(issuer.toLowerCase() + ":")) {
    name = name.slice(issuer.length + 1).trim();
  } else if (!issuer && name.includes(":")) {
    const cut = name.indexOf(":");
    issuer = name.slice(0, cut).trim();
    name = name.slice(cut + 1).trim();
  }
  return [name, issuer];
}

function toInt(value: bigint): number {
  // Os enums e os campos de lote cabem em int64; o Python lê como int.
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function parseOtpParameters(data: Uint8Array): OtpAccount {
  let secret = new Uint8Array(0);
  let name = "";
  let issuer = "";
  let algorithmCode = 0;
  let digitsCode = 0;
  let typeCode = 0;
  let counter = 0n;
  for (const [field, item] of iterFields(data)) {
    if (item.wire === 2) {
      if (field === 1) secret = item.value.slice();
      else if (field === 2) name = utf8.decode(item.value);
      else if (field === 3) issuer = utf8.decode(item.value);
    } else if (item.wire === 0) {
      if (field === 4) algorithmCode = toInt(item.value);
      else if (field === 5) digitsCode = toInt(item.value);
      else if (field === 6) typeCode = toInt(item.value);
      else if (field === 7) counter = item.value & 0xffffffffffffffffn;
    }
  }
  if (secret.length === 0) throw new MigrationError("missing_secret");
  const [cleanName, cleanIssuer] = splitLabel(name, issuer);
  return {
    secret,
    name: cleanName,
    issuer: cleanIssuer,
    algorithm: ALGORITHMS[algorithmCode] ?? "SHA1",
    digits: DIGIT_COUNTS[digitsCode] ?? 6,
    type: OTP_TYPES[typeCode] ?? "totp",
    counter,
  };
}

export function parseMigrationPayload(data: Uint8Array): MigrationBatch {
  const accounts: OtpAccount[] = [];
  let batchSize = 1;
  let batchIndex = 0;
  let batchId = 0;
  for (const [field, item] of iterFields(data)) {
    if (field === 1 && item.wire === 2) accounts.push(parseOtpParameters(item.value));
    else if (item.wire === 0) {
      if (field === 3) batchSize = toInt(item.value);
      else if (field === 4) batchIndex = toInt(item.value);
      else if (field === 5) batchId = toInt(item.value);
    }
  }
  return { accounts, batchSize: Math.max(batchSize, 1), batchIndex, batchId };
}

// ------------------------------------------------------------------------- URI

/** Percent-decoding tolerante, como o urllib.parse.unquote: "%" sem dois hex fica como está. */
function lenientPercentDecode(text: string): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; ) {
    if (text[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const codePoint = text.codePointAt(i) ?? 0;
      const char = String.fromCodePoint(codePoint);
      bytes.push(...encoder.encode(char));
      i += char.length;
    }
  }
  return utf8.decode(new Uint8Array(bytes));
}

function decodeBase64Strict(text: string): Uint8Array {
  // Igual ao base64.b64decode(validate=True): só o alfabeto padrão e "=" no fim.
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new MigrationError("invalid_base64");
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new MigrationError("invalid_base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const MIGRATION_PREFIX = /^otpauth-migration:/i;

export function isMigrationUri(text: string): boolean {
  return MIGRATION_PREFIX.test(text.trim());
}

export function decodeMigrationUri(input: string): MigrationBatch {
  const uri = input.trim();
  if (!MIGRATION_PREFIX.test(uri)) throw new MigrationError("not_migration");
  const withoutFragment = uri.split("#", 1)[0];
  const queryStart = withoutFragment.indexOf("?");
  const query = queryStart >= 0 ? withoutFragment.slice(queryStart + 1) : "";
  let value: string | undefined;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    // Como o parse_qs: "+" viraria espaço, e o código original desfaz isso.
    // Aqui o "+" já fica como "+", que dá no mesmo.
    const key = lenientPercentDecode(pair.slice(0, eq).replace(/\+/g, " "));
    const raw = pair.slice(eq + 1);
    if (key === "data" && raw !== "") {
      value = lenientPercentDecode(raw);
      break;
    }
  }
  if (value === undefined) throw new MigrationError("missing_data");
  let encoded = value.replace(/ /g, "+").trim();
  encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
  return parseMigrationPayload(decodeBase64Strict(encoded));
}
