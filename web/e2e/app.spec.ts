// Fluxos principais da página, no build de produção servido em /otp-out/.
// Segredos só falsos (vectors.json e JBSWY3DPEHPK3PXP); QRs gerados aqui.
import { expect, test } from "./fixtures";
import {
  convertInBrowser,
  imageWithoutQr,
  migrationUri,
  openApp,
  pasteLink,
  qrPng,
  readRenderedQr,
  screenshotWithSmallQr,
  upload,
  vector,
} from "./helpers";

const SECRET_A = [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]; // JBSWY3DPEHPK3PXP gitleaks:allow
const SECRET_B = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30]; // GEZDGNBVGY3TQOJQ gitleaks:allow

test.describe("estado vazio", () => {
  test("mostra a ação principal, o aviso de privacidade e a lista vazia @mobile", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Leve suas contas do Google Authenticator para outro app");
    await expect(page.getByTestId("choose-files")).toBeVisible();
    await expect(page.getByTestId("choose-files")).toBeInViewport();
    await expect(page.getByTestId("privacy-bar")).toHaveText("Tudo acontece neste navegador. Nada é enviado.");
    await expect(page.getByTestId("empty")).toBeVisible();
    await expect(page.getByTestId("results-title")).toHaveText("0 contas");
    await expect(page).toHaveTitle(/otp-out/);
  });

  test("a página 404 existe e aponta para a principal", async ({ page }) => {
    await page.goto("404.html");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
    await expect(page.getByRole("link", { name: "Abrir o otp-out" })).toHaveAttribute("href", "/otp-out/");
  });
});

