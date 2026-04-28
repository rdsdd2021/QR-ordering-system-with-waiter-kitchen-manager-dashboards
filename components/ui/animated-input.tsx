import * as React from "react";
import { motion, HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedInputProps extends Omit<HTMLMotionProps<"input">, "ref"> {
  error?: boolean;
}

const AnimatedInput = React.forwardRef<HTMLInputElement, AnimatedInputProps>(
  ({ className, type, error, onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);

    return (
      <div className="relative">
        <motion.input
          ref={ref}
          type={type}
          data-slot="input"
          onFocus={(e) => {
            setIsFocused(true);
            (onFocus as React.FocusEventHandler<HTMLInputElement>)?.(e as unknown as React.FocusEvent<HTMLInputElement>);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            (onBlur as React.FocusEventHandler<HTMLInputElement>)?.(e as unknown as React.FocusEvent<HTMLInputElement>);
          }}
          animate={{
            scale: isFocused ? 1.01 : 1,
          }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 25
          }}
          className={cn(
            "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-all outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
            error && "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
            className
          )}
          {...props}
        />
        {isFocused && (
          <motion.div
            layoutId="input-focus-indicator"
            className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </div>
    );
  }
);

AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
