import { CircleAlertIcon, CopyIcon, InboxIcon, LoaderCircleIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import { AccountCard } from "@/components/AccountCard";
import { CameraDialog } from "@/components/CameraDialog";
import { Header, PrivacyBar } from "@/components/Header";
import { Intake } from "@/components/Intake";
import { CliCard, HowToCard, PrivacyCard } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Toaster, useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import type { Messages } from "@/i18n/messages";
import { copyText } from "@/lib/clipboard";
import { isImageFile } from "@/lib/image";
import { type IntakeError, type IntakeResult, intakeFiles, intakeText } from "@/lib/intake";
import type { MigrationBatch } from "@/lib/migration";
import { useAccounts } from "@/lib/use-accounts";

function errorMessage(m: Messages, f: (t: string, v?: Record<string, string | number>) => string, error: IntakeError) {
  const file = error.source ?? m.pastedText;
  switch (error.code) {
    case "no_qr":
      return f(m.errNoQr, { file });
    case "not_migration_qr":
      return f(m.errNotMigration, { file });
    case "single_account":
      return f(m.errSingleAccount, { file });
    case "image":
      return f(m.errImage, { file });
    case "heic":
      return f(m.errHeic, { file });
    case "not_image":
      return f(m.errNotImage, { file });
    case "reader":
      return f(m.errReader, { file });
    default:
      return f(m.errCode[error.code], { file });
  }
}

const cameraAvailable = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function Main() {
  const { m, f, p } = useI18n();
  const toast = useToast();
  const { accounts, missing, add, clear } = useAccounts();
  const [busy, setBusy] = React.useState<number>(0);
  const [errors, setErrors] = React.useState<IntakeError[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const cameraButtonRef = React.useRef<HTMLButtonElement>(null);

  const finish = React.useCallback(
    (result: IntakeResult) => {
      setErrors(result.errors);
      if (result.batches.length) {
        const added = add(result.batches);
        toast(added ? p(m.added, added) : m.noneAdded);
      }
    },
    [add, toast, p, m],
  );

  const handleFiles = React.useCallback(
    async (files: File[]) => {
      setBusy(files.length);
      setErrors([]);
      try {
        finish(await intakeFiles(files));
      } finally {
        setBusy(0);
      }
    },
    [finish],
  );

  const handleText = React.useCallback((text: string) => finish(intakeText(text)), [finish]);

  // Só no build de conferência visual: recebe as contas falsas do demo.ts.
  React.useEffect(() => {
    if (!__VISUAL_DEMO__) return;
    const onDemo = (event: Event) => finish((event as CustomEvent<IntakeResult>).detail);
    window.addEventListener("otp-out:demo", onDemo);
    return () => window.removeEventListener("otp-out:demo", onDemo);
  }, [finish]);

  // Colar em qualquer lugar da página (fora do campo do link): imagem ou texto.
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input")) return;
      const data = event.clipboardData;
      if (!data) return;
      const files = Array.from(data.files ?? []).filter(isImageFile);
      if (files.length) {
        event.preventDefault();
        void handleFiles(files);
        return;
      }
      const text = data.getData("text/plain");
      if (text && /otpauth(-migration)?:/i.test(text)) {
        event.preventDefault();
        handleText(text);
      } else if (text || data.items?.length) {
        toast(m.pasteNotice, "error");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFiles, handleText, toast, m]);

  // Arrastar e soltar em qualquer lugar da página. Sem isto, soltar fora da
  // área faria o navegador abrir a imagem no lugar da página.
  React.useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void handleFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  const onCameraBatch = React.useCallback(
    (batch: MigrationBatch) => {
      setErrors([]);
      const added = add([batch]);
      if (added) toast(p(m.added, added));
    },
    [add, toast, p, m],
  );

  const copyAll = async () => {
    const uris = accounts.map((a) => a.uri).filter((u): u is string => !!u);
    if (await copyText(uris.join("\n"))) toast(p(m.copiedAll, uris.length));
    else toast(m.copyFailed, "error");
  };

  const clearAll = () => {
    clear();
    setErrors([]);
    toast(m.cleared);
  };

  const listMissing = (numbers: number[]) =>
    numbers.length <= 1 ? String(numbers[0] ?? "") : numbers.slice(0, -1).join(", ") + m.listAnd + numbers[numbers.length - 1];

  return (
    <main id="conteudo" className="mx-auto grid w-full max-w-[1440px] gap-8 px-4 pt-2 pb-12 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] xl:gap-10">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-3 pt-2">
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-balance sm:text-4xl">{m.heroTitle}</h1>
          <p className="max-w-[65ch] text-lg text-muted-foreground">{m.heroLead}</p>
        </section>

        <Intake
          busy={busy > 0}
          dragging={dragging}
          onFiles={handleFiles}
          onText={handleText}
          onCamera={() => setCameraOpen(true)}
          cameraAvailable={cameraAvailable}
          cameraButtonRef={cameraButtonRef}
        />

        <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
          {busy > 0 && (
            <p role="status" className="flex items-center gap-2 rounded-lg border bg-card p-3" data-testid="reading">
              <LoaderCircleIcon className="animate-spin-slow size-5 shrink-0 text-primary" aria-hidden="true" />
              {p(m.reading, busy)}
            </p>
          )}
        </div>

        {errors.length > 0 && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive-border bg-destructive-soft p-4" data-testid="errors">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <CircleAlertIcon className="size-5 shrink-0" aria-hidden="true" />
              {m.errorsTitle}
            </p>
            <ul className="flex flex-col gap-1 pl-7 text-[0.95rem]">
              {errors.map((error, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {errorMessage(m, f, error)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {missing.map((part) => (
          <div
            key={part.batchId}
            role="alert"
            className="flex gap-3 rounded-xl border border-warning-border bg-warning-soft p-4"
            data-testid="missing-parts"
          >
            <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{m.missingTitle}</p>
              <p className="text-[0.95rem]">
                {p(m.missingBody, part.read, { size: part.size, read: part.read })}{" "}
                {p(m.missingAsk, part.missing.length, { list: listMissing(part.missing) })}
              </p>
            </div>
          </div>
        ))}

        <section aria-labelledby="contas" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="contas" className="mr-auto text-xl font-semibold" data-testid="results-title">
              {p(m.resultsTitle, accounts.length)}
            </h2>
            {accounts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyAll} disabled={!accounts.some((a) => a.uri)} data-testid="copy-all">
                  <CopyIcon aria-hidden="true" />
                  {m.copyAll}
                </Button>
                <Button variant="destructive" size="sm" onClick={clearAll} data-testid="clear-all">
                  <Trash2Icon aria-hidden="true" />
                  {m.clearAll}
                </Button>
              </div>
            )}
          </div>
          {accounts.length > 0 ? (
            <>
              <p className="-mt-2 text-[0.95rem] text-muted-foreground">{m.resultsMemory}</p>
              <ul className="grid max-w-[56rem] gap-4" data-testid="accounts">
                {accounts.map((view) => (
                  <AccountCard key={view.id} view={view} />
                ))}
              </ul>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center" data-testid="empty">
              <InboxIcon className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-semibold">{m.emptyTitle}</p>
              <p className="max-w-[48ch] text-[0.95rem] text-balance text-muted-foreground">{m.emptyBody}</p>
            </div>
          )}
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6 xl:pt-2">
        <PrivacyCard />
        <HowToCard />
        <CliCard />
      </aside>

      <CameraDialog
        returnFocusTo={cameraButtonRef}
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onBatch={onCameraBatch}
        onDone={() => {
          setCameraOpen(false);
          toast(m.cameraDone);
        }}
      />
    </main>
  );
}

export function App() {
  const { m } = useI18n();
  return (
    <Toaster closeLabel={m.close} regionLabel="Notifications ({hotkey})">
      <a
        href="#conteudo"
        className="fixed top-2 left-2 z-50 inline-flex min-h-11 -translate-y-[200%] items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground no-underline focus:translate-y-0 hover:text-primary-foreground"
      >
        {m.skipToContent}
      </a>
      <PrivacyBar />
      <Header />
      <Main />
      <footer className="mx-auto mt-auto w-full max-w-[1440px] border-t px-4 py-6 text-[0.95rem] text-muted-foreground sm:px-6 lg:px-8">
        {m.footer}
      </footer>
    </Toaster>
  );
}
