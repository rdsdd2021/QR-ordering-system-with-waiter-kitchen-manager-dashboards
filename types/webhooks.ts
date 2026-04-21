/**
 * Webhook module types — mirrors the DB schema.
 */

export const WEBHOOK_EVENTS = [
  // Orders
  "order.placed",
  "order.confirmed",
  "order.preparing",
  "order.ready",
  "order.served",
  "order.billed",
  "order.cancelled",
  // Table sessions
  "table.session_opened",
  "table.session_closed",
  // Menu
  "menu.item_created",
  "menu.item_updated",
  "menu.item_deleted",
  // Staff
  "staff.created",
  "staff.deactivated",
  // Payment
  "payment.method_recorded",
  // Test
  "test",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  "order.placed":            "Order Placed",
  "order.confirmed":         "Order Confirmed",
  "order.preparing":         "Order Preparing",
  "order.ready":             "Order Ready",
  "order.served":            "Order Served",
  "order.billed":            "Order Billed",
  "order.cancelled":         "Order Cancelled",
  "table.session_opened":    "Table Session Opened",
  "table.session_closed":    "Table Session Closed",
  "menu.item_created":       "Menu Item Created",
  "menu.item_updated":       "Menu Item Updated",
  "menu.item_deleted":       "Menu Item Deleted",
  "staff.created":           "Staff Created",
  "staff.deactivated":       "Staff Deactivated",
  "payment.method_recorded": "Payment Method Recorded",
  "test":                    "Test Ping",
};

export const WEBHOOK_EVENT_GROUPS: { label: string; events: WebhookEventType[] }[] = [
  {
    label: "Orders",
    events: ["order.placed","order.confirmed","order.preparing","order.ready","order.served","order.billed","order.cancelled"],
  },
  {
    label: "Tables",
    events: ["table.session_opened","table.session_closed"],
  },
  {
    label: "Menu",
    events: ["menu.item_created","menu.item_updated","menu.item_deleted"],
  },
  {
    label: "Staff",
    events: ["staff.created","staff.deactivated"],
  },
  {
    label: "Payment",
    events: ["payment.method_recorded"],
  },
];

export type WebhookDeliveryStatus = "pending" | "retrying" | "success" | "failed" | "dead";

export type WebhookEndpoint = {
  id: string;
  restaurant_id: string;
  name: string;
  url: string;
  /** Secret is never returned after creation — only shown once */
  secret?: string;
  events: WebhookEventType[];
  is_active: boolean;
  failure_count: number;
  disabled_reason: string | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WebhookDelivery = {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: WebhookEventType;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  http_status: number | null;
  response_body: string | null;
  error_message: string | null;
  attempt: number;
  max_attempts: number;
  duration_ms: number | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

/** Shape of every outbound webhook payload */
export type WebhookPayload = {
  id: string;           // event_id — stable across retries
  event: WebhookEventType;
  restaurant_id: string;
  timestamp: string;    // ISO-8601
  data: Record<string, unknown>;
};

/** Retry schedule in seconds */
export const RETRY_DELAYS_S = [60, 300, 1800, 7200]; // 1m, 5m, 30m, 2h
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1; // 5 total
export const DISPATCH_TIMEOUT_MS = 8000;
export const MAX_PAYLOAD_BYTES = 65536; // 64 KB
