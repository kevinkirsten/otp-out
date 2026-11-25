// Uma URL por idioma, HTML estático legível sem JavaScript, troca de idioma sem
// recarregar, offline em /pt/, arquivos para buscadores e IAs, e o JSON-LD sem
// violação de CSP. Tudo no build de produção servido em /otp-out/.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openApp, pasteLink, qrPng, upload, vector } from "./helpers";
import { LOCALES, type Locale, MESSAGES } from "../src/i18n/messages";

const SITE = "https://kevinkirsten.github.io/otp-out/";
const PAGES: { locale: Locale; path: string; url: string; browserLocale: string }[] = [
  // O idioma do navegador é outro de propósito em /pt/ e /es/: quem manda é o caminho.
  { locale: "en", path: "./", url: SITE, browserLocale: "en-US" },
  { locale: "pt-BR", path: "pt/", url: `${SITE}pt/`, browserLocale: "en-US" },
  { locale: "es", path: "es/", url: `${SITE}es/`, browserLocale: "pt-BR" },
];
const HREFLANG: Record<string, string> = { "pt-BR": `${SITE}pt/`, en: SITE, es: `${SITE}es/`, "x-default": SITE };
const COMMANDS = ["brew install kevinkirsten/tap/otp-out", "winget install KevinKirsten.otp-out", "npx otp-out", "pnpm dlx otp-out"];