test.describe("leitura de imagem", () => {
  test("1 conta: URI exata, segredo escondido por padrão e revelado ao clicar", async ({ page, browserName }) => {
    const v = vector("one_account");
    const want = v.accounts![0];
    await openApp(page);
    await upload(page, [{ name: "print.png", buffer: qrPng(v.input) }]);

    const card = page.getByTestId("account");
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("account-issuer")).toHaveText(want.issuer);
    await expect(card.getByTestId("account-name")).toHaveText(want.name);
    await expect(card.getByTestId("account-type")).toHaveText("TOTP");

    // Escondido: o segredo não está em lugar nenhum do HTML nem do título.
    await expect(card.getByTestId("account-secret-hidden")).toBeVisible();
    await expect(card.getByTestId("account-secret")).toHaveCount(0);
    expect(await page.content()).not.toContain(want.secret);
    expect(await page.title()).not.toContain(want.secret);
    expect(page.url()).not.toContain(want.secret);

    await card.getByTestId("toggle-secret").click();
    await expect(card.getByTestId("toggle-secret")).toHaveAttribute("aria-pressed", "true");
    expect((await card.getByTestId("account-secret").innerText()).replace(/\s/g, "")).toBe(want.secret);
    await card.getByTestId("toggle-secret").click();
    await expect(card.getByTestId("account-secret")).toHaveCount(0);

    // O QR da conta é gerado na página e relido aqui: tem que conter a URI exata.
    await card.getByTestId("show-qr").click();
    const dialog = page.getByTestId("qr-dialog");
    await expect(dialog).toBeVisible();
    expect(await readRenderedQr(page, browserName)).toEqual([want.uri]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("10 contas num QR denso", async ({ page }) => {
    const v = vector("ten_accounts_dense");
    await openApp(page);
    await upload(page, [{ name: "denso.png", buffer: qrPng(v.input, 4) }]);
    await expect(page.getByTestId("account")).toHaveCount(10);
    await expect(page.getByTestId("results-title")).toHaveText("10 contas");
    const cards = page.getByTestId("account");
    for (let i = 0; i < 10; i += 1) {
      const want = v.accounts![i];
      await expect(cards.nth(i).getByTestId("account-issuer")).toHaveText(want.issuer);
      await expect(cards.nth(i).getByTestId("account-name")).toHaveText(want.name);
      await cards.nth(i).getByTestId("toggle-secret").click();
      expect((await cards.nth(i).getByTestId("account-secret").innerText()).replace(/\s/g, "")).toBe(want.secret);
    }
  });

  test("QR pequeno dentro de um print grande", async ({ page }) => {
    const v = vector("two_accounts_issuer_repeated_in_name");
    await openApp(page);
    await upload(page, [{ name: "print-grande.png", buffer: screenshotWithSmallQr(v.input) }]);
    await expect(page.getByTestId("account")).toHaveCount(2);
    await expect(page.getByTestId("account-issuer")).toHaveText(["Exemplo", "Outra Firma"]);
    await expect(page.getByTestId("account-name")).toHaveText(["ana@exemplo.com", "joao@exemplo.com"]);
  });

  test("JPG lido igual ao PNG", async ({ page }) => {
    const v = vector("sha256_eight_digits");
    await openApp(page);
    const jpg = await convertInBrowser(page, qrPng(v.input), "image/jpeg");
    await upload(page, [{ name: "print.jpg", buffer: jpg, mimeType: "image/jpeg" }]);
    await expect(page.getByTestId("account")).toHaveCount(1);
    await expect(page.getByTestId("account-type")).toHaveText("TOTP · SHA256 · 8 dígitos");
  });

  test("WEBP lido igual ao PNG", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "só o Chromium gera WEBP pelo canvas");
    const v = vector("hotp_with_counter");
    await openApp(page);
    const webp = await convertInBrowser(page, qrPng(v.input), "image/webp");
    await upload(page, [{ name: "print.webp", buffer: webp, mimeType: "image/webp" }]);
    await expect(page.getByTestId("account-type")).toHaveText("HOTP · contador 300");
  });

  test("lote: duas partes de três avisam a que falta; depois de limpar, uma parte só", async ({ page }) => {
    await openApp(page);
    await upload(page, [
      { name: "parte1.png", buffer: qrPng(vector("batch_1_of_3").input) },
      { name: "parte2.png", buffer: qrPng(vector("batch_2_of_3").input) },
    ]);
    await expect(page.getByTestId("account")).toHaveCount(2);
    await expect(page.getByTestId("missing-parts")).toHaveCount(1);
    await expect(page.getByTestId("missing-parts")).toContainText("em 3 QRs e só 2 foram lidos. Envie também a parte 3.");

    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("account")).toHaveCount(0);
    await expect(page.getByTestId("missing-parts")).toHaveCount(0);

    await upload(page, [{ name: "parte2.png", buffer: qrPng(vector("batch_2_of_3").input) }]);
    await expect(page.getByTestId("account")).toHaveCount(1);
    await expect(page.getByTestId("missing-parts")).toContainText("só 1 foi lido. Envie também as partes 1 e 3.");
  });

  test("lote de duas partes sintético: completo não avisa, e a parte que faltava some com o aviso", async ({ page }) => {
    const part1 = migrationUri([{ secret: SECRET_A, name: "ana@exemplo.com", issuer: "Banco Teste" }], { size: 2, index: 0, id: 9001 });
    const part2 = migrationUri([{ secret: SECRET_B, name: "joao@exemplo.com", issuer: "Loja Teste" }], { size: 2, index: 1, id: 9001 });
    await openApp(page);
    await upload(page, [{ name: "a.png", buffer: qrPng(part1) }]);
    await expect(page.getByTestId("missing-parts")).toContainText("parte 2");
    await upload(page, [{ name: "b.png", buffer: qrPng(part2) }]);
    await expect(page.getByTestId("account")).toHaveCount(2);
    await expect(page.getByTestId("missing-parts")).toHaveCount(0);
    // Mandar a mesma parte de novo não duplica a conta.
    await upload(page, [{ name: "b.png", buffer: qrPng(part2) }]);
    await expect(page.getByTestId("account")).toHaveCount(2);
  });

  test("erros: imagem sem QR, QR que não é exportação, QR de conta única, arquivo que não é imagem", async ({ page }) => {
    await openApp(page);
    await upload(page, [
      { name: "foto.png", buffer: imageWithoutQr() },
      { name: "site.png", buffer: qrPng("https://exemplo.com/") },
      { name: "unica.png", buffer: qrPng("otpauth://totp/X:ana?secret=JBSWY3DPEHPK3PXP&issuer=X") }, // gitleaks:allow
      { name: "notas.txt", buffer: Buffer.from("texto"), mimeType: "text/plain" },
    ]);
    const errors = page.getByTestId("errors");
    await expect(errors).toBeVisible();
    await expect(errors).toContainText("foto.png: não achei QR nesta imagem.");
    await expect(errors).toContainText("site.png: este QR não é uma exportação do Google Authenticator.");
    await expect(errors).toContainText("unica.png: este QR já é de uma conta só (otpauth://).");
    await expect(errors).toContainText("notas.txt: este arquivo não é uma imagem.");
    // Mensagem de erro nunca carrega o conteúdo do QR.
    await expect(errors).not.toContainText("JBSWY3DPEHPK3PXP"); // gitleaks:allow
    await expect(page.getByTestId("account")).toHaveCount(0);
  });
});

