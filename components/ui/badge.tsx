import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/10 text-destructive",
        outline:     "border border-border text-foreground bg-transparent",
        success:     "status-active",
        warning:     "status-preparing",
        info:        "status-served",
        muted:       "status-inactive",
        // Order statuses
        preparing:   "status-preparing",
        ready:       "status-ready",
        served:      "status-served",
        cancelled:   "status-cancelled",
        // Table statuses
        occupied:    "status-occupied",
        available:   "status-available",
        reserved:    "status-reserved",
        // Stock statuses
        "in-stock":     "status-in-stock",
        "low-stock":    "status-low-stock",
        "out-of-stock": "status-out-of-stock",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
