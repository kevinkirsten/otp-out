// Leitura de QR com o zxing-wasm. O WebAssembly vem embutido no JavaScript
// (import "?base64", plugin em vite-plugins/wasm-base64.ts) e é entregue ao módulo por
// `wasmBinary`, então não existe fetch: a CSP tem connect-src 'none'.
// O locateFile padrão da biblioteca aponta para um CDN. O Emscripten chama o
// locateFile para montar o nome do arquivo mesmo quando recebe wasmBinary, mas
// não busca nada. Ele é trocado por um que devolve só o nome local, para que
// nenhum endereço externo entre em jogo. Os testes E2E conferem que não há
// requisição nem violação de CSP.
import wasmBase64 from "zxing-wasm/reader/zxing_reader.wasm?base64";
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let ready: Promise<unknown> | null = null;

export function prepareReader(): Promise<unknown> {
  if (!ready) {
    const wasmBinary = base64ToBytes(wasmBase64);
    ready = prepareZXingModule({
      overrides: {
        wasmBinary: wasmBinary.buffer as ArrayBuffer,
        locateFile: (path: string) => path,
      },
      fireImmediately: true,
    });
  }
  return ready;
}

const options: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 8,
};

/** Textos de todos os QRs achados na imagem. */
export async function readQrTexts(image: ImageData): Promise<string[]> {
  await prepareReader();
  const results = await readBarcodes(image, options);
  return results.filter((r) => r.isValid && r.text).map((r) => r.text);
}
