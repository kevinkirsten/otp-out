import { CameraIcon, ClipboardPasteIcon, ImageUpIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

// Phones and tablets have no drag and drop and no paste shortcut.
// No HTML estático do build (import.meta.env.SSR) o texto sai sempre igual,
// sem depender da máquina que rodou o build.
const isTouchOnly =
  !import.meta.env.SSR && typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
const isMac =
  !import.meta.env.SSR && typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

interface IntakeProps {
  busy: boolean;
  dragging: boolean;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
  onCamera: () => void;
  cameraAvailable: boolean;
  cameraButtonRef?: React.Ref<HTMLButtonElement>;
}

export function Intake({ busy, dragging, onFiles, onText, onCamera, cameraAvailable, cameraButtonRef }: IntakeProps) {
  const { m, f } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const pasteId = React.useId();
  const helpId = React.useId();

  React.useEffect(() => {
    if (pasteOpen) textRef.current?.focus();
  }, [pasteOpen]);

  const submitText = () => {
    if (!text.trim()) return;
    onText(text);
    // O link contém os segredos: some do campo assim que é lido.
    setText("");
  };

  return (
    <section aria-labelledby="enviar" className="flex flex-col gap-4">
      <div
        data-testid="dropzone"
        className={cn(
          "flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-input bg-card px-4 py-8 text-center transition-colors sm:px-8 sm:py-10",
          dragging && "border-primary bg-secondary",
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-primary">
          <ImageUpIcon className="size-7" aria-hidden="true" />
        </span>
        <h2 id="enviar" className="text-xl font-semibold text-balance sm:text-2xl">
          {dragging ? m.dropRelease : m.dropTitle}
        </h2>
        <Button size="lg" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="choose-files">
          <ImageUpIcon aria-hidden="true" />
          {m.dropChoose}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          aria-label={m.dropInputLabel}
          data-testid="file-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <p className="max-w-[60ch] text-[0.95rem] text-muted-foreground">
          {isTouchOnly ? m.dropHintTouch : f(m.dropHint, { key: isMac ? "Cmd" : "Ctrl" })}
          <br />
          {m.dropFormats}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[0.95rem] font-medium text-muted-foreground">{m.orOther}</p>
        <div className="flex flex-wrap gap-3">
          {cameraAvailable && (
            <Button ref={cameraButtonRef} variant="outline" onClick={onCamera} disabled={busy} data-testid="open-camera">
              <CameraIcon aria-hidden="true" />
              {m.cameraOpen}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setPasteOpen((open) => !open)}
            aria-expanded={pasteOpen}
            aria-controls={pasteId}
            data-testid="open-paste"
          >
            <ClipboardPasteIcon aria-hidden="true" />
            {m.pasteOpen}
          </Button>
        </div>
        {pasteOpen && (
          <form
            id={pasteId}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitText();
            }}
          >
            <label htmlFor={`${pasteId}-field`} className="font-medium">
              {m.pasteLabel}
            </label>
            <p id={helpId} className="text-[0.95rem] text-muted-foreground">
              {m.pasteHelp}
            </p>
            <textarea
              id={`${pasteId}-field`}
              ref={textRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitText();
                }
              }}
              aria-describedby={helpId}
              placeholder={m.pastePlaceholder}
              rows={3}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-testid="paste-field"
              className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-base break-all text-foreground placeholder:text-muted-foreground focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <div>
              <Button type="submit" disabled={busy || !text.trim()} data-testid="paste-submit">
                {m.pasteSubmit}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
