import type { MouseEvent } from "react";
import { ChevronDownIcon, GlobeIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { type Locale, LOCALE_NAMES, LOCALES } from "@/i18n/messages";
import { REPO_URL } from "@/lib/links";
import { Logo } from "./Logo";

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

// The privacy card is often already on screen (desktop sidebar), so a plain
// anchor jump looks like nothing happened. Scroll to it, focus it and outline
// it for a moment so the click always has a visible result.
let highlightTimer: number | undefined;
function showPrivacyCard(event: MouseEvent<HTMLAnchorElement>) {
  const card = document.getElementById("privacidade");
  if (!card) return;
  event.preventDefault();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  card.focus({ preventScroll: true });
  card.setAttribute("data-destaque", "");
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => card.removeAttribute("data-destaque"), 2500);
}

export function PrivacyBar() {
  const { m } = useI18n();
  return (
    <div className="sticky top-0 z-40 border-b border-success/30 bg-success-soft text-foreground min-[1504px]:rounded-b-xl min-[1504px]:border-x">
      <div className="mx-auto flex min-h-11 w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-0 px-4 py-1 sm:px-6 lg:px-8">
        <ShieldCheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[0.95rem] leading-snug font-medium" data-testid="privacy-bar">
          {m.privacyBar}
        </p>
        <a
          href="#privacidade"
          onClick={showPrivacyCard}
          className="inline-flex min-h-11 items-center text-[0.95rem] font-medium text-success underline hover:text-success"
        >
          {m.privacyBarLink}
        </a>
      </div>
    </div>
  );
}

export function Header() {
  const { m, locale, setLocale } = useI18n();
  return (
    <header className="mx-auto flex w-full max-w-[1440px] items-center gap-2 px-4 pt-4 pb-2 sm:px-6 lg:px-8">
      <a href="./" className="mr-auto inline-flex min-h-11 items-center gap-2 text-foreground no-underline hover:text-foreground">
        <Logo className="size-8" />
        <span className="text-lg font-semibold tracking-tight">otp-out</span>
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`${m.language}: ${LOCALE_NAMES[locale]}`} data-testid="language-trigger">
            <GlobeIcon aria-hidden="true" />
            <span className="hidden sm:inline">{LOCALE_NAMES[locale]}</span>
            <span className="sm:hidden">{locale === "pt-BR" ? "PT" : locale.toUpperCase()}</span>
            <ChevronDownIcon className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{m.language}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            {LOCALES.map((code) => (
              <DropdownMenuRadioItem key={code} value={code} lang={code}>
                {LOCALE_NAMES[code]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" asChild>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={m.sourceCodeLabel} className="text-foreground no-underline hover:text-foreground">
          <GithubMark />
          <span className="hidden sm:inline">{m.sourceCode}</span>
        </a>
      </Button>
    </header>
  );
}
