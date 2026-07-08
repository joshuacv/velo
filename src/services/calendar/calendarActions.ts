import { getCalendarProvider } from "./providerFactory";
import { upsertCalendarEvent } from "@/services/db/calendarEvents";
import type { CreateEventInput, CalendarEventData } from "./types";

/**
 * Create an event through the account's provider, then persist it into the
 * local cache immediately (matching how synced events are stored) so it
 * shows up right away instead of waiting for the next background sync.
 * Shared by the Calendar page and the Telegram assistant's propose_event tool.
 */
export async function createAndCacheCalendarEvent(
  accountId: string,
  calendarRemoteId: string,
  calendarDbId: string | null,
  input: CreateEventInput,
): Promise<CalendarEventData> {
  const provider = await getCalendarProvider(accountId);
  const created = await provider.createEvent(calendarRemoteId, input);

  await upsertCalendarEvent({
    accountId,
    googleEventId: created.remoteEventId,
    summary: created.summary,
    description: created.description,
    location: created.location,
    startTime: created.startTime,
    endTime: created.endTime,
    isAllDay: created.isAllDay,
    status: created.status,
    organizerEmail: created.organizerEmail,
    attendeesJson: created.attendeesJson,
    htmlLink: created.htmlLink,
    calendarId: calendarDbId,
    remoteEventId: created.remoteEventId,
    etag: created.etag,
    icalData: created.icalData,
    uid: created.uid,
  });

  return created;
}
