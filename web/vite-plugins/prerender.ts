// Gera uma página por idioma no fim do build, com HTML estático de verdade:
//   dist/index.html     inglês (também o x-default)
//   dist/pt/index.html  português do Brasil
//   dist/es/index.html  espanhol
//
// Como funciona: depois que o Vite escreve o dist/index.html (com os links dos
// arquivos com hash), este plugin renderiza o app React de cada idioma com o
// renderToString (src/prerender.tsx, carregado pelo runnerImport do Vite com o
// mesmo alias e o mesmo transform do app), troca o lang, põe o <head> do
// idioma (título, descrição, canonical, hreflang, Open Graph, JSON-LD) e o
// HTML renderizado dentro do #root. Os textos saem de src/i18n/messages.ts,
// os mesmos que o app usa, então o estático e o app não divergem.
//
// Por que pós-processar o dist em vez de três entradas no Vite: o JavaScript e
// o CSS são os mesmos nas três páginas, então uma entrada só gera um bundle só,
// e as três páginas saem do mesmo index.html.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, type ResolvedConfig, runnerImport } from "vite";
import { LOCALES, type Locale } from "../src/i18n/messages.ts";
import { localeFromPath, LOCALE_DIRS } from "../src/i18n/routes.ts";
import { BODY_MARKER, buildDocument, HEAD_MARKER, headTags } from "../src/i18n/seo.ts";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const entry = fileURLToPath(new URL("../src/prerender.tsx", import.meta.url));

export function prerender(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "otp-out-prerender",
    configResolved(resolved) {
      config = resolved;
    },
    // No servidor de desenvolvimento: só o <head> do idioma do caminho, sem o
    // conteúdo estático (o app monta logo em seguida).
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (config.command !== "serve") return html;
        const path = (ctx.originalUrl ?? ctx.path).split("?")[0];
        const locale = localeFromPath(path, config.base) ?? "en";
        return html.replace(/<html lang="[^"]*">/, `<html lang="${locale}">`).replace(HEAD_MARKER, headTags(locale)).replace(BODY_MARKER, "");
      },
    },
    async writeBundle() {
      if (config.command !== "build") return;
      const outDir = isAbsolute(config.build.outDir) ? config.build.outDir : join(config.root, config.build.outDir);
      const template = readFileSync(join(outDir, "index.html"), "utf8");
      const { module } = await runnerImport<{ renderBody: (locale: Locale) => string }>(entry, {
        root: config.root,
        base: config.base,
        mode: config.mode,
        logLevel: "error",
        resolve: { alias: { "@": srcDir } },
        define: { __VISUAL_DEMO__: "false" },
        plugins: [react()],
      });
      for (const locale of LOCALES) {
        const file = join(outDir, LOCALE_DIRS[locale], "index.html");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buildDocument(template, locale, module.renderBody(locale)));
      }
    },
  };
}
