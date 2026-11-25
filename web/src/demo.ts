// Só no build "visual" (pnpm build:visual), para a conferência de telas com
// contas na lista. Usa os casos falsos do testdata/vectors.json. Nunca entra
// no build de produção: o import fica atrás de __VISUAL_DEMO__.
import vectors from "../../testdata/vectors.json";
import type { IntakeResult } from "./lib/intake";
import { decodeMigrationUri, type MigrationBatch } from "./lib/migration";

const SHOW = ["one_account", "accents_spaces_and_symbols", "hotp_with_counter", "sha256_eight_digits", "md5_unsupported", "batch_1_of_3"];

export function install() {
  const batches: MigrationBatch[] = [];
  for (const name of SHOW) {
    const found = vectors.cases.find((c) => c.name === name);
    if (found) batches.push(decodeMigrationUri(found.input));
  }
  // Conta com emissor e e-mail compridos, para conferir que o layout não quebra.
  batches.push({
    batchSize: 1,
    batchIndex: 0,
    batchId: 1,
    accounts: [
      {
        secret: new TextEncoder().encode("Hello!Þ­"), // gitleaks:allow (segredo falso)
        issuer: "Prefeitura Municipal de São José dos Campos, Secretaria de Finanças",
        name: "maria.aparecida.fernandes.de.oliveira.santos@secretaria-financas.sjc.sp.gov.br",
        algorithm: "SHA1",
        digits: 6,
        type: "totp",
        counter: 0n,
      },
    ],
  });
  const result: IntakeResult = { batches, errors: [{ source: "IMG_2034.HEIC", code: "heic" }] };
  window.dispatchEvent(new CustomEvent("otp-out:demo", { detail: result }));
}
