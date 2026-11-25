import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { prerender } from "./vite-plugins/prerender.ts";
import { serviceWorker } from "./vite-plugins/service-worker.ts";
import { wasmBase64 } from "./vite-plugins/wasm-base64.ts";

// Portas reservadas para este projeto (skill portas-locais):
// 3160 dev, 3161 preview do build, 3168 sentinela do teste de CSP, 3169 servidor
// do E2E. Sempre em 127.0.0.1.
export default defineConfig(({ mode }) => {
  // Modo "visual": build só para a conferência de telas, com contas falsas já
  // carregadas. Não vai para produção e não registra service worker.
  const visual = mode === "visual";
  return {
    base: "/otp-out/",
    plugins: [wasmBase64(), react(), tailwindcss(), prerender(), serviceWorker({ enabled: !visual })],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    define: {
      __VISUAL_DEMO__: JSON.stringify(visual),
    },
    server: { host: "127.0.0.1", port: 3160, strictPort: true },
    preview: { host: "127.0.0.1", port: 3161, strictPort: true },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          notFound: fileURLToPath(new URL("./404.html", import.meta.url)),
        },
      },
    },
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});
