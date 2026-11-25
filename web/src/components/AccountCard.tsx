import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, QrCodeIcon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import { copyText } from "@/lib/clipboard";
import { base32NoPadding } from "@/lib/otpauth";
import { qrMatrix } from "@/lib/qr-svg";
import type { AccountView } from "@/lib/use-accounts";

function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    copied,
    (key) => {
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 2000);
    },
  ];
}

export function QrImage({ text, label }: { text: string; label: string }) {
  const matrix = React.useMemo(() => qrMatrix(text), [text]);
  return (
    // Fundo branco com margem também no tema escuro: leitor de QR precisa de contraste.
    <div className="mx-auto w-full max-w-[22rem] rounded-lg bg-white p-2">
      <svg
        viewBox={`0 0 ${matrix.size} ${matrix.size}`}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
        className="block h-auto w-full"
        data-testid="account-qr"
      >
        <rect width={matrix.size} height={matrix.size} fill="#ffffff" />
        <path d={matrix.path} fill="#000000" />
      </svg>
    </div>
  );
}

export function AccountCard({ view }: { view: AccountView }) {
  const { m, f } = useI18n();
  const toast = useToast();
  const [revealed, setRevealed] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [copied, markCopied] = useCopied();
  const { account, uri } = view;
  const issuer = account.issuer || m.noIssuer;
  const name = account.name || m.noName;
  const displayName = account.issuer || account.name || m.noName;
  const secretId = React.useId();
  const qrButtonRef = React.useRef<HTMLButtonElement>(null);

  const details: string[] = [account.type.toUpperCase()];
  if (account.algorithm !== "SHA1") details.push(account.algorithm);
  if (account.digits !== 6) details.push(f(m.digits, { n: account.digits }));
  if (account.type === "hotp") details.push(f(m.counter, { n: account.counter.toString() }));

  const copy = async (key: "uri" | "secret") => {
    const value = key === "uri" ? uri : base32NoPadding(account.secret);
    if (!value) return;
    if (await copyText(value)) {
      markCopied(key);
      toast(f(key === "uri" ? m.copiedUri : m.copiedSecret, { name: displayName }));
    } else {
      toast(m.copyFailed, "error");
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5" data-testid="account">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <KeyRoundIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className={`text-lg leading-snug font-semibold [overflow-wrap:anywhere] ${account.issuer ? "" : "text-muted-foreground italic"}`}
            data-testid="account-issuer"
          >
            {issuer}
          </h3>
          <p
            className={`leading-snug [overflow-wrap:anywhere] ${account.name ? "text-muted-foreground" : "text-muted-foreground italic"}`}
            data-testid="account-name"
          >
            {name}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-secondary px-2 py-1 font-mono text-xs leading-none font-medium" data-testid="account-type">
          {details.join(" · ")}
        </span>
      </div>

      {!uri && (
        <p className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-[0.95rem] text-foreground" data-testid="account-unsupported">
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <span>{m.unsupported}</span>
        </p>
      )}

      <div className="flex min-h-11 items-center gap-2 rounded-lg bg-muted py-1 pr-1 pl-3">
        <span className="shrink-0 text-sm font-medium text-muted-foreground" id={secretId}>
          {m.secret}
        </span>
        {revealed ? (
          <code className="min-w-0 flex-1 font-mono text-[0.95rem] break-all" aria-labelledby={secretId} data-testid="account-secret">
            {groupSecret(base32NoPadding(account.secret))}
          </code>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono tracking-widest text-muted-foreground" data-testid="account-secret-hidden">
            <span aria-hidden="true">••••••••••••••••</span>
            <span className="sr-only">{m.secretHidden}</span>
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={revealed}
          aria-label={revealed ? m.hide : m.reveal}
          title={revealed ? m.hide : m.reveal}
          onClick={() => setRevealed((value) => !value)}
          data-testid="toggle-secret"
        >
          {revealed ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm" onClick={() => copy("uri")} disabled={!uri} data-testid="copy-uri">
          {copied === "uri" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <span aria-live="polite">{copied === "uri" ? m.copied : m.copyUri}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => copy("secret")} data-testid="copy-secret">
          {copied === "secret" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <span aria-live="polite">{copied === "secret" ? m.copied : m.copySecret}</span>
        </Button>
        <Button ref={qrButtonRef} variant="outline" size="sm" onClick={() => setQrOpen(true)} disabled={!uri} data-testid="show-qr">
          <QrCodeIcon aria-hidden="true" />
          {m.showQr}
        </Button>
      </div>

      {uri && (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent
            closeLabel={m.close}
            data-testid="qr-dialog"
            onCloseAutoFocus={(event) => {
              // Devolve o foco ao botão que abriu o diálogo (navegação por teclado).
              event.preventDefault();
              qrButtonRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{f(m.qrTitle, { name: displayName })}</DialogTitle>
              <DialogDescription>{m.qrDescription}</DialogDescription>
            </DialogHeader>
            {account.issuer && account.name && <p className="-mt-2 text-[0.95rem] [overflow-wrap:anywhere]">{account.name}</p>}
            {qrOpen && <QrImage text={uri} label={f(m.qrTitle, { name: displayName })} />}
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}
