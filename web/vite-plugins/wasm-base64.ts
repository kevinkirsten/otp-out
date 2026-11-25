// import x from "arquivo.wasm?base64" devolve o binário como texto base64,
// embutido no JavaScript. Assim o .wasm não precisa de fetch (a CSP da página
// tem connect-src 'none') e funciona offline junto com o resto do bundle.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const SUFFIX = "?base64";

export function wasmBase64(): Plugin {
  return {
    name: "otp-out-wasm-base64",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(".wasm" + SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return resolved ? "\0wasm-base64:" + resolved.id : null;
    },
    load(id) {
      if (!id.startsWith("\0wasm-base64:")) return null;
      const file = id.slice("\0wasm-base64:".length);
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file).toString("base64"))};`;
    },
  };
}
