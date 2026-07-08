import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  CalendarProvider,
  CalendarProviderType,
  CalendarInfo,
  CalendarEventData,
  CalendarSyncResult,
  CreateEventInput,
  UpdateEventInput,
} from "./types";
import { parseICSFeed } from "./icalHelper";
import { getAccount } from "@/services/db/accounts";

const CALENDAR_REMOTE_ID = "primary";
const READ_ONLY_MESSAGE = "This calendar is read-only (subscribed by URL) — events can't be created, edited, or deleted.";

/** `webcal://` is a common scheme hint for calendar feeds but isn't directly fetchable. */
export function normalizeIcsUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, "https://");
}

/** Test a feed URL before an account exists for it (used by the "Add Calendar" wizard). */
export async function testIcsFeedUrl(
  rawUrl: string,
): Promise<{ success: boolean; message: string; eventCount?: number }> {
  const url = normalizeIcsUrl(rawUrl);
  try {
    const response = await tauriFetch(url);
    if (!response.ok) {
      return { success: false, message: `Server responded with ${response.status}` };
    }
    const text = await response.text();
    const events = parseICSFeed(text);
    return {
      success: true,
      message: `Connected — found ${events.length} event${events.length !== 1 ? "s" : ""}`,
      eventCount: events.length,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}

/**
 * Read-only calendar backed by a plain .ics/webcal feed URL — no login, no
 * write access. Used for subscriptions like a university's public class
 * schedule, or a service's "secret address in iCal format" export.
 */
export class IcsUrlProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "ics_url";

  constructor(readonly accountId: string) {}

  private async getFeed(): Promise<{ url: string; displayName: string }> {
    const account = await getAccount(this.accountId);
    if (!account?.ics_url) throw new Error("Calendar subscription URL not configured");
    return { url: normalizeIcsUrl(account.ics_url), displayName: account.display_name ?? "Subscribed Calendar" };
  }

  private async fetchAllEvents(): Promise<CalendarEventData[]> {
    const { url } = await this.getFeed();
    const response = await tauriFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar feed: ${response.status}`);
    }
    const text = await response.text();
    return parseICSFeed(text);
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const { displayName } = await this.getFeed();
    return [{ remoteId: CALENDAR_REMOTE_ID, displayName, color: null, isPrimary: true }];
  }

  async fetchEvents(_calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const minTs = Math.floor(new Date(timeMin).getTime() / 1000);
    const maxTs = Math.floor(new Date(timeMax).getTime() / 1000);
    const events = await this.fetchAllEvents();
    return events.filter((e) => e.endTime >= minTs && e.startTime <= maxTs);
  }

  async createEvent(_calendarRemoteId: string, _event: CreateEventInput): Promise<CalendarEventData> {
    throw new Error(READ_ONLY_MESSAGE);
  }

  async updateEvent(
    _calendarRemoteId: string,
    _remoteEventId: string,
    _event: UpdateEventInput,
    _etag?: string,
  ): Promise<CalendarEventData> {
    throw new Error(READ_ONLY_MESSAGE);
  }

  async deleteEvent(_calendarRemoteId: string, _remoteEventId: string, _etag?: string): Promise<void> {
    throw new Error(READ_ONLY_MESSAGE);
  }

  async syncEvents(_calendarRemoteId: string, _syncToken?: string): Promise<CalendarSyncResult> {
    const events = await this.fetchAllEvents();
    return { created: events, updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const events = await this.fetchAllEvents();
      return {
        success: true,
        message: `Connected — found ${events.length} event${events.length !== 1 ? "s" : ""}`,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}
