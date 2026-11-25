// Entrada usada só no build (vite-plugins/prerender.ts): renderiza a página
// inteira de um idioma em HTML, com os mesmos componentes e textos do app.
// O resultado vai dentro do #root de cada index.html e o createRoot do
// main.tsx descarta e monta o app por cima.
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import type { Locale } from "./i18n/messages";

export function renderBody(locale: Locale): string {
  return renderToString(
    <StrictMode>
      <I18nProvider locale={locale}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}
