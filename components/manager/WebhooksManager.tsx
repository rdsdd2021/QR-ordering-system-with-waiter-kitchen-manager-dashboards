"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, Trash2, RefreshCw, Send, RotateCcw, Copy, Check,
  ChevronDown, ChevronUp, Loader2, Zap, AlertTriangle,
  CheckCircle2, XCircle, Eye, EyeOff, Webhook,
  ShieldCheck, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint,
  testEndpoint, rotateSecret, listDeliveries, retryDeliveryClient,
} from "@/lib/webhooks-client";
import {
  WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_GROUPS,
  type WebhookEndpoint, type WebhookDelivery, type WebhookEventType,
} from "@/types/webhooks";

type Props = { restaurantId: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: WebhookDelivery["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    success:  { label: "Success",  cls: "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-400" },
    failed:   { label: "Failed",   cls: "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-400" },
    dead:     { label: "Dead",     cls: "bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400" },
    retrying: { label: "Retrying", cls: "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400" },
    pending:  { label: "Pending",  cls: "bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400" };
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium", s.cls)}>{s.label}</span>;
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ── Event selector ────────────────────────────────────────────────────────────

function EventSelector({
  selected, onChange,
}: { selected: WebhookEventType[]; onChange: (v: WebhookEventType[]) => void }) {
  function toggle(e: WebhookEventType) {
    onChange(selected.includes(e) ? selected.filter(x => x !== e) : [...selected, e]);
  }
  function toggleGroup(events: WebhookEventType[]) {
    const allOn = events.every(e => selected.includes(e));
    if (allOn) onChange(selected.filter(e => !events.includes(e)));
    else onChange([...new Set([...selected, ...events])]);
  }
  return (
    <div className="space-y-3">
      {WEBHOOK_EVENT_GROUPS.map(group => (
        <div key={group.label}>
          <div className="flex items-center gap-2 mb-1.5">
            <button
              type="button"
              onClick={() => toggleGroup(group.events)}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wide"
            >
              {group.label}
            </button>
            {group.events.every(e => selected.includes(e)) && (
              <span className="text-[10px] text-green-600 font-medium">All selected</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.events.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => toggle(e)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  selected.includes(e)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                )}
              >
                {WEBHOOK_EVENT_LABELS[e]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Endpoint Form (create / edit) ─────────────────────────────────────────────

type FormState = { name: string; url: string; events: WebhookEventType[] };

function EndpointForm({
  initial, onSave, onCancel, saving,
}: {
  initial?: Partial<FormState>;
  onSave: (v: FormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name,   setName]   = useState(initial?.name   ?? "");
  const [url,    setUrl]    = useState(initial?.url    ?? "");
  const [events, setEvents] = useState<WebhookEventType[]>(initial?.events ?? []);
  const [urlErr, setUrlErr] = useState("");

  function validateUrl(v: string) {
    if (!v) { setUrlErr(""); return; }
    if (!v.startsWith("https://")) { setUrlErr("URL must start with https://"); return; }
    try {
      const parsed = new URL(v);
      const host = parsed.hostname.toLowerCase();
      const blocked = [/^localhost$/, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\.0\.0\.0$/];
      if (!host || !host.includes(".") || blocked.some(r => r.test(host))) {
        setUrlErr("Please enter a valid public HTTPS URL"); return;
      }
    } catch { setUrlErr("Invalid URL"); return; }
    setUrlErr("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || events.length === 0) return;
    onSave({ name: name.trim(), url: url.trim(), events });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <Input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Slack Notifications" required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
          <Input
            value={url}
            onChange={e => { setUrl(e.target.value); validateUrl(e.target.value); }}
            placeholder="https://your-app.com/webhook"
            required type="url"
          />
          {urlErr && <p className="text-xs text-red-500">{urlErr}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Events to subscribe ({events.length} selected)
        </label>
        <div className="rounded-lg border p-3 bg-muted/20">
          <EventSelector selected={events} onChange={setEvents} />
        </div>
        {events.length === 0 && (
          <p className="text-xs text-red-500">Select at least one event</p>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !name || !url || events.length === 0 || !!urlErr}>
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          {initial?.name ? "Save changes" : "Create endpoint"}
        </Button>
      </div>
    </form>
  );
}

// ── Secret reveal modal ───────────────────────────────────────────────────────

function SecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-xl border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-green-600" />
          <h3 className="font-semibold text-base">Signing Secret</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Copy this secret now — it will <strong>never be shown again</strong>. Use it to verify
          the <code className="text-xs bg-muted px-1 py-0.5 rounded">X-Webhook-Signature</code> header on incoming requests.
        </p>
        <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs break-all relative">
          {visible ? secret : "•".repeat(secret.length)}
          <button
            onClick={() => setVisible(v => !v)}
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <CopyButton value={secret} label="Copy secret" />
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Verify signatures (Node.js)</p>
          <pre className="overflow-x-auto whitespace-pre-wrap">{`const crypto = require('crypto');
const sig = req.headers['x-webhook-signature'];
const ts  = req.headers['x-webhook-timestamp'];
const expected = 'sha256=' + crypto
  .createHmac('sha256', SECRET)
  .update(ts + '.' + rawBody)
  .digest('hex');
const ok = crypto.timingSafeEqual(
  Buffer.from(sig), Buffer.from(expected));`}</pre>
        </div>
      </div>
    </div>
  );
}

// ── Delivery Log panel ────────────────────────────────────────────────────────

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [retrying,   setRetrying]   = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDeliveries(endpointId, { status: statusFilter || undefined, limit: 50 });
      setDeliveries(res.deliveries);
      setTotal(res.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [endpointId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleRetry(d: WebhookDelivery) {
    setRetrying(d.id);
    try {
      await retryDeliveryClient(endpointId, d.id);
      await load();
    } catch { /* ignore */ }
    setRetrying(null);
  }

  const FILTERS = ["", "success", "failed", "retrying", "dead"];

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
              statusFilter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground border-border hover:border-primary/50"
            )}
          >
            {f === "" ? `All (${total})` : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No deliveries yet</p>
      ) : (
        <div className="rounded-xl border divide-y overflow-hidden">
          {deliveries.map(d => (
            <div key={d.id}>
              <button
                className="w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusBadge status={d.status} />
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {WEBHOOK_EVENT_LABELS[d.event_type] ?? d.event_type}
                    </span>
                    {d.http_status && (
                      <span className={cn(
                        "text-xs font-mono shrink-0",
                        d.http_status < 300 ? "text-green-600" : "text-red-500"
                      )}>
                        {d.http_status}
                      </span>
                    )}
                    {d.duration_ms != null && (
                      <span className="text-xs text-muted-foreground shrink-0">{d.duration_ms}ms</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{fmtDate(d.created_at)}</span>
                    {(d.status === "failed" || d.status === "dead") && d.attempt < d.max_attempts && (
                      <button
                        onClick={e => { e.stopPropagation(); handleRetry(d); }}
                        disabled={retrying === d.id}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {retrying === d.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <RotateCcw className="h-3 w-3" />
                        }
                        Retry
                      </button>
                    )}
                    {expanded === d.id
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </div>
                </div>
                {d.error_message && (
                  <p className="text-xs text-red-500 mt-1 truncate">{d.error_message}</p>
                )}
              </button>

              {expanded === d.id && (
                <div className="bg-muted/20 border-t px-4 py-3 space-y-2 text-xs">
                  <div className="flex gap-4 flex-wrap text-muted-foreground">
                    <span>Attempt {d.attempt}/{d.max_attempts}</span>
                    {d.delivered_at && <span>Delivered {fmtDate(d.delivered_at)}</span>}
                    {d.next_retry_at && <span>Next retry {fmtDate(d.next_retry_at)}</span>}
                    <span className="font-mono">ID: {d.event_id.slice(0, 8)}</span>
                  </div>
                  {d.response_body && (
                    <div>
                      <p className="font-medium text-foreground mb-1">Response</p>
                      <pre className="bg-muted rounded p-2 overflow-x-auto text-[11px] max-h-32">{d.response_body}</pre>
                    </div>
                  )}
                  {d.error_message && (
                    <div>
                      <p className="font-medium text-red-600 mb-1">Error</p>
                      <pre className="bg-red-50 text-red-700 rounded p-2 text-[11px]">{d.error_message}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Endpoint Card ─────────────────────────────────────────────────────────────

function EndpointCard({
  ep, onUpdated, onDeleted,
}: {
  ep: WebhookEndpoint;
  onUpdated: (ep: WebhookEndpoint) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [testing,     setTesting]     = useState(false);
  const [rotating,    setRotating]    = useState(false);
  const [testResult,  setTestResult]  = useState<{ success: boolean; httpStatus: number | null; durationMs: number; errorMessage: string | null } | null>(null);
  const [newSecret,   setNewSecret]   = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"details" | "logs">("details");

  async function handleSave(form: { name: string; url: string; events: WebhookEventType[] }) {
    setSaving(true);
    try {
      const updated = await updateEndpoint(ep.id, form);
      onUpdated(updated);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleToggleActive() {
    try {
      const updated = await updateEndpoint(ep.id, { is_active: !ep.is_active });
      onUpdated(updated);
    } catch { /* ignore */ }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${ep.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteEndpoint(ep.id);
      onDeleted(ep.id);
    } catch { /* ignore */ }
    setDeleting(false);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testEndpoint(ep.id);
      setTestResult(res);
    } catch { /* ignore */ }
    setTesting(false);
  }

  async function handleRotate() {
    if (!confirm("Rotate the signing secret? Your existing integrations will break until updated.")) return;
    setRotating(true);
    try {
      const res = await rotateSecret(ep.id);
      setNewSecret(res.secret);
    } catch { /* ignore */ }
    setRotating(false);
  }

  const healthColor = ep.failure_count === 0
    ? "bg-green-500"
    : ep.failure_count < 5
    ? "bg-amber-400"
    : "bg-red-500";

  return (
    <>
      {newSecret && <SecretModal secret={newSecret} onClose={() => setNewSecret(null)} />}

      <div className={cn("rounded-xl border bg-card shadow-sm overflow-hidden", !ep.is_active && "opacity-60")}>
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-start gap-3 min-w-0">
            <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", healthColor)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{ep.name}</span>
                {!ep.is_active && (
                  <Badge variant="secondary" className="text-xs">Disabled</Badge>
                )}
                {ep.disabled_reason && (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle className="h-3 w-3" />
                    Auto-disabled
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[240px]">{ep.url}</span>
                <a href={ep.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                  <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {ep.events.length} event{ep.events.length !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  Last fired: {fmtDate(ep.last_triggered_at)}
                </span>
                {ep.failure_count > 0 && (
                  <span className="text-xs text-red-500">{ep.failure_count} failure{ep.failure_count !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Expanded panel */}
        {expanded && (
          <div className="border-t">
            {/* Auto-disable warning */}
            {ep.disabled_reason && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{ep.disabled_reason}. Fix your endpoint and re-enable.</span>
              </div>
            )}

            {/* Panel tabs */}
            <div className="flex border-b">
              {(["details", "logs"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setActivePanel(p)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors",
                    activePanel === p
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p === "details" ? "Details" : "Delivery Log"}
                </button>
              ))}
            </div>

            <div className="p-4">
              {activePanel === "details" && !editing && (
                <div className="space-y-4">
                  {/* Subscribed events */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Subscribed events</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ep.events.map(e => (
                        <span key={e} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {WEBHOOK_EVENT_LABELS[e] ?? e}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Test result */}
                  {testResult && (
                    <div className={cn(
                      "rounded-lg border p-3 text-sm flex items-start gap-2",
                      testResult.success ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
                    )}>
                      {testResult.success
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                        : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      }
                      <div>
                        <p className="font-medium">
                          {testResult.success ? "Test delivered successfully" : "Test delivery failed"}
                        </p>
                        <p className="text-xs mt-0.5">
                          {testResult.httpStatus ? `HTTP ${testResult.httpStatus} · ` : ""}
                          {testResult.durationMs}ms
                          {testResult.errorMessage ? ` · ${testResult.errorMessage}` : ""}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                      {testing
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5 mr-1.5" />
                      }
                      Send test
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleToggleActive}>
                      {ep.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleRotate} disabled={rotating}>
                      {rotating
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      }
                      Rotate secret
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 ml-auto"
                      onClick={handleDelete} disabled={deleting}
                    >
                      {deleting
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      }
                      Delete
                    </Button>
                  </div>
                </div>
              )}

              {activePanel === "details" && editing && (
                <EndpointForm
                  initial={{ name: ep.name, url: ep.url, events: ep.events }}
                  onSave={handleSave}
                  onCancel={() => setEditing(false)}
                  saving={saving}
                />
              )}

              {activePanel === "logs" && <DeliveryLog endpointId={ep.id} />}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WebhooksManager({ restaurantId }: Props) {
  const [endpoints,  setEndpoints]  = useState<WebhookEndpoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [newSecret,  setNewSecret]  = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const eps = await listEndpoints();
      setEndpoints(eps);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [restaurantId]);

  async function handleCreate(form: { name: string; url: string; events: WebhookEventType[] }) {
    setSaving(true);
    try {
      const res = await createEndpoint(form);
      setEndpoints(prev => [res.endpoint, ...prev]);
      setNewSecret(res.secret);
      setCreating(false);
    } catch { /* ignore */ }
    setSaving(false);
  }

  function handleUpdated(updated: WebhookEndpoint) {
    setEndpoints(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  function handleDeleted(id: string) {
    setEndpoints(prev => prev.filter(e => e.id !== id));
  }

  return (
    <>
      {newSecret && <SecretModal secret={newSecret} onClose={() => setNewSecret(null)} />}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Webhooks</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Connect your restaurant to external apps. We'll POST a signed JSON payload to your URL when events occur.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)} disabled={creating}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add endpoint
          </Button>
        </div>

        {/* Stats bar */}
        {endpoints.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total endpoints", value: endpoints.length },
              { label: "Active",          value: endpoints.filter(e => e.is_active).length },
              { label: "Disabled",        value: endpoints.filter(e => !e.is_active).length },
            ].map(s => (
              <div key={s.label} className="rounded-lg border bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-xl font-bold tabular-nums">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {creating && (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4" /> New endpoint
            </h3>
            <EndpointForm
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
              saving={saving}
            />
          </div>
        )}

        {/* Endpoint list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : endpoints.length === 0 && !creating ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 gap-3 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-sm">No webhook endpoints yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add an endpoint to start receiving real-time events from your restaurant.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add your first endpoint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map(ep => (
              <EndpointCard
                key={ep.id}
                ep={ep}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}

        {/* Docs footer */}
        <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground text-sm">Integration notes</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>All payloads are signed with HMAC-SHA256. Verify the <code className="bg-muted px-1 rounded">X-Webhook-Signature</code> header.</li>
            <li>Respond with HTTP 2xx within 8 seconds. Slower responses are treated as failures.</li>
            <li>Failed deliveries are retried up to 5 times: 1m → 5m → 30m → 2h.</li>
            <li>Endpoints are auto-disabled after 10 consecutive failures.</li>
            <li>Each event includes a stable <code className="bg-muted px-1 rounded">id</code> field — use it to deduplicate retries.</li>
            <li>Only HTTPS endpoints are accepted.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
