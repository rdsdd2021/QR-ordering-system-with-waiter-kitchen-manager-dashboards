"use client";

/**
 * ReviewPrompt (inline variant)
 *
 * Rendered as a compact section attached to the bottom of a served order card.
 * Stars are small, layout is tight — no separate card chrome.
 */

import { useState, useCallback, useMemo } from "react";
import { Star, Loader2, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createReview } from "@/lib/api";

type OrderItem = {
  menu_item_id: string;
  name: string;
  quantity: number;
};

type Props = {
  orderId: string;
  restaurantId: string;
  customerPhone: string | null;
  items: OrderItem[];
  onDismiss: () => void;
};

type ItemRating = {
  rating: number;
  comment: string;
  showComment: boolean;
};

type SubmitStatus = "idle" | "submitting" | "done" | "error";

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;
  return (
    <div className="flex items-center gap-0">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="p-0.5 transition-transform active:scale-90"
          aria-label={`${star} star${star !== 1 ? "s" : ""}`}
        >
          <Star
            className={cn(
              "h-4 w-4 transition-colors",
              display >= star ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}

export default function ReviewPrompt({ orderId, restaurantId, customerPhone, items, onDismiss }: Props) {
  const [ratings, setRatings] = useState<Record<string, ItemRating>>(() =>
    Object.fromEntries(items.map((item) => [item.menu_item_id, { rating: 0, comment: "", showComment: false }]))
  );
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const patchRating = useCallback((menuItemId: string, update: Partial<ItemRating>) => {
    setRatings((prev) => ({ ...prev, [menuItemId]: { ...prev[menuItemId], ...update } }));
  }, []);

  const ratedCount = useMemo(
    () => items.filter((i) => (ratings[i.menu_item_id]?.rating ?? 0) > 0).length,
    [items, ratings]
  );

  const handleSubmit = useCallback(async () => {
    const toSubmit = items.filter((i) => (ratings[i.menu_item_id]?.rating ?? 0) > 0);
    if (!toSubmit.length) return;
    setSubmitStatus("submitting");
    setErrorMsg(null);
    const results = await Promise.all(
      toSubmit.map((item) =>
        createReview({
          menuItemId: item.menu_item_id,
          orderId,
          restaurantId,
          customerPhone,
          rating: ratings[item.menu_item_id].rating,
          comment: ratings[item.menu_item_id].comment.trim() || null,
        })
      )
    );
    if (results.every((r) => r === null)) {
      setSubmitStatus("error");
      setErrorMsg("Couldn't save. Try again.");
    } else {
      setSubmitStatus("done");
    }
  }, [items, ratings, orderId, restaurantId, customerPhone]);

  // ── Done ──────────────────────────────────────────────────────────
  if (submitStatus === "done") {
    return (
      <div className="border-t border-dashed px-4 py-2.5 flex items-center justify-between gap-3 bg-green-50/50 dark:bg-green-950/20">
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Thanks for your feedback!
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const isSubmitting = submitStatus === "submitting";

  return (
    <div className="border-t border-dashed">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground">Rate your order</p>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Skip"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Item rows */}
      <div className="px-4 py-2 space-y-2">
        {items.map((item) => {
          const r = ratings[item.menu_item_id];
          if (!r) return null;
          return (
            <div key={item.menu_item_id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground/80 truncate">
                  {item.name}
                  {item.quantity > 1 && <span className="text-muted-foreground ml-1">×{item.quantity}</span>}
                </span>
                <StarRating value={r.rating} onChange={(v) => patchRating(item.menu_item_id, { rating: v })} />
              </div>
              {r.rating > 0 && !r.showComment && (
                <button
                  type="button"
                  onClick={() => patchRating(item.menu_item_id, { showComment: true })}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  + add comment
                </button>
              )}
              {r.showComment && (
                <textarea
                  value={r.comment}
                  onChange={(e) => patchRating(item.menu_item_id, { comment: e.target.value })}
                  placeholder={`Comment on ${item.name}…`}
                  maxLength={280}
                  rows={2}
                  disabled={isSubmitting}
                  className="w-full text-xs rounded border border-input bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 pb-2.5 flex items-center justify-between gap-3">
        {errorMsg
          ? <p className="text-[11px] text-destructive">{errorMsg}</p>
          : <p className="text-[11px] text-muted-foreground">
              {ratedCount === 0 ? "Tap stars to rate" : ratedCount < items.length ? `${items.length - ratedCount} unrated` : "All rated"}
            </p>
        }
        <button
          type="button"
          onClick={handleSubmit}
          disabled={ratedCount === 0 || isSubmitting}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
        >
          {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
          {isSubmitting ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
