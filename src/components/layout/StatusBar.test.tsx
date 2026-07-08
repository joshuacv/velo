import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useUIStore } from "@/stores/uiStore";

describe("StatusBar", () => {
  beforeEach(() => {
    useUIStore.setState({ isOnline: true });
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
    expect(screen.getByText("Offline — changes will sync when you reconnect")).toBeInTheDocument();
    expect(screen.queryByText("Syncing: 12/340 messages")).not.toBeInTheDocument();
  });

  it("treats 'Sync complete' as idle, not actively syncing", () => {
    const { container } = render(<StatusBar syncStatus="Sync complete" />);
    expect(screen.getByText("Sync complete")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });
});
