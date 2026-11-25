import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// Menu do shadcn/ui sobre o Radix DropdownMenu. Sempre com modal={false}: no modo
// modal o Radix usa o react-remove-scroll, que injeta <style> e a CSP bloqueia.
function DropdownMenu(props: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Root>, "modal">) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" modal={false} {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "animate-fade-in z-50 min-w-[12rem] overflow-hidden rounded-lg border bg-card p-1 text-card-foreground shadow-lg",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-3 py-2 text-sm font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuRadioGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex min-h-11 cursor-default items-center gap-2 rounded-md py-2 pr-3 pl-9 text-base outline-none select-none data-[highlighted]:bg-muted data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger };
