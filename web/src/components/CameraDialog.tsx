import { CameraOffIcon, LoaderCircleIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { decodeMigrationUri, isMigrationUri, type MigrationBatch } from "@/lib/migration";

type Status =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "progress"; read: number; size: number }
  | { kind: "denied" }
  | { kind: "unavailable" };

interface CameraDialogProps {
  open: boolean;
  /** Botão que abriu a câmera: recebe o foco de volta quando o diálogo fecha. */
  returnFocusTo?: React.RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  /** Recebe cada lote novo lido. */
  onBatch: (batch: MigrationBatch) => void;
  /** Chamado quando todas as partes da exportação foram lidas. */
  onDone: () => void;
}

const SCAN_INTERVAL_MS = 200;
const MAX_FRAME_SIDE = 1280;

function CameraView({ onBatch, onDone }: Pick<CameraDialogProps, "onBatch" | "onDone">) {
  const { m, f } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [status, setStatus] = React.useState<Status>({ kind: "starting" });
  const onBatchRef = React.useRef(onBatch);
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onBatchRef.current = onBatch;
    onDoneRef.current = onDone;
  });

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const seen = new Set<string>();
    const parts = new Map<number, { size: number; indexes: Set<number> }>();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      // Libera a câmera: a luz do aparelho apaga aqui.
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const scan = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && context && video.readyState >= 2 && video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const { readQrTexts } = await import("@/lib/qr-reader");
          const texts = await readQrTexts(context.getImageData(0, 0, canvas.width, canvas.height));
          for (const text of texts) {
            if (stopped || seen.has(text) || !isMigrationUri(text)) continue;
            seen.add(text);
            let batch: MigrationBatch;
            try {
              batch = decodeMigrationUri(text);
            } catch {
              continue;
            }
            onBatchRef.current(batch);
            const entry = parts.get(batch.batchId) ?? { size: batch.batchSize, indexes: new Set<number>() };
            entry.indexes.add(batch.batchIndex);
            parts.set(batch.batchId, entry);
            const complete = [...parts.values()].every((p) => p.indexes.size >= p.size);
            if (complete) {
              stop();
              onDoneRef.current();
              return;
            }
            setStatus({ kind: "progress", read: entry.indexes.size, size: entry.size });
          }
        } catch {
          // Quadro ilegível: tenta o próximo.
        }
      }
      if (!stopped) timer = window.setTimeout(scan, SCAN_INTERVAL_MS);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: "unavailable" });
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          await video.play().catch(() => {});
        }
        setStatus({ kind: "scanning" });
        scan();
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setStatus({ kind: name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable" });
      }
    })();

    return stop;
  }, []);

  const message =
    status.kind === "starting"
      ? m.cameraStarting
      : status.kind === "scanning"
        ? m.cameraScanning
        : status.kind === "progress"
          ? f(m.cameraProgress, { read: status.read, size: status.size })
          : status.kind === "denied"
            ? m.cameraDenied
            : m.cameraUnavailable;
  const failed = status.kind === "denied" || status.kind === "unavailable";

  return (
    <>
      {!failed && (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="block aspect-[4/3] w-full object-cover"
            playsInline
            muted
            aria-label={m.cameraVideoLabel}
            data-testid="camera-video"
          />
        </div>
      )}
      <p
        role="status"
        className={`flex items-center gap-2 text-[0.95rem] ${failed ? "text-destructive" : "text-foreground"}`}
        data-testid="camera-status"
      >
        {!failed && <LoaderCircleIcon className="animate-spin-slow size-5 shrink-0 text-primary" aria-hidden="true" />}
        {message}
      </p>
    </>
  );
}

export function CameraDialog({ open, onOpenChange, onBatch, onDone, returnFocusTo }: CameraDialogProps) {
  const { m } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={m.close}
        data-testid="camera-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{m.cameraTitle}</DialogTitle>
          <DialogDescription>{m.cameraDescription}</DialogDescription>
        </DialogHeader>
        {/* A câmera só existe enquanto o diálogo está aberto. Fechar desmonta e solta a câmera. */}
        {open && <CameraView onBatch={onBatch} onDone={onDone} />}
        <div>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="camera-stop">
            <CameraOffIcon aria-hidden="true" />
            {m.cameraStop}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
