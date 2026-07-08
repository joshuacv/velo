import { render, screen, act } from "@testing-library/react";
import { AssistantSettings } from "./AssistantSettings";
import type { AssistantStatusCallback } from "@/services/assistant/assistantManager";

let statusListener: AssistantStatusCallback | null = null;

vi.mock("@/services/assistant/assistantManager", () => ({
  getAssistantConfig: vi.fn().mockResolvedValue({
    enabled: false,
    token: null,
    allowedUserId: null,
  }),
  saveAssistantConfig: vi.fn().mockResolvedValue(undefined),
  restartAssistant: vi.fn().mockResolvedValue(undefined),
  testToken: vi.fn(),
  onAssistantStatus: vi.fn((cb: AssistantStatusCallback) => {
    statusListener = cb;
    cb("stopped", undefined);
    return () => {
      statusListener = null;
    };
  }),
}));

describe("AssistantSettings", () => {
  beforeEach(() => {
    statusListener = null;
  });

  it("shows a stopped status by default", async () => {
    render(<AssistantSettings />);
    expect(await screen.findByText(/Stopped/)).toBeInTheDocument();
  });

  it("updates to running when the assistant reports it started", async () => {
    render(<AssistantSettings />);
    await screen.findByText(/Stopped/);

    act(() => {
      statusListener?.("running", undefined);
    });

    expect(await screen.findByText("Running — listening for messages")).toBeInTheDocument();
  });

  it("shows the error detail when the assistant reports an error", async () => {
    render(<AssistantSettings />);
    await screen.findByText(/Stopped/);

    act(() => {
      statusListener?.("error", "Unauthorized");
    });

    expect(await screen.findByText("Error — Unauthorized")).toBeInTheDocument();
  });

  it("shows why it's stopped when a detail is provided", async () => {
    render(<AssistantSettings />);
    await screen.findByText(/Stopped/);

    act(() => {
      statusListener?.("stopped", "No bot token configured");
    });

    expect(await screen.findByText("Stopped — No bot token configured")).toBeInTheDocument();
  });
});
