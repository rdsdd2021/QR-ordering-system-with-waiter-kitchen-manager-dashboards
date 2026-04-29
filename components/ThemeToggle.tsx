"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <button
      onClick={() => mounted && setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-md p-2 hover:bg-accent transition-colors"
      aria-label="Toggle theme"
    >
      {/* Render placeholder until mounted to avoid layout shift */}
      {!mounted
        ? <span className="h-5 w-5 block" />
        : theme === "dark"
          ? <Sun className="h-5 w-5" />
          : <Moon className="h-5 w-5" />
      }
    </button>
  );
}
