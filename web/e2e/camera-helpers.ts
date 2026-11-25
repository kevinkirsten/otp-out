// Câmera com o dispositivo falso do Chromium: o vídeo é um arquivo Y4M gerado
// aqui, com um QR sintético (segredos falsos). Só no Chromium, que é o único
// navegador do Playwright com câmera falsa alimentada por arquivo.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { test } from "./fixtures";
import { blankRaster, drawQr, qrModuleCount } from "./helpers";

const WIDTH = 640;
const HEIGHT = 480;

/** Vídeo Y4M (4:2:0) com o QR parado no meio da imagem. */
export function writeY4m(text: string, file: string) {
  const raster = blankRaster(WIDTH, HEIGHT, [230, 230, 230]);
  const modulePx = Math.max(2, Math.floor(400 / (qrModuleCount(text) + 8)));
  const side = (qrModuleCount(text) + 8) * modulePx;
  drawQr(raster, text, Math.floor((WIDTH - side) / 2), Math.floor((HEIGHT - side) / 2), modulePx);
  const y = Buffer.alloc(WIDTH * HEIGHT);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) y[i] = raster.data[i * 4];
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: 10 }, () => frame)]));
}

/** Grava o vídeo falso em test-results/camera/ (fora do git) e devolve o caminho. */
export function fakeVideo(name: string, text: string): string {
  const dir = fileURLToPath(new URL("../test-results/camera/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${name}.y4m`;
  writeY4m(text, file);
  return file;
}

/**
 * Opções do Playwright para a câmera falsa. Só valem no Chromium: nos outros
 * navegadores o teste é pulado e as opções ficam vazias, porque WebKit e
 * Firefox não conhecem essas flags nem a permissão "camera".
 */
export function cameraArgs(file: string): Parameters<typeof test.use>[0] {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${file}`];
  return {
    launchOptions: [async ({ browserName }, use) => use(browserName === "chromium" ? { args } : {}), { scope: "worker" }],
    permissions: async ({ browserName }, use) => use(browserName === "chromium" ? ["camera"] : []),
  };
}

// Guarda as streams abertas para conferir que a câmera foi liberada.
export async function trackStreams(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
}

export const liveTracks = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length,
  );

