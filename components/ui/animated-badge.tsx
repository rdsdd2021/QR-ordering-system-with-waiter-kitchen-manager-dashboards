import * as React from "react";
import { motion } from "motion/react";
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
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface AnimatedBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  animate?: boolean;
}

function AnimatedBadge({ 
  className, 
  variant, 
  animate = true,
  children,
  onDrag,
  onDragEnd,
  onDragEnter,
  onDragExit,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  ...props 
}: AnimatedBadgeProps) {
  if (!animate) {
    return (
      <span
        className={cn(badgeVariants({ variant }), className)}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onDragEnter={onDragEnter}
        onDragExit={onDragExit}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        onDrop={onDrop}
        {...props}
      >
        {children}
      </span>
    );
  }

  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      whileHover={{ scale: 1.05 }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 25
      }}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {children}
    </motion.span>
  );
}

export { AnimatedBadge, badgeVariants };
