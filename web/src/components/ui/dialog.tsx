import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// Diálogo do shadcn/ui sobre o Radix Dialog. Diferença: o fundo escuro é um
// <div> comum, e não o DialogPrimitive.Overlay. O Overlay do Radix usa o
// react-remove-scroll, que injeta um <style> na página, e a CSP desta página
// (style-src 'self') bloqueia isso. A rolagem do fundo é travada pelo CSSOM,
// que a CSP permite.
function useLockBodyScroll(open: boolean) {
  React.useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);
}

const DialogOpenContext = React.createContext(false);

function Dialog({ open, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [innerOpen, setInnerOpen] = React.useState(props.defaultOpen ?? false);
  const isOpen = open ?? innerOpen;
  useLockBodyScroll(isOpen);
  return (
    <DialogOpenContext.Provider value={isOpen}>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={isOpen}
        onOpenChange={(value) => {
          setInnerOpen(value);
          onOpenChange?.(value);
        }}
        {...props}
      />
    </DialogOpenContext.Provider>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  const open = React.useContext(DialogOpenContext);
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      {open && <div aria-hidden="true" className="animate-fade-in fixed inset-0 z-50 bg-overlay" />}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "animate-pop-in fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-5 text-card-foreground shadow-xl sm:p-6",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-5" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-snug font-semibold [overflow-wrap:anywhere]", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[0.95rem] text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
