import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { value: string; direction: "up" | "down" | "neutral"; label?: string };
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  className?: string;
  suffix?: string;
  attention?: boolean;
  attentionLabel?: string;
}

export function StatCard({
  label, value, trend, icon: Icon, iconColor, iconBg,
  className, suffix, attention, attentionLabel,
}: StatCardProps) {
  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-4 flex items-start gap-3 card-shadow",
      className
    )}>
      {Icon && (
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          iconBg ?? "bg-primary/10"
        )}>
          <Icon className={cn("h-5 w-5", iconColor ?? "text-primary")} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        <p className="text-xl font-bold text-foreground mt-0.5 leading-tight">
          {value}{suffix && <span className="text-sm font-normal text-muted-foreground ml-1">{suffix}</span>}
        </p>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 mt-1 text-xs font-medium",
            trend.direction === "up" ? "trend-up" : trend.direction === "down" ? "trend-down" : "text-muted-foreground"
          )}>
            {trend.direction === "up" && <TrendingUp className="h-3 w-3" />}
            {trend.direction === "down" && <TrendingDown className="h-3 w-3" />}
            <span>{trend.value}</span>
            {trend.label && <span className="text-muted-foreground font-normal">{trend.label}</span>}
          </div>
        )}
        {attention && (
          <p className="text-xs text-destructive font-medium mt-1">{attentionLabel ?? "Need attention"}</p>
        )}
      </div>
    </div>
  );
}
