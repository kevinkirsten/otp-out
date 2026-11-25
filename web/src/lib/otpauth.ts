import { type OtpAccount, SUPPORTED_ALGORITHMS } from "./migration";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 da RFC 4648, sem o "=" de preenchimento. */
export function base32NoPadding(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

/**
 * Igual ao urllib.parse.quote do Python: só A-Za-z0-9 e "_.-~" ficam literais,
 * mais os caracteres de `safe`. O encodeURIComponent deixa "!*'()" literais, o
 * Python não, então eles são escapados aqui.
 */
export function pyQuote(text: string, safe = ""): string {
  let encoded = encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
  for (const char of safe) {
    const escaped = encodeURIComponent(char).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
    if (escaped !== char) encoded = encoded.split(escaped).join(char);
  }
  return encoded;
}

export function isSupported(account: OtpAccount): boolean {
  return SUPPORTED_ALGORITHMS.has(account.algorithm);
}

/** URI otpauth:// da conta, ou null quando o algoritmo não tem suporte (MD5). */
export function buildOtpauthUri(account: OtpAccount): string | null {
  if (!isSupported(account)) return null;
  const label = account.issuer
    ? pyQuote(account.issuer) + ":" + pyQuote(account.name, "@")
    : pyQuote(account.name, "@");
  const parameters = ["secret=" + base32NoPadding(account.secret)];
  if (account.issuer) parameters.push("issuer=" + pyQuote(account.issuer));
  parameters.push("algorithm=" + account.algorithm);
  parameters.push("digits=" + account.digits);
  if (account.type === "hotp") parameters.push("counter=" + account.counter.toString());
  else parameters.push("period=30");
  return `otpauth://${account.type}/${label}?${parameters.join("&")}`;
}
