import * as React from "react";
import { detectLocale, format, type Locale, MESSAGES, type Messages, plural } from "./messages";

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  m: Messages;
  f: typeof format;
  p: (forms: { one: string; other: string }, n: number, vars?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // O idioma não é guardado em lugar nenhum: vem do navegador a cada visita.
  const [locale, setLocale] = React.useState<Locale>(() =>
    detectLocale(typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]),
  );
  const m = MESSAGES[locale];
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.title = m.metaTitle;
    document.querySelector('meta[name="description"]')?.setAttribute("content", m.metaDescription);
  }, [locale, m]);
  const value = React.useMemo<I18n>(
    () => ({ locale, setLocale, m, f: format, p: (forms, n, vars) => plural(locale, forms, n, vars) }),
    [locale, m],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18n {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error("I18nProvider ausente");
  return value;
}
