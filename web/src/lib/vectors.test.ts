// Contrato compartilhado com o CLI em Go: ../testdata/vectors.json.
// Todos os segredos de lá são falsos.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addBatch, collectFromUris, emptyCollection, findMigrationUris, missingParts } from "./collect";
import { decodeMigrationUri, MigrationError, splitLabel } from "./migration";
import { base32NoPadding, buildOtpauthUri, pyQuote } from "./otpauth";

interface VectorAccount {
  issuer: string;
  name: string;
  type: string;
  algorithm: string;
  digits: number;
  counter: number;
  secret: string;
  uri: string | null;
}
interface VectorCase {
  name: string;
  input: string;
  error?: boolean;
  batch?: { size: number; index: number; id: number };
  accounts?: VectorAccount[];
}
interface Vectors {
  rfc4648_base32: { ascii: string; base32: string }[];
  cases: VectorCase[];
}

const vectorsPath = fileURLToPath(new URL("../../../testdata/vectors.json", import.meta.url));
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as Vectors;

describe("vectors.json", () => {
  it("tem os 21 casos e os vetores da RFC 4648", () => {
    expect(vectors.cases).toHaveLength(21);
    expect(vectors.rfc4648_base32.length).toBeGreaterThanOrEqual(7);
  });

  for (const testCase of vectors.cases) {
    if (testCase.error) {
      it(`${testCase.name}: dá erro sem vazar o conteúdo`, () => {
        let caught: unknown;
        try {
          decodeMigrationUri(testCase.input);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(MigrationError);
        // A mensagem é só um código fixo, nunca um pedaço da entrada.
        expect((caught as MigrationError).message).toMatch(/^[a-z0-9_]+$/);
        const payload = testCase.input.split("data=")[1];
        if (payload) expect((caught as MigrationError).message).not.toContain(payload);
      });
      continue;
    }

    it(`${testCase.name}: decodifica igual ao contrato`, () => {
      const batch = decodeMigrationUri(testCase.input);
      expect({ size: batch.batchSize, index: batch.batchIndex, id: batch.batchId }).toEqual(testCase.batch);
      const expected = testCase.accounts ?? [];
      expect(batch.accounts).toHaveLength(expected.length);
      batch.accounts.forEach((account, i) => {
        const want = expected[i];
        expect(account.issuer).toBe(want.issuer);
        expect(account.name).toBe(want.name);
        expect(account.type).toBe(want.type);
        expect(account.algorithm).toBe(want.algorithm);
        expect(account.digits).toBe(want.digits);
        expect(account.counter).toBe(BigInt(want.counter));
        expect(base32NoPadding(account.secret)).toBe(want.secret);
        expect(buildOtpauthUri(account)).toBe(want.uri);
      });
    });
  }
});

describe("base32 (RFC 4648, sem preenchimento)", () => {
  for (const { ascii, base32 } of vectors.rfc4648_base32) {
    it(`"${ascii}" → "${base32}"`, () => {
      expect(base32NoPadding(new TextEncoder().encode(ascii))).toBe(base32);
    });
  }
});

describe("percent-encoding igual ao urllib.parse.quote", () => {
  it("escapa o que o encodeURIComponent deixaria literal", () => {
    expect(pyQuote("a!b*c'd(e)f")).toBe("a%21b%2Ac%27d%28e%29f");
  });
  it("deixa literais só A-Za-z0-9 e _.-~", () => {
    expect(pyQuote("Az09_.-~")).toBe("Az09_.-~");
    expect(pyQuote(" &/:?#[]@+=,;$")).toBe("%20%26%2F%3A%3F%23%5B%5D%40%2B%3D%2C%3B%24");
  });
  it("com safe='@' deixa o @ literal e escapa o resto", () => {
    expect(pyQuote("ana+1@ex.com", "@")).toBe("ana%2B1@ex.com");
  });
  it("codifica acentos e emoji em UTF-8", () => {
    expect(pyQuote("São ✓ 🔐")).toBe("S%C3%A3o%20%E2%9C%93%20%F0%9F%94%90");
  });
});

describe("splitLabel", () => {
  it("tira o emissor repetido do nome, sem diferenciar maiúsculas", () => {
    expect(splitLabel("exemplo:ana", "Exemplo")).toEqual(["ana", "Exemplo"]);
  });
  it("tira o emissor do nome quando ele falta", () => {
    expect(splitLabel(" Firma : ana ", "")).toEqual(["ana", "Firma"]);
  });
  it("mantém o nome quando o prefixo é de outro emissor", () => {
    expect(splitLabel("Outra:ana", "Exemplo")).toEqual(["Outra:ana", "Exemplo"]);
  });
});

describe("lotes (exportação em várias partes)", () => {
  const byName = new Map(vectors.cases.map((c) => [c.name, c.input]));
  const part1 = byName.get("batch_1_of_3")!;
  const part2 = byName.get("batch_2_of_3")!;

  it("avisa quais partes faltam", () => {
    const collection = collectFromUris([part1, part2]);
    expect(collection.accounts.map((a) => a.issuer)).toEqual(["d", "b"]);
    expect(missingParts(collection)).toEqual([{ batchId: 77, size: 3, read: 2, missing: [3] }]);
  });

  it("só com uma parte, faltam as outras duas", () => {
    expect(missingParts(collectFromUris([part2]))).toEqual([{ batchId: 77, size: 3, read: 1, missing: [1, 3] }]);
  });

  it("não repete a mesma conta lida duas vezes", () => {
    const collection = emptyCollection();
    expect(addBatch(collection, decodeMigrationUri(part1))).toBe(1);
    expect(addBatch(collection, decodeMigrationUri(part1))).toBe(0);
    expect(collection.accounts).toHaveLength(1);
  });

  it("exportação de um QR só não gera aviso", () => {
    expect(missingParts(collectFromUris([byName.get("one_account")!]))).toEqual([]);
  });

  it("acha várias URIs num texto colado", () => {
    expect(findMigrationUris(`  ${part1}\n\n${part2} `)).toEqual([part1, part2]);
    expect(findMigrationUris("https://exemplo.com")).toEqual([]);
  });
});
