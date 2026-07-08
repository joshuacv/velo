import { buildTools, type StagedEvent } from "./tools";
import { getAllAccounts, getAccount } from "@/services/db/accounts";
import { getCalendarsForAccount, getCalendarById } from "@/services/db/calendars";
import { getCalendarEventsInRangeMulti } from "@/services/db/calendarEvents";
import { hasCalendarSupport } from "@/services/calendar/providerFactory";

vi.mock("@/services/db/accounts", () => ({
  getAllAccounts: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("@/services/db/calendars", () => ({
  getCalendarsForAccount: vi.fn(),
  getCalendarById: vi.fn(),
}));

vi.mock("@/services/db/calendarEvents", () => ({
  getCalendarEventsInRangeMulti: vi.fn(),
}));

vi.mock("@/services/calendar/providerFactory", () => ({
  hasCalendarSupport: vi.fn(),
}));

vi.mock("@/services/db/threads", () => ({ getThreadsForAccount: vi.fn() }));
vi.mock("@/services/db/messages", () => ({ getMessagesForThread: vi.fn() }));
vi.mock("@/utils/emailBuilder", () => ({ buildRawEmail: vi.fn() }));

const GOOGLE_ACCOUNT = {
  id: "acc-google",
  email: "me@gmail.com",
  display_name: "Me",
  provider: "gmail_api",
};

const ICS_ACCOUNT = {
  id: "acc-ics",
  email: "ics-acc-ics@velo.local",
  display_name: "University Schedule",
  provider: "ics_url",
};

function findTool(name: string) {
  const tool = buildTools({}).find((t) => t.def.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe("list_calendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ref, account, and readOnly flag per calendar", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([GOOGLE_ACCOUNT, ICS_ACCOUNT] as never);
    vi.mocked(hasCalendarSupport).mockResolvedValue(true);
    vi.mocked(getCalendarsForAccount).mockImplementation(async (accountId: string) => {
      if (accountId === "acc-google") {
        return [{ id: "cal-1", account_id: "acc-google", display_name: "Work", is_primary: 1 } as never];
      }
      return [{ id: "cal-2", account_id: "acc-ics", display_name: "Uni Feed", is_primary: 1 } as never];
    });

    const result = await findTool("list_calendars").run({});
    const parsed = JSON.parse(result);

    expect(parsed).toEqual([
      { ref: "acc-google::cal-1", account: "Me", name: "Work", primary: true, readOnly: false },
      { ref: "acc-ics::cal-2", account: "University Schedule", name: "Uni Feed", primary: true, readOnly: true },
    ]);
  });

  it("returns a message when no calendar accounts are connected", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([]);
    const result = await findTool("list_calendars").run({});
    expect(result).toBe("No calendar accounts connected.");
  });
});

describe("list_calendar_events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to today through 7 days out and maps events with calendar/account names", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([GOOGLE_ACCOUNT] as never);
    vi.mocked(hasCalendarSupport).mockResolvedValue(true);
    vi.mocked(getCalendarsForAccount).mockResolvedValue([
      { id: "cal-1", account_id: "acc-google", display_name: "Work", is_visible: 1 } as never,
    ]);
    vi.mocked(getCalendarEventsInRangeMulti).mockResolvedValue([
      {
        id: "ev-1",
        calendar_id: "cal-1",
        summary: "Team Sync",
        start_time: 1750000000,
        end_time: 1750003600,
        is_all_day: 0,
        location: "Room 1",
      } as never,
    ]);

    const result = await findTool("list_calendar_events").run({});
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      summary: "Team Sync",
      allDay: false,
      location: "Room 1",
      calendar: "Work",
      account: "Me",
    });
  });

  it("rejects an invalid start date", async () => {
    const result = await findTool("list_calendar_events").run({ start: "not-a-date" });
    expect(result).toBe("Invalid start date.");
  });

  it("reports no events found for an empty range", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([GOOGLE_ACCOUNT] as never);
    vi.mocked(hasCalendarSupport).mockResolvedValue(true);
    vi.mocked(getCalendarsForAccount).mockResolvedValue([]);
    vi.mocked(getCalendarEventsInRangeMulti).mockResolvedValue([]);

    const result = await findTool("list_calendar_events").run({});
    expect(result).toBe("No events found in that range.");
  });
});

