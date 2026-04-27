import { cn } from "@/lib/utils";

type StatusVariant =
  | "preparing" | "ready" | "served" | "cancelled"
  | "active" | "inactive"
  | "occupied" | "available" | "reserved"
  | "in-stock" | "low-stock" | "out-of-stock"
  | "pro" | "free" | "trialing";

interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  dot?: boolean;
  className?: string;
}

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  preparing:     { cls: "status-preparing",   label: "Preparing"     },
  ready:         { cls: "status-ready",        label: "Ready"         },
  served:        { cls: "status-served",       label: "Served"        },
  cancelled:     { cls: "status-cancelled",    label: "Cancelled"     },
  active:        { cls: "status-active",       label: "Active"        },
  inactive:      { cls: "status-inactive",     label: "Inactive"      },
  occupied:      { cls: "status-occupied",     label: "Occupied"      },
  available:     { cls: "status-available",    label: "Available"     },
  reserved:      { cls: "status-reserved",     label: "Reserved"      },
  "in-stock":    { cls: "status-in-stock",     label: "In Stock"      },
  "low-stock":   { cls: "status-low-stock",    label: "Low Stock"     },
  "out-of-stock":{ cls: "status-out-of-stock", label: "Out of Stock"  },
  pro:           { cls: "plan-badge-pro",      label: "Pro Plan"      },
  free:          { cls: "plan-badge-free",     label: "Expired"       },
  trialing:      { cls: "plan-badge-pro",      label: "Trial"         },
};

export function StatusBadge({ status, label, dot = false, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? { cls: "status-inactive", label: status };
  const displayLabel = label ?? config.label;

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
      config.cls,
      className
    )}>
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      )}
      {displayLabel}
    </span>
  );
}
