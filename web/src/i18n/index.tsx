import * as React from "react";
import { detectLocale, format, type Locale, MESSAGES, type Messages, plural } from "./messages";
import { localeFromPath, pageUrl, pathForLocale } from "./routes";

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  m: Messages;
  f: typeof format;
  p: (forms: { one: string; other: string }, n: number, vars?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18n | null>(null);

const BASE = import.meta.env.BASE_URL;

function initialLocale(): Locale {
  // Em /pt/ e /es/ o idioma vem do caminho. Na raiz, do navegador, a cada visita:
  // o idioma não é guardado em lugar nenhum.
  if (typeof window === "undefined") return "en";
  const fromPath = localeFromPath(window.location.pathname, BASE);
  if (fromPath) return fromPath;
  return detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/**
 * `locale` fixa o idioma (usado no build, para gerar o HTML estático de cada página).
 * Sem ele, o idioma vem do caminho ou do navegador.
 */
export function I18nProvider({ children, locale: fixedLocale }: { children: React.ReactNode; locale?: Locale }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => fixedLocale ?? initialLocale());
  const m = MESSAGES[locale];

  // Trocar o idioma não recarrega a página: as contas lidas ficam só na memória
  // e se perderiam. Só o endereço muda para a página do idioma, sem query string.
  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    const path = pathForLocale(next, BASE);
    if (window.location.pathname !== path) {
      window.history.replaceState(window.history.state, "", path + window.location.hash);
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.title = m.metaTitle;
    document.querySelector('meta[name="description"]')?.setAttribute("content", m.metaDescription);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", pageUrl(locale));
  }, [locale, m]);

  const value = React.useMemo<I18n>(
    () => ({ locale, setLocale, m, f: format, p: (forms, n, vars) => plural(locale, forms, n, vars) }),
    [locale, setLocale, m],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18n {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error("I18nProvider ausente");
  return value;
}
