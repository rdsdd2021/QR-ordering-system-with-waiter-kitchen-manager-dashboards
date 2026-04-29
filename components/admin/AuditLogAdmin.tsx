"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScrollText, Loader2, ChevronDown, ChevronUp, Download,
  AlertTriangle, Info, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLogAdminProps {
  pin: string;
  restaurants?: { id: string; name: string }[];
}

interface AuditEntry {
  id: string;
  restaurant_id: string | null;
  restaurant_name?: string | null;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  metadata: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
  ip_address: string | null;
  created_at: string;
}

interface ApiResponse {
  entries: AuditEntry[];
  total_count: number;
  next_cursor: string | null;
  has_more: boolean;
}

type DatePreset = "none" | "today" | "yesterday" | "last7" | "last30" | "custom";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return { from: todayStart.toISOString(), to: now.toISOString() };
    case "yesterday": {
      const yStart = new Date(todayStart);
      yStart.setDate(yStart.getDate() - 1);
      const yEnd = new Date(todayStart);
      yEnd.setMilliseconds(-1);
      return { from: yStart.toISOString(), to: yEnd.toISOString() };
    }
    case "last7": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case "last30": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    default:
      return { from: "", to: "" };
  }
}

function SeverityBadge({ severity }: { severity: AuditEntry["severity"] }) {
  if (severity === "critical") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
        <AlertTriangle className="h-3 w-3" />
        Critical
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
      <Info className="h-3 w-3" />
      Info
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AuditLogAdmin({ pin, restaurants = [] }: AuditLogAdminProps) {
  // ── Admin fetch helper ────────────────────────────────────────────────────
  // For audit-log read endpoints we call the API directly with the admin secret
  // as the Bearer token (same pattern as validateAdminRequest on the server).
  // This avoids the proxy's server-side self-fetch which fails in dev.
  async function adminFetch(endpoint: string, method: string, body?: unknown) {
    const adminSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET ?? "";
    const res = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSecret}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  // ── Filter state ──────────────────────────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset>("none");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [severity, setSeverity] = useState("");
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [q, setQ] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("");

  // ── Data state ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);

  // ── Expanded row state ────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Build query params ────────────────────────────────────────────────────
  function buildEndpoint(cursor?: string): string {
    const range = datePreset === "custom"
      ? { from: customFrom, to: customTo }
      : getPresetRange(datePreset);

    const params = new URLSearchParams();
    params.set("page_size", "50");
    if (restaurantFilter) params.set("restaurant_id", restaurantFilter);
    if (range.from) params.set("from", range.from);
    if (range.to)   params.set("to", range.to);
    if (severity)   params.set("severity", severity);
    if (actorType)  params.set("actor_type", actorType);
    if (action)     params.set("action", action);
    if (resourceType) params.set("resource_type", resourceType);
    if (q)          params.set("q", q);
    if (cursor)     params.set("cursor", cursor);
    return `/api/audit-logs?${params.toString()}`;
  }

  // ── Fetch entries via admin proxy ─────────────────────────────────────────
  const fetchEntries = useCallback(async (cursor?: string): Promise<ApiResponse | null> => {
    const endpoint = buildEndpoint(cursor);
    const res = await adminFetch(endpoint, "GET");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<ApiResponse>;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, datePreset, customFrom, customTo, severity, actorType, action, resourceType, q, restaurantFilter]);

  // ── Load first page ───────────────────────────────────────────────────────
  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const data = await fetchEntries();
      if (data) {
        setEntries(data.entries);
        setTotalCount(data.total_count);
        setNextCursor(data.next_cursor);
        setHasMore(data.has_more);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [fetchEntries]);

  // ── Load more (pagination) ────────────────────────────────────────────────
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchEntries(nextCursor);
      if (data) {
        setEntries(prev => [...prev, ...data.entries]);
        setNextCursor(data.next_cursor);
        setHasMore(data.has_more);
      }
    } catch {
      // silently ignore load-more errors
    } finally {
      setLoadingMore(false);
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  async function handleExportCsv() {
    setExportingCsv(true);
    try {
      const range = datePreset === "custom"
        ? { from: customFrom, to: customTo }
        : getPresetRange(datePreset);

      const params = new URLSearchParams();
      params.set("format", "csv");
      if (restaurantFilter) params.set("restaurant_id", restaurantFilter);
      if (range.from) params.set("from", range.from);
      if (range.to)   params.set("to", range.to);
      if (severity)   params.set("severity", severity);
      if (actorType)  params.set("actor_type", actorType);
      if (action)     params.set("action", action);
      if (resourceType) params.set("resource_type", resourceType);
      if (q)          params.set("q", q);

      const res = await adminFetch(`/api/audit-logs/download?${params.toString()}`, "GET");
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingCsv(false);
    }
  }

  // ── JSON export (admin only) ──────────────────────────────────────────────
  async function handleExportJson() {
    setExportingJson(true);
    try {
      const range = datePreset === "custom"
        ? { from: customFrom, to: customTo }
        : getPresetRange(datePreset);

      const params = new URLSearchParams();
      params.set("format", "json");
      if (restaurantFilter) params.set("restaurant_id", restaurantFilter);
      if (range.from) params.set("from", range.from);
      if (range.to)   params.set("to", range.to);
      if (severity)   params.set("severity", severity);
      if (actorType)  params.set("actor_type", actorType);
      if (action)     params.set("action", action);
      if (resourceType) params.set("resource_type", resourceType);
      if (q)          params.set("q", q);

      const res = await adminFetch(`/api/audit-logs/download?${params.toString()}`, "GET");
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingJson(false);
    }
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  // ── Date preset buttons ───────────────────────────────────────────────────
  const DATE_PRESETS: { key: DatePreset; label: string }[] = [
    { key: "none",      label: "All time"    },
    { key: "today",     label: "Today"       },
    { key: "yesterday", label: "Yesterday"   },
    { key: "last7",     label: "Last 7 days" },
    { key: "last30",    label: "Last 30 days"},
    { key: "custom",    label: "Custom"      },
  ];

  // ── Restaurant name lookup ────────────────────────────────────────────────
  const restaurantMap = Object.fromEntries(restaurants.map(r => [r.id, r.name]));

  function getRestaurantName(entry: AuditEntry): string {
    if (!entry.restaurant_id) return "—";
    return restaurantMap[entry.restaurant_id] ?? entry.restaurant_id.slice(0, 8).toUpperCase();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Audit Log</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform-wide activity across all restaurants
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCsv}
            disabled={exportingCsv}
          >
            {exportingCsv
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1.5" />
            }
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportJson}
            disabled={exportingJson}
          >
            {exportingJson
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1.5" />
            }
            Export JSON
          </Button>
        </div>
      </div>

      {/* Date range selector */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Date range</p>
        <div className="flex flex-wrap gap-1.5">
          {DATE_PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDatePreset(key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                datePreset === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border hover:border-primary/50"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs h-8 w-48"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs h-8 w-48"
              />
            </div>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Filters</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Restaurant filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Restaurant</label>
            <select
              value={restaurantFilter}
              onChange={e => setRestaurantFilter(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All restaurants</option>
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Severity</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Actor type */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Actor type</label>
            <select
              value={actorType}
              onChange={e => setActorType(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
              <option value="system">System</option>
              <option value="customer">Customer</option>
            </select>
          </div>

          {/* Action */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Action</label>
            <Input
              value={action}
              onChange={e => setAction(e.target.value)}
              placeholder="e.g. staff.created"
              className="h-9 text-xs"
            />
          </div>

          {/* Resource type */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Resource type</label>
            <Input
              value={resourceType}
              onChange={e => setResourceType(e.target.value)}
              placeholder="e.g. staff_member"
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* Free-text search */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Search</label>
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search actor, resource, or metadata…"
            className="h-9 text-xs max-w-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={loadFirst} disabled={loading}>
            {loading
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            }
            Apply filters
          </Button>
          <button
            onClick={() => {
              setSeverity("");
              setActorType("");
              setAction("");
              setResourceType("");
              setQ("");
              setRestaurantFilter("");
              setDatePreset("none");
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Results count */}
      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {totalCount.toLocaleString()} {totalCount === 1 ? "entry" : "entries"} found
        </p>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-6 text-center space-y-2">
          <p className="text-sm text-red-700 dark:text-red-400 font-medium">Failed to load audit log</p>
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          <Button size="sm" variant="outline" onClick={loadFirst} className="mt-2">
            Retry
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border bg-muted/20 p-12 text-center space-y-2">
          <ScrollText className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No audit entries found</p>
          <p className="text-xs text-muted-foreground">
            Try adjusting your filters or date range
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          {/* Scrollable table wrapper */}
          <div className="overflow-x-auto">
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[140px_160px_160px_180px_160px_100px_28px] gap-0 px-4 py-2.5 bg-muted/30 text-xs font-medium text-muted-foreground border-b min-w-[932px]">
              <span>Time</span>
              <span>Restaurant</span>
              <span>Actor</span>
              <span>Action</span>
              <span>Resource</span>
              <span>Severity</span>
              <span />
            </div>

          <div className="divide-y min-w-[932px]">
          {entries.map(entry => (
            <div key={entry.id}>
              {/* Row */}
              <button
                className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <div className="hidden sm:grid grid-cols-[140px_160px_160px_180px_160px_100px_28px] gap-0 items-center">
                  <span className="text-xs text-muted-foreground whitespace-nowrap pr-3">
                    {fmtDate(entry.created_at)}
                  </span>
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-medium truncate">{getRestaurantName(entry)}</p>
                    {entry.restaurant_id && (
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {entry.restaurant_id.slice(0, 8).toUpperCase()}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-medium truncate">{entry.actor_name}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.actor_type}</p>
                  </div>
                  <span className="text-xs font-mono truncate pr-3">{entry.action}</span>
                  <div className="min-w-0 pr-3">
                    <p className="text-xs truncate">{entry.resource_type}</p>
                    {entry.resource_name && (
                      <p className="text-[11px] text-muted-foreground truncate">{entry.resource_name}</p>
                    )}
                  </div>
                  <div className="pr-2"><SeverityBadge severity={entry.severity} /></div>
                  <span className="text-muted-foreground flex items-center justify-center">
                    {expandedId === entry.id
                      ? <ChevronUp className="h-3.5 w-3.5" />
                      : <ChevronDown className="h-3.5 w-3.5" />
                    }
                  </span>
                </div>

                {/* Mobile layout */}
                <div className="sm:hidden space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-medium">{entry.action}</span>
                    <SeverityBadge severity={entry.severity} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{getRestaurantName(entry)}</span>
                    <span>·</span>
                    <span>{entry.actor_name}</span>
                    <span>·</span>
                    <span>{fmtDate(entry.created_at)}</span>
                  </div>
                  {entry.resource_name && (
                    <p className="text-xs text-muted-foreground">{entry.resource_name}</p>
                  )}
                </div>
              </button>

              {/* Expanded metadata */}
              {expandedId === entry.id && (
                <div className="bg-muted/20 border-t px-4 py-3 space-y-3 text-xs">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                    <span><span className="font-medium text-foreground">ID:</span> {entry.id}</span>
                    {entry.restaurant_id && (
                      <span>
                        <span className="font-medium text-foreground">Restaurant:</span>{" "}
                        {getRestaurantName(entry)} ({entry.restaurant_id})
                      </span>
                    )}
                    {entry.ip_address && (
                      <span><span className="font-medium text-foreground">IP:</span> {entry.ip_address}</span>
                    )}
                    {entry.resource_id && (
                      <span><span className="font-medium text-foreground">Resource ID:</span> {entry.resource_id}</span>
                    )}
                    {entry.actor_id && (
                      <span><span className="font-medium text-foreground">Actor ID:</span> {entry.actor_id}</span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1.5">Metadata</p>
                    <pre className="bg-muted rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed max-h-64">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
          </div>
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && !error && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : null
            }
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
