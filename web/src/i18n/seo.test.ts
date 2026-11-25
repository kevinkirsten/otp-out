// Gerador do HTML de cada idioma (head, documento, sitemap) e regras dos textos.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES, type Locale, MESSAGES } from "./messages";
import { localeFromPath, pageUrl, pathForLocale } from "./routes";
import { BODY_MARKER, buildDocument, HEAD_MARKER, headTags, sitemapXml, stripStyleAttributes, structuredData } from "./seo";

const BASE = "/otp-out/";
const URLS: Record<Locale, string> = {
  en: "https://kevinkirsten.github.io/otp-out/",
  "pt-BR": "https://kevinkirsten.github.io/otp-out/pt/",
  es: "https://kevinkirsten.github.io/otp-out/es/",
};

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

describe("endereço de cada idioma", () => {
  it("caminho e URL pública", () => {
    expect(pathForLocale("en", BASE)).toBe("/otp-out/");
    expect(pathForLocale("pt-BR", BASE)).toBe("/otp-out/pt/");
    expect(pathForLocale("es", BASE)).toBe("/otp-out/es/");
    for (const locale of LOCALES) expect(pageUrl(locale)).toBe(URLS[locale]);
  });

  it("o caminho fixa o idioma; a raiz deixa para o navegador", () => {
    expect(localeFromPath("/otp-out/pt/", BASE)).toBe("pt-BR");
    expect(localeFromPath("/otp-out/pt", BASE)).toBe("pt-BR");
    expect(localeFromPath("/otp-out/pt/index.html", BASE)).toBe("pt-BR");
    expect(localeFromPath("/otp-out/es/", BASE)).toBe("es");
    expect(localeFromPath("/otp-out/", BASE)).toBeNull();
    expect(localeFromPath("/otp-out/index.html", BASE)).toBeNull();
    expect(localeFromPath("/otp-out/ptx/", BASE)).toBeNull();
    expect(localeFromPath("/outro/pt/", BASE)).toBeNull();
  });
});

describe("head de cada idioma", () => {
  for (const locale of LOCALES) {
    it(locale, () => {
      const m = MESSAGES[locale];
      const head = headTags(locale);
      expect(head).toContain(`<title>${m.metaTitle}</title>`);
      expect(head).toContain(`<meta name="description" content="${m.metaDescription}" />`);
      expect(head).toContain(`<link rel="canonical" href="${URLS[locale]}" />`);
      expect(head).toContain(`<meta property="og:url" content="${URLS[locale]}" />`);
      expect(head).toContain(`<link rel="alternate" hreflang="pt-BR" href="${URLS["pt-BR"]}" />`);
      expect(head).toContain(`<link rel="alternate" hreflang="en" href="${URLS.en}" />`);
      expect(head).toContain(`<link rel="alternate" hreflang="es" href="${URLS.es}" />`);
      expect(head).toContain(`<link rel="alternate" hreflang="x-default" href="${URLS.en}" />`);
      expect(head.match(/og:locale" /g)).toHaveLength(1);
      expect(head.match(/og:locale:alternate/g)).toHaveLength(2);

      const json = head.match(/<script type="application\/ld\+json">(.*)<\/script>/)?.[1];
      expect(json).toBeTruthy();
      expect(JSON.parse(json!)).toEqual(structuredData(locale));
      expect(structuredData(locale)).toMatchObject({
        "@type": "WebApplication",
        inLanguage: locale,
        url: URLS[locale],
        isAccessibleForFree: true,
        license: "https://opensource.org/licenses/MIT",
        author: { name: "Kevin Kirsten" },
        sameAs: ["https://github.com/kevinkirsten/otp-out"],
      });
    });
  }

  it("escapa aspas e sinal de menor", () => {
    expect(headTags("en")).not.toMatch(/content="[^"]*<[^"]*"/);
  });
});

describe("documento final", () => {
  const template = `<!doctype html>\n<html lang="en">\n<head>${HEAD_MARKER}</head>\n<body><div id="root">${BODY_MARKER}</div></body></html>`;

  it("troca lang, head e conteúdo, sem deixar marcador nem style em atributo", () => {
    const html = buildDocument(template, "pt-BR", `<h1>Oi</h1><div role="region" style="pointer-events:none"></div>`);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain(`<title>${MESSAGES["pt-BR"].metaTitle}</title>`);
    expect(html).toContain('<div id="root"><h1>Oi</h1><div role="region"></div></div>');
    expect(html).not.toContain("otp-out:head");
    expect(html).not.toContain("otp-out:body");
    expect(html).not.toContain("style=");
  });

  it("conteúdo com $ não vira padrão de substituição", () => {
    expect(buildDocument(template, "en", "<p>$& $1</p>")).toContain("<p>$& $1</p>");
  });

  it("recusa template sem marcadores", () => {
    expect(() => buildDocument("<html lang=\"en\"></html>", "en", "")).toThrow();
  });

  it("style de verdade some, texto com a palavra style fica", () => {
    expect(stripStyleAttributes('<p class="a" style="color:red">style="x"</p>')).toBe('<p class="a">style="x"</p>');
  });
});

describe("arquivos para buscadores e IAs", () => {
  it("public/sitemap.xml é o que o gerador produz e lista as três páginas", () => {
    const file = read("../../public/sitemap.xml");
    expect(file).toBe(sitemapXml());
    for (const locale of LOCALES) expect(file).toContain(`<loc>${URLS[locale]}</loc>`);
    expect(file.match(/<url>/g)).toHaveLength(3);
  });

  it("robots.txt aponta para o sitemap", () => {
    expect(read("../../public/robots.txt")).toContain("Sitemap: https://kevinkirsten.github.io/otp-out/sitemap.xml");
  });

  it("llms.txt tem título, resumo e os links principais", () => {
    const file = read("../../public/llms.txt");
    expect(file.startsWith("# otp-out\n\n> ")).toBe(true);
    for (const url of [...Object.values(URLS), "https://github.com/kevinkirsten/otp-out", "README.md", "README.pt-BR.md"]) {
      expect(file).toContain(url);
    }
    for (const command of ["brew install kevinkirsten/tap/otp-out", "winget install KevinKirsten.otp-out", "npx otp-out", "pnpm dlx otp-out"]) {
      expect(file).toContain(command);
    }
  });
});

describe("textos", () => {
  it("nenhum travessão nos três idiomas nem no llms.txt", () => {
    for (const locale of LOCALES) {
      for (const text of allStrings(MESSAGES[locale])) expect(text, `${locale}: ${text}`).not.toMatch(/[–—]/);
    }
    expect(read("../../public/llms.txt")).not.toMatch(/[–—]/);
  });

  it("perguntas frequentes: as mesmas seis nos três idiomas, com crases fechadas", () => {
    for (const locale of LOCALES) {
      const faq = MESSAGES[locale].faq;
      expect(faq).toHaveLength(6);
      for (const item of faq) expect(item.a.split("`").length % 2, `${locale}: ${item.q}`).toBe(1);
    }
  });
});
