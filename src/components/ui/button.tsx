import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Consolidates the action-button class string that was copy-pasted across the
// inline mutation controls. `touch` height is 44px on phones (Apple HIG
// minimum) and compact on desktop.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded border text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        outline: "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
        ghost: "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      },
      size: {
        default: "px-2 py-1",
        sm: "px-1.5 py-0.5",
        touch: "h-11 px-3 md:h-7 md:px-2",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = "Button"

export { Button, buttonVariants }
