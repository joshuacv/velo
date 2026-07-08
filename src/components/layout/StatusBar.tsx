import { RefreshCw, AlertCircle, CheckCircle2, WifiOff } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

interface StatusBarProps {
  /** Current sync status text (e.g. "Syncing: 12/340 messages"), or null when idle. */
  syncStatus: string | null;
}

/**
 * Persistent bottom status bar — occupies dedicated space in the layout
 * (not a fixed overlay), so it never covers other UI like the sidebar's
 * Settings button the way a floating toast could.
 */
export function StatusBar({ syncStatus }: StatusBarProps) {
  const isOnline = useUIStore((s) => s.isOnline);

  const isError = !isOnline ? false : !!syncStatus?.startsWith("Sync failed");
  const isSyncing = !isOnline ? false : !!syncStatus && !isError && syncStatus !== "Sync complete";

  const label = !isOnline ? "Offline — changes will sync when you reconnect" : syncStatus ?? "Up to date";

  return (
    <div
      className={`shrink-0 flex items-center gap-1.5 px-4 h-6 text-[0.6875rem] border-t border-border-primary transition-colors ${
        !isOnline
          ? "bg-warning/90 text-white"
          : isError
            ? "bg-danger/90 text-white"
            : isSyncing
              ? "bg-accent/90 text-white"
              : "bg-bg-secondary text-text-tertiary"
      }`}
    >
      {!isOnline ? (
        <WifiOff size={11} className="shrink-0" />
      ) : isSyncing ? (
        <RefreshCw size={11} className="shrink-0 animate-spin" />
      ) : isError ? (
        <AlertCircle size={11} className="shrink-0" />
      ) : (
        <CheckCircle2 size={11} className="shrink-0 opacity-60" />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}
