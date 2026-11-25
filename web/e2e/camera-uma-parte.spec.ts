// Câmera falsa do Chromium mostrando o QR de uma exportação de uma parte só.
import { cameraArgs, fakeVideo, liveTracks, trackStreams } from "./camera-helpers";
import { expect, test } from "./fixtures";
import { openApp, vector } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "câmera falsa por arquivo só no Chromium");
test.use(cameraArgs(fakeVideo("uma-parte", vector("one_account").input)));

test("câmera: lê o QR, fecha sozinha e libera a câmera", async ({ page }) => {
  await trackStreams(page);
  await openApp(page);
  await page.getByTestId("open-camera").click();
  await expect(page.getByTestId("camera-dialog")).toBeVisible();
  await expect(page.getByTestId("account-issuer")).toHaveText("Exemplo", { timeout: 15_000 });
  await expect(page.getByTestId("camera-dialog")).toBeHidden();
  await expect.poll(() => liveTracks(page)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.length)).toBeGreaterThan(0);
});