test.describe("link colado", () => {
  test("campo do link: decodifica e limpa o campo", async ({ page }) => {
    const v = vector("accents_spaces_and_symbols");
    await openApp(page);
    await pasteLink(page, v.input);
    await expect(page.getByTestId("account-issuer")).toHaveText(v.accounts![0].issuer);
    await expect(page.getByTestId("account-name")).toHaveText(v.accounts![0].name);
    await expect(page.getByTestId("paste-field")).toHaveValue("");
  });

  test("vários links, um por linha", async ({ page }) => {
    await openApp(page);
    await pasteLink(page, `${vector("batch_1_of_3").input}\n${vector("batch_2_of_3").input}`);
    await expect(page.getByTestId("account")).toHaveCount(2);
    await expect(page.getByTestId("missing-parts")).toContainText("parte 3");
  });

  test("link inválido mostra erro sem vazar o conteúdo", async ({ page }) => {
    const v = vector("truncated_payload");
    await openApp(page);
    await pasteLink(page, v.input);
    await expect(page.getByTestId("errors")).toContainText("o link está cortado");
    await expect(page.getByTestId("errors")).not.toContainText(v.input.split("data=")[1]);
  });

  test("MD5 aparece com aviso e sem URI", async ({ page }) => {
    await openApp(page);
    await pasteLink(page, vector("md5_unsupported").input);
    const card = page.getByTestId("account");
    await expect(card.getByTestId("account-unsupported")).toContainText("MD5");
    await expect(card.getByTestId("copy-uri")).toBeDisabled();
    await expect(card.getByTestId("show-qr")).toBeDisabled();
    await expect(card.getByTestId("copy-secret")).toBeEnabled();
  });

  test("Cmd+V / Ctrl+V na página com o texto do link", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebKit e Firefox ignoram o clipboardData de um ClipboardEvent sintético");
    const v = vector("one_account");
    await openApp(page);
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, v.input);
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");
  });

  test("Cmd+V / Ctrl+V na página com a imagem", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "colar arquivo por evento sintético só funciona no Chromium");
    const v = vector("one_account");
    await openApp(page);
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "colado.png", { type: "image/png" }));
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, qrPng(v.input).toString("base64"));
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");
  });

  test("arrastar e soltar a imagem", async ({ page }) => {
    const v = vector("one_account");
    await openApp(page);
    const dataTransfer = await page.evaluateHandle((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "arrastado.png", { type: "image/png" }));
      return data;
    }, qrPng(v.input).toString("base64"));
    const zone = page.getByTestId("dropzone");
    await zone.dispatchEvent("dragenter", { dataTransfer });
    await expect(zone).toContainText("Solte para ler");
    await zone.dispatchEvent("dragover", { dataTransfer });
    await zone.dispatchEvent("drop", { dataTransfer });
    await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo");
  });
});

