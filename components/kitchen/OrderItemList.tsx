import type { KitchenOrder } from "@/types/database";

type Props = {
  items: KitchenOrder["order_items"];
};

/** Renders the list of items inside a kitchen order card. */
export default function OrderItemList({ items }: Props) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-muted-foreground">No items</p>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-foreground">{item.menu_item.name}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
            ×{item.quantity}
          </span>
        </li>
      ))}
    </ul>
  );
}
