// Gera o sw.js no fim do build com a lista exata dos arquivos que foram para
// a pasta de saída. O service worker só guarda esses arquivos e nunca busca
// nada de outro domínio.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/** Fora do cache offline: o próprio sw.js e o que só serve para quem compartilha o link. */
const SKIP = new Set(["sw.js", "404.html", "og.png", "robots.txt"]);

function listFiles(dir: string, base = dir): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

export function serviceWorker(options: { enabled: boolean }): Plugin {
  let config: ResolvedConfig;
  return {
    name: "otp-out-service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle() {
      if (!options.enabled) return;
      const outDir = config.build.outDir.startsWith("/") ? config.build.outDir : join(config.root, config.build.outDir);
      const files = listFiles(outDir)
        .filter((file) => !SKIP.has(file) && !file.startsWith("."))
        .sort();
      const hash = createHash("sha256");
      for (const file of files) {
        hash.update(file);
        hash.update(readFileSync(join(outDir, file)));
      }
      const precache = ["./", ...files.filter((file) => file !== "index.html")];
      const template = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");
      const source = template
        .replace("__VERSION__", JSON.stringify(hash.digest("hex").slice(0, 16)))
        .replace("__PRECACHE__", JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}
