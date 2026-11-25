import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

// Botão do shadcn/ui, com alvo de toque de 44px em todos os tamanhos.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-base font-medium whitespace-nowrap transition-colors select-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border border-input bg-card text-foreground hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive: "border border-destructive-border bg-card text-destructive hover:bg-destructive-soft",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        lg: "min-h-14 px-6 py-3 text-lg",
        sm: "min-h-11 px-3 py-2 text-[0.95rem]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