describe("propose_event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the context has no stageEvent handler", async () => {
    const tool = buildTools({}).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({
      summary: "Lunch",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });
    expect(result).toBe("Adding events isn't available in this context.");
  });

  it("requires a title", async () => {
    let staged: StagedEvent | undefined;
    const tool = buildTools({ stageEvent: (e) => { staged = e; } }).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({
      summary: "  ",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });
    expect(result).toBe("Event needs a title.");
    expect(staged).toBeUndefined();
  });

  it("rejects invalid start/end times", async () => {
    const tool = buildTools({ stageEvent: () => {} }).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({ summary: "Lunch", startTime: "nope", endTime: "2026-07-08T13:00:00Z" });
    expect(result).toBe("Invalid startTime/endTime — use ISO 8601 format.");
  });

  it("resolves an explicit calendar ref and stages the event", async () => {
    vi.mocked(getCalendarById).mockResolvedValue({
      id: "cal-1",
      account_id: "acc-google",
      remote_id: "remote-cal-1",
    } as never);
    vi.mocked(getAccount).mockResolvedValue(GOOGLE_ACCOUNT as never);

    let staged: StagedEvent | undefined;
    const tool = buildTools({ stageEvent: (e) => { staged = e; } }).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({
      ref: "acc-google::cal-1",
      summary: "Lunch",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });

    expect(result).toContain("Event drafted");
    expect(staged).toEqual({
      accountId: "acc-google",
      calendarDbId: "cal-1",
      calendarRemoteId: "remote-cal-1",
      summary: "Lunch",
      description: undefined,
      location: undefined,
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
      isAllDay: false,
    });
  });

  it("rejects a ref pointing at a read-only ICS calendar", async () => {
    vi.mocked(getCalendarById).mockResolvedValue({
      id: "cal-2",
      account_id: "acc-ics",
      remote_id: "primary",
    } as never);
    vi.mocked(getAccount).mockResolvedValue(ICS_ACCOUNT as never);

    const tool = buildTools({ stageEvent: () => {} }).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({
      ref: "acc-ics::cal-2",
      summary: "Lunch",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });

    expect(result).toBe("That calendar is read-only (a URL subscription) — pick a different one.");
  });

  it("falls back to the first writable account's primary calendar when no ref is given", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([ICS_ACCOUNT, GOOGLE_ACCOUNT] as never);
    vi.mocked(hasCalendarSupport).mockResolvedValue(true);
    vi.mocked(getCalendarsForAccount).mockImplementation(async (accountId: string) => {
      if (accountId === "acc-google") {
        return [{ id: "cal-1", account_id: "acc-google", remote_id: "remote-cal-1", is_primary: 1 } as never];
      }
      return [{ id: "cal-2", account_id: "acc-ics", remote_id: "primary", is_primary: 1 } as never];
    });

    let staged: StagedEvent | undefined;
    const tool = buildTools({ stageEvent: (e) => { staged = e; } }).find((t) => t.def.name === "propose_event")!;
    await tool.run({
      summary: "Lunch",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });

    // The ICS (read-only) account is skipped even though it was listed first.
    expect(staged?.accountId).toBe("acc-google");
    expect(staged?.calendarDbId).toBe("cal-1");
  });

  it("reports when no writable calendar is available", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([ICS_ACCOUNT] as never);
    vi.mocked(hasCalendarSupport).mockResolvedValue(true);

    const tool = buildTools({ stageEvent: () => {} }).find((t) => t.def.name === "propose_event")!;
    const result = await tool.run({
      summary: "Lunch",
      startTime: "2026-07-08T12:00:00Z",
      endTime: "2026-07-08T13:00:00Z",
    });

    expect(result).toBe("No writable calendar available to add this event to.");
  });
});
