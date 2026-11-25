// Utilitários dos testes E2E. Todas as imagens de QR são sintéticas, geradas
// aqui na hora do teste, com os segredos falsos do testdata/vectors.json.
// Nenhuma imagem de QR fica versionada.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import qrcode from "qrcode-generator";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

export interface VectorAccount {
  issuer: string;
  name: string;
  type: string;
  algorithm: string;
  digits: number;
  counter: number;
  secret: string;
  uri: string | null;
}
export interface VectorCase {
  name: string;
  input: string;
  error?: boolean;
  accounts?: VectorAccount[];
}

const vectorsPath = fileURLToPath(new URL("../../testdata/vectors.json", import.meta.url));
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as { cases: VectorCase[] };

export function vector(name: string): VectorCase {
  const found = vectors.cases.find((c) => c.name === name);
  if (!found) throw new Error(`caso ${name} não existe no vectors.json`);
  return found;
}

// ------------------------------------------------------------------ imagens

export interface Raster {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8Array;
}

export function blankRaster(width: number, height: number, rgb: [number, number, number] = [255, 255, 255]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(r: Raster, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  for (let yy = Math.max(0, y); yy < Math.min(r.height, y + h); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(r.width, x + w); xx += 1) {
      const i = (yy * r.width + xx) * 4;
      r.data[i] = rgb[0];
      r.data[i + 1] = rgb[1];
      r.data[i + 2] = rgb[2];
    }
  }
}

/** Desenha o QR do texto com `modulePx` pixels por módulo e margem de 4 módulos. */
export function drawQr(r: Raster, text: string, x: number, y: number, modulePx: number) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  fillRect(r, x, y, (count + margin * 2) * modulePx, (count + margin * 2) * modulePx, [255, 255, 255]);
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) fillRect(r, x + (col + margin) * modulePx, y + (row + margin) * modulePx, modulePx, modulePx, [0, 0, 0]);
    }
  }
  return (count + margin * 2) * modulePx;
}

export function qrModuleCount(text: string): number {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  return qr.getModuleCount();
}

export function toPng(r: Raster): Buffer {
  const png = new PNG({ width: r.width, height: r.height });
  png.data = Buffer.from(r.data);
  return PNG.sync.write(png);
}

/** PNG só com o QR (fundo branco). */
export function qrPng(text: string, modulePx = 6): Buffer {
  const size = (qrModuleCount(text) + 8) * modulePx;
  const r = blankRaster(size, size);
  drawQr(r, text, 0, 0, modulePx);
  return toPng(r);
}

/** Um "print" grande de tela com faixas e blocos, e o QR pequeno num canto. */
export function screenshotWithSmallQr(text: string): Buffer {
  const r = blankRaster(2400, 1600, [242, 242, 247]);
  fillRect(r, 0, 0, 2400, 120, [33, 33, 36]);
  for (let i = 0; i < 8; i += 1) fillRect(r, 80, 200 + i * 150, 1400 - i * 90, 60, [200, 200, 210]);
  fillRect(r, 1600, 200, 700, 1200, [255, 255, 255]);
  const modulePx = Math.max(3, Math.floor(260 / (qrModuleCount(text) + 8)));
  drawQr(r, text, 1820, 1050, modulePx);
  return toPng(r);
}

/** Imagem sem QR nenhum. */
export function imageWithoutQr(): Buffer {
  const r = blankRaster(800, 600, [250, 250, 250]);
  for (let i = 0; i < 6; i += 1) fillRect(r, 40, 40 + i * 90, 700 - i * 60, 40, [180, 190, 200]);
  return toPng(r);
}

// ---------------------------------------------------- exportação sintética

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 127) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function lengthDelimited(field: number, bytes: number[]): number[] {
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}

function varintField(field: number, value: number): number[] {
  return [...varint(field << 3), ...varint(value)];
}

/** Monta um otpauth-migration:// com contas TOTP SHA1 de 6 dígitos (segredos falsos). */
export function migrationUri(
  accounts: { secret: number[]; name: string; issuer: string }[],
  batch: { size: number; index: number; id: number },
): string {
  const enc = new TextEncoder();
  const payload: number[] = [];
  for (const account of accounts) {
    const otp = [
      ...lengthDelimited(1, account.secret),
      ...lengthDelimited(2, [...enc.encode(account.name)]),
      ...lengthDelimited(3, [...enc.encode(account.issuer)]),
      ...varintField(4, 1),
      ...varintField(5, 1),
      ...varintField(6, 2),
    ];
    payload.push(...lengthDelimited(1, otp));
  }
  payload.push(...varintField(2, 1), ...varintField(3, batch.size), ...varintField(4, batch.index), ...varintField(5, batch.id));
  const base64 = Buffer.from(payload).toString("base64");
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

// --------------------------------------------------------- leitura de QR

let readerReady: Promise<unknown> | null = null;

/** Lê os QRs de um PNG com o zxing-wasm no Node (wasm local, sem rede). */
export async function readQrFromPng(png: Buffer): Promise<string[]> {
  if (!readerReady) {
    const wasm = readFileSync(fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm")));
    readerReady = prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
      fireImmediately: true,
    });
  }
  await readerReady;
  const results = await readBarcodes(new Uint8Array(png), { formats: ["QRCode"], tryHarder: true });
  return results.filter((r) => r.isValid).map((r) => r.text);
}

// ------------------------------------------------------------------ página

/** Abre a página e espera o leitor de QR ficar pronto. */
export async function openApp(page: Page, path = "./") {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-reader", "ready", { timeout: 20_000 });
}

export async function upload(page: Page, files: { name: string; buffer: Buffer; mimeType?: string }[]) {
  await page.getByTestId("file-input").setInputFiles(
    files.map((f) => ({ name: f.name, mimeType: f.mimeType ?? "image/png", buffer: f.buffer })),
  );
}

export async function pasteLink(page: Page, text: string) {
  const field = page.getByTestId("paste-field");
  if (!(await field.isVisible())) await page.getByTestId("open-paste").click();
  await field.fill(text);
  await page.getByTestId("paste-submit").click();
}

/** Converte um PNG para outro formato dentro do navegador (canvas), sem rede. */
export async function convertInBrowser(page: Page, png: Buffer, type: "image/jpeg" | "image/webp"): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ data, type }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type, quality: 0.92 });
      if (blob.type !== type) throw new Error(`navegador não gera ${type}`);
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const b of buffer) binary += String.fromCharCode(b);
      return btoa(binary);
    },
    { data: png.toString("base64"), type },
  );
  return Buffer.from(base64, "base64");
}

/**
 * Lê o QR que a página desenhou. No Chromium tira um screenshot de verdade do
 * elemento. No WebKit o screenshot do Playwright injeta um <style> (a CSP da
 * página bloqueia e o teste acusaria), então lá o SVG é rasterizado aqui no
 * Node a partir do próprio caminho que a página gerou.
 */
export async function readRenderedQr(page: Page, browserName: string): Promise<string[]> {
  const svg = page.getByTestId("account-qr");
  if (browserName === "chromium") return readQrFromPng(await svg.screenshot());
  const { viewBox, d } = await svg.evaluate((el) => ({
    viewBox: el.getAttribute("viewBox") ?? "",
    d: el.querySelector("path")?.getAttribute("d") ?? "",
  }));
  const size = Number(viewBox.split(" ")[2]);
  const scale = 6;
  const r = blankRaster(size * scale, size * scale);
  for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(match[1]), Number(match[2]), Number(match[3])];
    fillRect(r, x * scale, y * scale, w * scale, scale, [0, 0, 0]);
  }
  return readQrFromPng(toPng(r));
}