test.describe("copiar e limpar", () => {
  // Só o Chromium do Playwright aceita essas permissões; nos outros a lista fica vazia.
  test.use({ permissions: async ({ browserName }, use) => use(browserName === "chromium" ? ["clipboard-read", "clipboard-write"] : []) });

  test("copiar URI, copiar segredo e copiar todas", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "permissão de leitura do clipboard só no Chromium do Playwright");
    const v = vector("two_accounts_issuer_repeated_in_name");
    await openApp(page);
    await pasteLink(page, v.input);
    const cards = page.getByTestId("account");
    await expect(cards).toHaveCount(2);

    await cards.nth(1).getByTestId("copy-uri").click();
    await expect(cards.nth(1).getByTestId("copy-uri")).toHaveText("Copiado");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(v.accounts![1].uri);

    await cards.nth(0).getByTestId("copy-secret").click();
    await expect(cards.nth(0).getByTestId("copy-secret")).toHaveText("Copiado");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(v.accounts![0].secret);

    await page.getByTestId("copy-all").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(v.accounts!.map((a) => a.uri).join("\n"));
  });

  test("todas as URIs do QR denso batem com o contrato", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "permissão de leitura do clipboard só no Chromium do Playwright");
    const v = vector("ten_accounts_dense");
    await openApp(page);
    await upload(page, [{ name: "denso.png", buffer: qrPng(v.input, 4) }]);
    await expect(page.getByTestId("account")).toHaveCount(10);
    await page.getByTestId("copy-all").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(v.accounts!.map((a) => a.uri).join("\n"));
  });

  test("limpar tudo tira as contas da tela", async ({ page }) => {
    await openApp(page);
    await pasteLink(page, vector("one_account").input);
    await expect(page.getByTestId("account")).toHaveCount(1);
    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("empty")).toBeVisible();
    expect(await page.content()).not.toContain("ana@exemplo.com");
  });

  test("nada vai para storage nem para a URL", async ({ page }) => {
    await openApp(page);
    await pasteLink(page, vector("one_account").input);
    await expect(page.getByTestId("account")).toHaveCount(1);
    const storage = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
      url: location.href,
    }));
    expect(storage.local).toBe(0);
    expect(storage.session).toBe(0);
    expect(storage.idb).toBe(0);
    expect(storage.url).toMatch(/\/otp-out\/$/);
  });
});

test.describe("idioma", () => {
  test("troca pelo seletor e o lang do documento acompanha", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Move your Google Authenticator accounts to another app");
    await expect(page).toHaveTitle("otp-out: move your Google Authenticator accounts to another app");

    await page.getByTestId("language-trigger").click();
    await page.getByRole("menuitemradio", { name: "Español" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lleva tus cuentas de Google Authenticator a otra app");
  });

  test.describe("detecta o idioma do navegador", () => {
    test.use({ locale: "es-AR" });
    test("espanhol", async ({ page }) => {
      await openApp(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await expect(page.getByTestId("privacy-bar")).toHaveText("Todo pasa en este navegador. No se envía nada.");
    });
  });

  test.describe("idioma desconhecido cai no inglês", () => {
    test.use({ locale: "de-DE" });
    test("inglês", async ({ page }) => {
      await openApp(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });
});

test.describe("teclado", () => {
  test("o fluxo principal funciona só pelo teclado, com foco visível", async ({ page, browserName }) => {
    // No WebKit (como no Safari do macOS por padrão) o Tab pula botões.
    test.skip(browserName === "webkit", "o Tab do WebKit pula botões, igual ao padrão do Safari");
    await openApp(page);
    await pasteLink(page, vector("one_account").input);
    // Chega ao botão pelo teclado (Tab), que é quando o foco aparece.
    await page.getByTestId("toggle-secret").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
      .toBe("toggle-secret");
    const outline = await page.getByTestId("toggle-secret").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("account-secret")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
      .toBe("show-qr");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("qr-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("qr-dialog")).toBeHidden();
    // O foco volta para o botão que abriu o QR.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
      .toBe("show-qr");
  });
});

test.describe("aviso de privacidade e dica de entrada", () => {
  test("o link Como conferir leva ao bloco de privacidade e o destaca", async ({ page }) => {
    await openApp(page);
    const card = page.locator("#privacidade");
    await expect(card).not.toHaveAttribute("data-destaque", "");
    await page.getByRole("link", { name: "Como conferir" }).click();
    await expect(card).toHaveAttribute("data-destaque", "");
    await expect(card).toBeInViewport();
    await expect(card).toBeFocused();
    // O contorno aparece mesmo quando o bloco já estava na tela.
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("4px");
    await expect(card).not.toHaveAttribute("data-destaque", "", { timeout: 5000 });
  });

  test("no computador a dica de colar usa a tecla do sistema", async ({ page }) => {
    await openApp(page);
    const isMac = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
    await expect(page.getByText(`cole com ${isMac ? "Cmd" : "Ctrl"}+V`)).toBeVisible();
  });

  test("no celular a dica não fala de arrastar nem de atalho @mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "só no projeto de celular");
    await openApp(page);
    await expect(page.getByText("Toque no botão para escolher os prints.")).toBeVisible();
    await expect(page.getByText(/\+V/)).toHaveCount(0);
  });
});
