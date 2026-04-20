import Link from "next/link";
import { QrCode } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      {/* Logo */}
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary mb-6">
        <QrCode className="h-6 w-6 text-primary-foreground" />
      </div>

      {/* 404 */}
      <p className="text-7xl font-black tracking-tight text-primary">404</p>

      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-xs">
        The page you're looking for doesn't exist or has been moved.
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/"
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Go home
        </Link>
        <Link
          href="/login"
          className="rounded-lg border px-5 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
