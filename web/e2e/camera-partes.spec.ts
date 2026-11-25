// Câmera falsa do Chromium mostrando só a parte 1 de uma exportação em 3 partes.
import { cameraArgs, fakeVideo, liveTracks, trackStreams } from "./camera-helpers";
import { expect, test } from "./fixtures";
import { openApp, vector } from "./helpers";

test.skip(({ browserName }) => browserName !== "chromium", "câmera falsa por arquivo só no Chromium");
test.use(cameraArgs(fakeVideo("parte-1-de-3", vector("batch_1_of_3").input)));

test("câmera: mostra o progresso, continua lendo e o botão de parar libera a câmera", async ({ page }) => {
  await trackStreams(page);
  await openApp(page);
  await page.getByTestId("open-camera").click();
  await expect(page.getByTestId("camera-status")).toHaveText("Parte 1 de 3 lida. Mostre a próxima.", { timeout: 15_000 });
  expect(await liveTracks(page)).toBeGreaterThan(0);
  await page.getByTestId("camera-stop").click();
  await expect(page.getByTestId("camera-dialog")).toBeHidden();
  await expect.poll(() => liveTracks(page)).toBe(0);
  await expect(page.getByTestId("account")).toHaveCount(1);
  await expect(page.getByTestId("missing-parts")).toContainText("partes 2 e 3");
});
