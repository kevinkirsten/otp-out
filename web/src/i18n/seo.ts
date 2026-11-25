// Monta o <head> e o documento de cada idioma no build (vite-plugins/prerender.ts).
// Funções puras, sem DOM: rodam no Node e são testadas no Vitest. Não vai para o
// bundle do navegador.
import { LOCALES, type Locale, MESSAGES } from "./messages.ts";
import { REPO_URL } from "../lib/links.ts";
import { pageUrl, SITE_URL } from "./routes.ts";

/** og:locale no formato do Open Graph (língua_PAÍS). */
const OG_LOCALES: Record<Locale, string> = { "pt-BR": "pt_BR", en: "en_US", es: "es_ES" };

/** Marcadores no index.html de origem, trocados no build. */
export const HEAD_MARKER = "<!--otp-out:head-->";
export const BODY_MARKER = "<!--otp-out:body-->";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Dados estruturados (schema.org) da página. Vão num <script type="application/ld+json">,
 * que é um bloco de dados: o navegador não executa, então a CSP (script-src 'self')
 * não bloqueia. O teste E2E confere isso nos três navegadores.
 */
export function structuredData(locale: Locale): Record<string, unknown> {
  const m = MESSAGES[locale];
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "otp-out",
    url: pageUrl(locale),
    description: m.metaDescription,
    inLanguage: locale,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and WebAssembly.",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://opensource.org/licenses/MIT",
    image: `${SITE_URL}og.png`,
    author: { "@type": "Person", name: "Kevin Kirsten", url: "https://github.com/kevinkirsten" },
    sameAs: [REPO_URL],
  };
}

/** JSON seguro para ir dentro de <script>: nenhum "<" que feche a tag. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Tags do <head> que mudam por idioma: título, descrição, canonical, hreflang, Open Graph e JSON-LD. */
export function headTags(locale: Locale): string {
  const m = MESSAGES[locale];
  const url = pageUrl(locale);
  const lines = [
    `<title>${escapeHtml(m.metaTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(m.metaDescription)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...LOCALES.map((code) => `<link rel="alternate" hreflang="${code}" href="${pageUrl(code)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl("en")}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="otp-out" />`,
    `<meta property="og:title" content="${escapeHtml(m.metaTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(m.metaDescription)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_URL}og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(m.ogImageAlt)}" />`,
    `<meta property="og:locale" content="${OG_LOCALES[locale]}" />`,
    ...LOCALES.filter((code) => code !== locale).map((code) => `<meta property="og:locale:alternate" content="${OG_LOCALES[code]}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${jsonForScript(structuredData(locale))}</script>`,
  ];
  return lines.join("\n    ");
}

/**
 * Documento final de um idioma a partir do index.html que o Vite gerou:
 * troca o lang, põe as tags do idioma no lugar do marcador do <head> e o
 * conteúdo estático (React renderizado no build) dentro do #root.
 */
export function buildDocument(template: string, locale: Locale, body: string): string {
  if (!template.includes(HEAD_MARKER) || !template.includes(BODY_MARKER)) {
    throw new Error("index.html sem os marcadores do otp-out");
  }
  return template
    .replace(/<html lang="[^"]*">/, `<html lang="${locale}">`)
    .replace(HEAD_MARKER, () => headTags(locale))
    .replace(BODY_MARKER, () => stripStyleAttributes(body));
}

/**
 * Tira os atributos style="..." do HTML estático. A CSP (style-src 'self', sem
 * 'unsafe-inline') bloqueia style em atributo vindo do HTML e o navegador
 * acusaria violação. No app montado o React aplica esses estilos pelo CSSOM,
 * que a CSP permite. O React escapa as aspas dos atributos, então a expressão
 * não corta valor no meio.
 */
export function stripStyleAttributes(html: string): string {
  return html.replace(/ style="[^"]*"/g, "");
}

/** sitemap.xml com as três páginas e os hreflang de cada uma. */
export function sitemapXml(): string {
  const alternates = [
    ...LOCALES.map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${pageUrl(code)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl("en")}"/>`,
  ].join("\n");
  const urls = (["en", "pt-BR", "es"] as Locale[])
    .map((code) => `  <url>\n    <loc>${pageUrl(code)}</loc>\n${alternates}\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
