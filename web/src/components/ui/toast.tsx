import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2Icon, CircleAlertIcon, XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// Toast do shadcn/ui (versão Radix Toast). O texto nunca leva segredo nem URI.
export interface ToastMessage {
  id: number;
  title: string;
  tone: "success" | "error";
}

type ToastFn = (title: string, tone?: ToastMessage["tone"]) => void;
const ToastContext = React.createContext<ToastFn>(() => {});

let nextId = 1;

export function Toaster({ children, closeLabel, regionLabel }: { children: React.ReactNode; closeLabel: string; regionLabel: string }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const push = React.useCallback<ToastFn>((title, tone = "success") => {
    setToasts((current) => [...current.slice(-2), { id: nextId++, title, tone }]);
  }, []);
  const remove = (id: number) => setToasts((current) => current.filter((t) => t.id !== id));
  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="down" duration={3500} label={regionLabel}>
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            type={toast.tone === "error" ? "foreground" : "background"}
            onOpenChange={(open) => !open && remove(toast.id)}
            className={cn(
              "animate-fade-in flex min-h-12 items-center gap-3 rounded-lg border bg-card py-2 pr-2 pl-4 text-card-foreground shadow-lg",
              toast.tone === "error" && "border-destructive-border",
            )}
          >
            {toast.tone === "error" ? (
              <CircleAlertIcon className="size-5 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2Icon className="size-5 shrink-0 text-success" aria-hidden="true" />
            )}
            <ToastPrimitive.Title className="min-w-0 flex-1 text-[0.95rem] [overflow-wrap:anywhere]">{toast.title}</ToastPrimitive.Title>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return React.useContext(ToastContext);
}