async function expectHead(page: Page, locale: Locale, url: string) {
  const m = MESSAGES[locale];
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page).toHaveTitle(m.metaTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", m.metaDescription);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
  const alternates = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => Object.fromEntries(links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")])));
  expect(alternates).toEqual(HREFLANG);
}

for (const { locale, path, url, browserLocale } of PAGES) {
  test.describe(`página ${locale}`, () => {
    test.use({ locale: browserLocale });

    test("abre no idioma certo, com head e JSON-LD certos e sem violação de CSP", async ({ page }) => {
      await openApp(page, path);
      await expectHead(page, locale, url);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES[locale].heroTitle);

      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(blocks).toHaveLength(1);
      const data = JSON.parse(blocks[0]);
      expect(data).toMatchObject({ "@type": "WebApplication", inLanguage: locale, url, isAccessibleForFree: true });
      // O fixture também falha o teste se aparecer violação ou erro no console;
      // aqui a conferência é explícita, depois do carregamento completo.
      const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
      expect(violations).toEqual([]);
    });
  });

  test.describe(`página ${locale} sem JavaScript`, () => {
    test.use({ javaScriptEnabled: false, locale: browserLocale });

    test("o HTML traz head, título, passo a passo, CLI e perguntas frequentes", async ({ page }) => {
      const m = MESSAGES[locale];
      await page.goto(path);
      await expectHead(page, locale, url);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.heroTitle);
      await expect(page.getByText(m.heroLead)).toBeVisible();
      // O aviso fica num <noscript>. Com o JavaScript desligado pelo Playwright o
      // parser ainda trata o <noscript> como texto, então a conferência é do conteúdo.
      expect(await page.locator("noscript").first().innerHTML()).toContain(m.noscript);

      const privacy = page.locator("#privacidade");
      await expect(privacy.getByRole("heading", { level: 2 })).toHaveText(m.privacyTitle);
      await expect(privacy).toContainText(m.verifyNetwork);
      await expect(privacy).toContainText(m.verifyOffline);

      const steps = page.locator('[aria-labelledby="como-exportar"] ol > li');
      await expect(steps).toHaveText(m.howSteps);
      await expect(page.getByText(m.howAndroid)).toBeVisible();

      const cli = page.locator('[aria-labelledby="cli"]');
      await expect(cli.getByRole("heading", { level: 2 })).toHaveText(m.cliTitle);
      await expect(cli.locator("code")).toHaveText(COMMANDS);
      await expect(cli.getByRole("link", { name: m.cliLink })).toHaveAttribute("href", "https://github.com/kevinkirsten/otp-out");

      const faq = page.getByTestId("faq");
      await expect(faq.getByRole("heading", { level: 2 })).toHaveText(m.faqTitle);
      await expect(faq.getByRole("heading", { level: 3 })).toHaveText(m.faq.map((item) => item.q));
      for (const item of m.faq) await expect(faq).toContainText(item.a.replace(/`/g, ""));
    });
  });
}

test.describe("troca de idioma", () => {
  test.use({ locale: "en-US" });

  test("não recarrega a página: a conta lida continua e a URL vai para o caminho do idioma", async ({ page, baseURL }) => {
    await openApp(page, "pt/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await pasteLink(page, vector("one_account").input);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");
    // Marca a página: um recarregamento apagaria a marca.
    await page.evaluate(() => ((window as unknown as { __mesmaPagina: boolean }).__mesmaPagina = true));
    let loads = 0;
    page.on("load", () => (loads += 1));

    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page).toHaveURL(new URL("/otp-out/", baseURL).href);
    await expectHead(page, "en", SITE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES.en.heroTitle);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");

    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "Español" }).click();
    await expect(page).toHaveURL(new URL("/otp-out/es/", baseURL).href);
    await expectHead(page, "es", `${SITE}es/`);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");

    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "Português" }).click();
    await expect(page).toHaveURL(new URL("/otp-out/pt/", baseURL).href);
    await expect(page.getByTestId("account")).toHaveCount(1);

    expect(await page.evaluate(() => (window as unknown as { __mesmaPagina?: boolean }).__mesmaPagina)).toBe(true);
    expect(loads).toBe(0);
    expect(page.url()).not.toContain("?");
  });

  test.describe("na raiz com navegador em português", () => {
    test.use({ locale: "pt-BR" });
    test("mostra português e a URL só muda quando a pessoa escolhe", async ({ page, baseURL }) => {
      await openApp(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      await expect(page).toHaveURL(new URL("/otp-out/", baseURL).href);
      await page.getByTestId("language-trigger").click();
      await page.getByRole("menuitemradio", { name: "Español" }).click();
      await expect(page).toHaveURL(new URL("/otp-out/es/", baseURL).href);
    });
  });
});

test.describe("offline", () => {
  test.use({ locale: "en-US" });

  test("/otp-out/pt/ abre e decodifica sem rede depois da primeira visita", async ({ page, context }) => {
    await openApp(page, "pt/");
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return !!registration.active;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // Espera esta página terminar de carregar o leitor antes de cortar a rede:
    // senão o download em andamento falha e aparece como erro no console (Firefox).
    await expect(page.locator("html")).toHaveAttribute("data-reader", "ready", { timeout: 20_000 });

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES["pt-BR"].heroTitle);
    await expect(page.locator("html")).toHaveAttribute("data-reader", "ready", { timeout: 20_000 });
    await upload(page, [{ name: "print.png", buffer: qrPng(vector("one_account").input) }]);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");

    // As outras páginas de idioma também estão no cache.
    await page.goto("es/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES.es.heroTitle);
    await context.setOffline(false);
  });
});

test.describe("arquivos para buscadores e IAs", () => {
  test("sitemap.xml, robots.txt e llms.txt são servidos", async ({ request }) => {
    const sitemap = await request.get("sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    for (const { url } of PAGES) expect(xml).toContain(`<loc>${url}</loc>`);
    expect(xml.match(/<loc>/g)).toHaveLength(3);
    expect(xml.match(/<xhtml:link rel="alternate"/g)).toHaveLength(12);

    const robots = await request.get("robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${SITE}sitemap.xml`);

    const llms = await request.get("llms.txt");
    expect(llms.status()).toBe(200);
    const text = await llms.text();
    expect(text.startsWith("# otp-out")).toBe(true);
    for (const { url } of PAGES) expect(text).toContain(url);
  });

  test("os três index.html estáticos existem com o idioma certo", async ({ request }) => {
    for (const { locale, path } of PAGES) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<html lang="${locale}">`);
      expect(html).toContain(`<h1 class=`);
      expect(html).toContain(MESSAGES[locale].faq[0].q);
      expect(html).not.toContain("otp-out:head");
      expect(html).not.toMatch(/ style="/);
    }
  });
});

test("todos os idiomas foram cobertos", () => {
  expect(PAGES.map((p) => p.locale).sort()).toEqual([...LOCALES].sort());
});
