import { QrCode } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
          <QrCode className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">Table not found</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
          This QR code doesn&apos;t match any active table. Ask your server for
          a new one.
        </p>
      </div>
    </div>
  );
}
