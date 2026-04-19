"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat, UserCheck, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  restaurantId: string;
};

export default function DashboardNav({ restaurantId }: Props) {
  const pathname = usePathname();

  const navItems = [
    {
      href: `/kitchen/${restaurantId}`,
      label: "Kitchen",
      icon: ChefHat,
      active: pathname.includes("/kitchen/"),
    },
    {
      href: `/waiter/${restaurantId}`,
      label: "Waiter",
      icon: UserCheck,
      active: pathname.includes("/waiter/"),
    },
    {
      href: `/r/${restaurantId}/t/22222222-2222-2222-2222-222222222222`, // Demo table
      label: "Customer",
      icon: Home,
      active: pathname.includes("/r/") && pathname.includes("/t/"),
    },
  ];

  return (
    <nav className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      {navItems.map(({ href, label, icon: Icon, active }) => (
        <Button
          key={href}
          asChild
          variant={active ? "default" : "ghost"}
          size="sm"
          className={cn(
            "gap-1.5 text-xs",
            active && "shadow-sm"
          )}
        >
          <Link href={href}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}