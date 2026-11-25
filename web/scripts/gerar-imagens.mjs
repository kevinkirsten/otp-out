// Gera os ícones PNG e a imagem de compartilhamento (og.png) em public/,
// renderizando HTML e SVG locais no Chromium do Playwright. Rodar com
// `pnpm images` quando a marca mudar. Nenhuma imagem tem QR.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const favicon = readFileSync(new URL("favicon.svg", `file://${publicDir}`), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [name, size, pad] of [
  ["favicon-32.png", 32, 0],
  ["apple-touch-icon.png", 180, 0],
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${favicon.replace("<svg ", `<svg width="${size - pad * 2}" height="${size - pad * 2}" style="display:block;margin:${pad}px" `)}</body></html>`,
  );
  await page.screenshot({ path: publicDir + name, omitBackground: true });
  console.log("gerado", name);
}

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:630px;background:#fbfaf8;color:#1d1c1a;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:700;letter-spacing:-0.5px}
  .brand svg{width:72px;height:72px}
  h1{font-size:60px;line-height:1.1;margin:36px 0 18px;letter-spacing:-1px;max-width:1000px}
  p{font-size:30px;margin:0;color:#5e5b55}
  .uri{margin-top:40px;display:inline-flex;align-self:flex-start;gap:0;padding:18px 24px;border-radius:14px;
    background:#ffffff;border:2px solid #dcd8cf;font:28px ui-monospace,SFMono-Regular,Menlo,monospace;color:#1d1c1a}
  .uri b{color:#0b5cad;font-weight:600}
  .ok{display:inline-flex;align-items:center;gap:10px;color:#1a6b3c;font-weight:600}
</style></head><body>
  <div class="brand">${favicon}<span>otp-out</span></div>
  <h1>Do QR do Google Authenticator para o link de cada conta</h1>
  <p class="ok">Tudo acontece no navegador. Nada é enviado.</p>
  <div class="uri"><b>otpauth://</b>totp/Exemplo:ana@exemplo.com?secret=••••••</div>
</body></html>`);
await page.screenshot({ path: publicDir + "og.png" });
console.log("gerado og.png");
await browser.close();
