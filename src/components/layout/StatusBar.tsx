import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle, CheckCircle2, WifiOff, CloudUpload } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

interface StatusBarProps {
  /** Current sync status text (e.g. "Syncing: 12/340 messages"), or null when idle. */
  syncStatus: string | null;
  /** Epoch ms of the last successful sync this session, or null if none yet. */
  lastSyncAt?: number | null;
}

/** Compact relative time: "just now", "3m ago", "2h ago", "4d ago". */
function formatRelative(from: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - from) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Persistent bottom status bar — occupies dedicated space in the layout
 * (not a fixed overlay), so it never covers other UI like the sidebar's
 * Settings button the way a floating toast could.
 *
 * The bar keeps a single calm background at all times; sync/online state is
 * conveyed through a coloured icon + label and a few secondary details
 * (last-updated time, unsynced changes, connection) rather than by flashing the
 * whole bar a bright colour.
 */
export function StatusBar({ syncStatus, lastSyncAt }: StatusBarProps) {
  const isOnline = useUIStore((s) => s.isOnline);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Poll the offline queue for unsynced changes and keep relative times fresh.
  // Also refresh right after a sync completes and when connectivity flips.
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setNow(Date.now());
      import("@/services/db/pendingOperations")
        .then((m) => m.getPendingOpsCount())
        .then((n) => {
          if (alive) setPending(n);
        })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 15_000);
    window.addEventListener("velo-sync-done", refresh);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("velo-sync-done", refresh);
    };
  }, [isOnline]);

  const isError = isOnline && !!syncStatus?.startsWith("Sync failed");
  const isSyncing = isOnline && !!syncStatus && !isError && syncStatus !== "Sync complete";

  const label = !isOnline
    ? "Offline — changes will sync when you reconnect"
    : syncStatus ?? "Up to date";

  // Colour only the icon + primary label, never the whole bar.
  const accentClass = !isOnline
    ? "text-warning"
    : isError
      ? "text-danger"
      : isSyncing
        ? "text-accent"
        : "text-text-secondary";

  const Icon = !isOnline ? WifiOff : isSyncing ? RefreshCw : isError ? AlertCircle : CheckCircle2;

  const showUpdated = isOnline && !isSyncing && !isError && typeof lastSyncAt === "number";

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 h-6 text-[0.6875rem] border-t border-border-primary bg-bg-secondary text-text-tertiary">
      {/* Primary sync status */}
      <div className={`flex items-center gap-1.5 min-w-0 ${accentClass}`}>
        <Icon size={11} className={`shrink-0 ${isSyncing ? "animate-spin" : ""} ${!isSyncing && !isError && isOnline ? "opacity-70" : ""}`} />
        <span className="truncate">{label}</span>
      </div>

      {/* Last updated */}
      {showUpdated && (
        <span className="shrink-0 text-text-tertiary/80" title={new Date(lastSyncAt as number).toLocaleString()}>
          · Updated {formatRelative(lastSyncAt as number, now)}
        </span>
      )}

      {/* Unsynced changes queued offline */}
      {pending > 0 && (
        <span className="flex items-center gap-1 shrink-0 text-text-secondary" title="Changes made offline, waiting to sync">
          <CloudUpload size={11} className="shrink-0" />
          {pending} unsynced
        </span>
      )}

      {/* Connection indicator, pinned right */}
      <span className="ml-auto flex items-center gap-1 shrink-0" title={isOnline ? "Connected" : "No connection"}>
        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-success" : "bg-warning"}`} />
        {isOnline ? "Online" : "Offline"}
      </span>
    </div>
  );
}
