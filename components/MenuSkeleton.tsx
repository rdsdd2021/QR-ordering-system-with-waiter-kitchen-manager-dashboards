export default function MenuSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading menu">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border bg-card p-4 gap-4 animate-pulse"
        >
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/5" />
            <div className="h-3 bg-muted rounded w-1/4" />
          </div>
          <div className="h-8 w-8 bg-muted rounded-full" />
        </div>
      ))}
    </div>
  );
}
