// Um endereço por idioma. A raiz é o inglês (e o x-default); português e
// espanhol ficam numa pasta própria. Este arquivo vai para o navegador, então
// não importa nada além do tipo do idioma.
import type { Locale } from "./messages";

export const SITE_URL = "https://kevinkirsten.github.io/otp-out/";

/** Pasta de cada idioma dentro da base da página. */
export const LOCALE_DIRS: Record<Locale, string> = { en: "", "pt-BR": "pt/", es: "es/" };

/** Caminho da página do idioma, por exemplo "/otp-out/pt/". */
export function pathForLocale(locale: Locale, base: string): string {
  return base + LOCALE_DIRS[locale];
}

/** URL pública da página do idioma, usada no canonical, no hreflang e no sitemap. */
export function pageUrl(locale: Locale): string {
  return SITE_URL + LOCALE_DIRS[locale];
}

/**
 * Idioma que o caminho fixa. Na raiz (ou em qualquer outro caminho) devolve
 * null, e a página usa o idioma do navegador.
 */
export function localeFromPath(pathname: string, base: string): Locale | null {
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length);
  for (const [locale, dir] of Object.entries(LOCALE_DIRS) as [Locale, string][]) {
    if (!dir) continue;
    if (rest === dir || rest === dir.slice(0, -1) || rest === `${dir}index.html`) return locale;
  }
  return null;
}
