// Prova de que nada sai do navegador: todas as requisições são da própria
// página, nenhuma acontece depois do carregamento, a CSP bloqueia fetch
// externo, e a página abre e decodifica sem rede depois da primeira visita.
import { readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openApp, pasteLink, qrPng, readRenderedQr, upload, vector } from "./helpers";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

function distFiles(dir = distDir): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(distFiles(full));
    else out.push(relative(distDir, full).split("\\").join("/"));
  }
  return out;
}

/** Caminhos que a página pode pedir: só os arquivos do próprio build. */
function allowedPaths(): Set<string> {
  const paths = new Set(["/otp-out/"]);
  for (const file of distFiles()) paths.add(`/otp-out/${file}`);
  return paths;
}

function recordRequests(context: BrowserContext) {
  const log: string[] = [];
  context.on("request", (request) => log.push(request.url()));
  return log;
}

async function waitServiceWorker(page: Page) {
  // Espera o service worker ativar (o install só termina depois de guardar tudo).
  return page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return !!registration.active;
  });
}

test.describe("rede", () => {
  test("só arquivos da própria origem, e zero requisições depois do carregamento", async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const log = recordRequests(context);
    await openApp(page);
    await waitServiceWorker(page);
    await page.waitForLoadState("networkidle");

    const allowed = allowedPaths();
    for (const url of log) {
      const parsed = new URL(url);
      expect(parsed.origin, `requisição fora da origem: ${url}`).toBe(origin);
      expect(allowed.has(parsed.pathname), `arquivo que não é do build: ${url}`).toBe(true);
    }

    const before = log.length;
    // Ações: imagem, link colado, revelar, QR, idioma, limpar.
    await upload(page, [{ name: "print.png", buffer: qrPng(vector("one_account").input) }]);
    await expect(page.getByTestId("account")).toHaveCount(1);
    expect(log.slice(before), "requisições depois de enviar a imagem").toEqual([]);

    await pasteLink(page, vector("ten_accounts_dense").input);
    await expect(page.getByTestId("account")).toHaveCount(11);
    expect(log.slice(before), "requisições depois de colar o link").toEqual([]);

    await page.getByTestId("toggle-secret").first().click();
    await page.getByTestId("show-qr").first().click();
    await expect(page.getByTestId("qr-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("empty")).toBeVisible();
    expect(log.slice(before), "requisições depois das ações").toEqual([]);
  });

  test.describe("CSP", () => {
    test.use({ allowCspViolations: true });

    test("bloqueia fetch e imagem de outro domínio antes de sair do navegador", async ({ page }) => {
      // Servidor sentinela em outra origem (porta 3168, da faixa do otp-out):
      // se qualquer requisição sair do navegador, ele conta.
      let hits = 0;
      const sentinel = createServer((_, res) => {
        hits += 1;
        res.end("ok");
      });
      await new Promise<void>((resolve) => sentinel.listen(3168, "127.0.0.1", resolve));
      try {
        await openApp(page);
        const result = await page.evaluate(async () => {
          const violations: string[] = [];
          document.addEventListener("securitypolicyviolation", (e) => violations.push(e.effectiveDirective));
          let fetchResult = "ok";
          try {
            await fetch("http://127.0.0.1:3168/vazou?x=1");
          } catch {
            fetchResult = "bloqueado";
          }
          let imgResult = "ok";
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => {
              imgResult = "bloqueado";
              resolve();
            };
            img.src = "http://127.0.0.1:3168/pixel.gif";
          });
          let beaconResult: string;
          try {
            beaconResult = navigator.sendBeacon("http://127.0.0.1:3168/beacon", "x") ? "aceito" : "bloqueado";
          } catch {
            beaconResult = "bloqueado";
          }
          await new Promise((r) => setTimeout(r, 300));
          return { fetchResult, imgResult, beaconResult, violations };
        });
        expect(result.fetchResult).toBe("bloqueado");
        expect(result.imgResult).toBe("bloqueado");
        expect(result.violations).toEqual(expect.arrayContaining(["connect-src", "img-src"]));
        // O sendBeacon pode até ser "aceito" pela API; o que importa é não chegar ao servidor.
        expect(["aceito", "bloqueado"]).toContain(result.beaconResult);
        expect(hits, "requisições que chegaram ao servidor sentinela").toBe(0);
      } finally {
        await new Promise((resolve) => sentinel.close(resolve));
      }
    });

    test("a meta CSP é a esperada", async ({ page }) => {
      await page.goto("./");
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("'unsafe-eval'");
    });
  });
});

test.describe("offline", () => {
  test("depois da primeira visita, abre e decodifica sem rede", async ({ page, context, browserName }) => {
    await openApp(page);
    expect(await waitServiceWorker(page)).toBe(true);
    // Recarrega uma vez para a página passar a ser controlada pelo service worker.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-reader", "ready", { timeout: 20_000 });

    const v = vector("one_account");
    await upload(page, [{ name: "print.png", buffer: qrPng(v.input) }]);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");
    await page.getByTestId("show-qr").click();
    expect(await readRenderedQr(page, browserName)).toEqual([v.accounts![0].uri]);
    await context.setOffline(false);
  });
});
