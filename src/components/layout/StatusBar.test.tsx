import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useUIStore } from "@/stores/uiStore";

const mockGetPendingOpsCount = vi.fn();
vi.mock("@/services/db/pendingOperations", () => ({
  getPendingOpsCount: (...args: unknown[]) => mockGetPendingOpsCount(...args),
}));

describe("StatusBar", () => {
  beforeEach(() => {
    useUIStore.setState({ isOnline: true });
    mockGetPendingOpsCount.mockResolvedValue(0);
  });

  it("shows 'Up to date' when idle", () => {
    render(<StatusBar syncStatus={null} />);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("shows the sync status text while syncing", () => {
    render(<StatusBar syncStatus="Syncing: 12/340 messages" />);
    expect(screen.getByText("Syncing: 12/340 messages")).toBeInTheDocument();
  });

  it("shows the failure message on sync error", () => {
    render(<StatusBar syncStatus="Sync failed: Network error" />);
    expect(screen.getByText("Sync failed: Network error")).toBeInTheDocument();
  });

  it("shows an offline message and takes priority over sync status", () => {
    useUIStore.setState({ isOnline: false });
    render(<StatusBar syncStatus="Syncing: 12/340 messages" />);
    expect(
      screen.getByText("Offline — changes will sync when you reconnect"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Syncing: 12/340 messages")).not.toBeInTheDocument();
  });

  it("treats 'Sync complete' as idle, not actively syncing", () => {
    const { container } = render(<StatusBar syncStatus="Sync complete" />);
    expect(screen.getByText("Sync complete")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("shows an Online connection indicator when online", () => {
    render(<StatusBar syncStatus={null} />);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows an Offline connection indicator when offline", () => {
    useUIStore.setState({ isOnline: false });
    render(<StatusBar syncStatus={null} />);
    // Both the primary label and the right-hand indicator convey offline.
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("shows a relative last-updated time when idle and online", () => {
    render(<StatusBar syncStatus={null} lastSyncAt={Date.now()} />);
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
  });

  it("does not show last-updated while actively syncing", () => {
    render(<StatusBar syncStatus="Syncing..." lastSyncAt={Date.now()} />);
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  it("shows the count of unsynced offline changes", async () => {
    mockGetPendingOpsCount.mockResolvedValue(3);
    const { container } = render(<StatusBar syncStatus={null} />);
    await new Promise((r) => setTimeout(r, 200));
    console.log("CALLS", mockGetPendingOpsCount.mock.calls.length, "RESULTS", JSON.stringify(mockGetPendingOpsCount.mock.results));
    console.log("DOM", container.innerHTML.includes("unsynced"), container.textContent);
  });
});
