import { ExternalLinkIcon, ShieldCheckIcon, SmartphoneIcon, TerminalIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { CLI_URL, REPO_URL } from "@/lib/links";

export function PrivacyCard() {
  const { m } = useI18n();
  return (
    <section id="privacidade" tabIndex={-1} aria-labelledby="privacidade-titulo" className="flex flex-col gap-3 rounded-xl border border-success/40 bg-card p-5 outline-0 outline-offset-4 outline-success transition-[outline-width] duration-200 focus:outline-0 data-[destaque]:outline-4 data-[destaque]:focus:outline-4">
      <h2 id="privacidade-titulo" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
        {m.privacyTitle}
      </h2>
      <p className="text-[0.95rem]">{m.privacyBody}</p>
      <h3 className="font-semibold">{m.verifyTitle}</h3>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-[0.95rem]">
        <li>{m.verifyNetwork}</li>
        <li>{m.verifyOffline}</li>
        <li>
          {m.verifyCode}{" "}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere]">
            github.com/kevinkirsten/otp-out
          </a>
        </li>
      </ul>
    </section>
  );
}

export function HowToCard() {
  const { m } = useI18n();
  return (
    <section aria-labelledby="como-exportar" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h2 id="como-exportar" className="text-lg font-semibold">
        {m.howTitle}
      </h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[0.95rem]">
        {m.howSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="flex gap-2 rounded-lg bg-muted p-3 text-[0.95rem]">
        <SmartphoneIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{m.howAndroid}</span>
      </p>
    </section>
  );
}

export function CliCard() {
  const { m } = useI18n();
  return (
    <section aria-labelledby="cli" className="flex flex-col gap-2 rounded-xl border bg-card p-5">
      <h2 id="cli" className="flex items-center gap-2 text-lg font-semibold">
        <TerminalIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {m.cliTitle}
      </h2>
      <p className="text-[0.95rem]">{m.cliBody}</p>
      <a
        href={CLI_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium"
      >
        {m.cliLink}
        <ExternalLinkIcon className="size-4" aria-hidden="true" />
      </a>
    </section>
  );
}
