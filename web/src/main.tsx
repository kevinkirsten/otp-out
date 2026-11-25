import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./index.css";


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

// Carrega o leitor de QR logo depois da página, para a primeira leitura ser
// rápida e para ele já estar no cache offline. Só arquivo da própria página.
window.addEventListener("load", () => {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1));
  idle(() => {
    import("./lib/qr-reader")
      .then((module) => module.prepareReader())
      .then(() => {
        document.documentElement.dataset.reader = "ready";
      })
      .catch(() => {
        document.documentElement.dataset.reader = "error";
      });
  });

  if (import.meta.env.PROD && !__VISUAL_DEMO__ && "serviceWorker" in navigator) {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Sem service worker a página funciona igual, só não abre offline.
    });
  }
});

if (__VISUAL_DEMO__) {
  void import("./demo").then((demo) => demo.install());
}
