import { IcsUrlProvider, testIcsFeedUrl, normalizeIcsUrl } from "./icsUrlProvider";

const MOCK_FEED =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:uid-1\r\nSUMMARY:Lecture\r\nDTSTART:20250620T090000Z\r\nDTEND:20250620T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:uid-2\r\nSUMMARY:Exam\r\nDTSTART:20250701T090000Z\r\nDTEND:20250701T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

const mockFetch = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn().mockResolvedValue({
    id: "acc-1",
    ics_url: "https://example.edu/calendar/feed.ics",
    display_name: "University Schedule",
  }),
}));

describe("normalizeIcsUrl", () => {
  it("rewrites webcal:// to https://", () => {
    expect(normalizeIcsUrl("webcal://example.com/feed.ics")).toBe("https://example.com/feed.ics");
  });

  it("leaves https:// URLs untouched", () => {
    expect(normalizeIcsUrl("https://example.com/feed.ics")).toBe("https://example.com/feed.ics");
  });
});

describe("IcsUrlProvider", () => {
  let provider: IcsUrlProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new IcsUrlProvider("acc-1");
  });

  describe("listCalendars", () => {
    it("returns a single primary calendar named after the account", async () => {
      const calendars = await provider.listCalendars();
      expect(calendars).toEqual([
        { remoteId: "primary", displayName: "University Schedule", color: null, isPrimary: true },
      ]);
    });
  });

  describe("fetchEvents", () => {
    it("fetches and parses events from the feed, filtered to the time range", async () => {
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(MOCK_FEED) });

      const events = await provider.fetchEvents("primary", "2025-06-01T00:00:00Z", "2025-06-30T23:59:59Z");

      expect(mockFetch).toHaveBeenCalledWith("https://example.edu/calendar/feed.ics");
      expect(events).toHaveLength(1);
      expect(events[0]!.uid).toBe("uid-1");
    });

    it("throws with the HTTP status when the feed request fails", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(
        provider.fetchEvents("primary", "2025-06-01T00:00:00Z", "2025-06-30T23:59:59Z"),
      ).rejects.toThrow("404");
    });
  });

  describe("write operations", () => {
    it("createEvent rejects because the calendar is read-only", async () => {
      await expect(
        provider.createEvent("primary", { summary: "x", startTime: "2025-01-01T00:00:00Z", endTime: "2025-01-01T01:00:00Z" }),
      ).rejects.toThrow("read-only");
    });

    it("updateEvent rejects because the calendar is read-only", async () => {
      await expect(provider.updateEvent("primary", "uid-1", {})).rejects.toThrow("read-only");
    });

    it("deleteEvent rejects because the calendar is read-only", async () => {
      await expect(provider.deleteEvent("primary", "uid-1")).rejects.toThrow("read-only");
    });
  });

  describe("testConnection", () => {
    it("reports success with the event count", async () => {
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(MOCK_FEED) });

      const result = await provider.testConnection();

      expect(result).toEqual({ success: true, message: "Connected — found 2 events" });
    });

    it("reports failure when the fetch fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await provider.testConnection();

      expect(result).toEqual({ success: false, message: "Network error" });
    });
  });
});

describe("testIcsFeedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes webcal:// before fetching and reports the event count", async () => {
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(MOCK_FEED) });

    const result = await testIcsFeedUrl("webcal://example.edu/feed.ics");

    expect(mockFetch).toHaveBeenCalledWith("https://example.edu/feed.ics");
    expect(result).toEqual({
      success: true,
      message: "Connected — found 2 events",
      eventCount: 2,
    });
  });

  it("reports the response status on a non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const result = await testIcsFeedUrl("https://example.edu/feed.ics");

    expect(result).toEqual({ success: false, message: "Server responded with 403" });
  });
});
