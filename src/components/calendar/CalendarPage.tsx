import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAccountStore, type Account } from "@/stores/accountStore";
import { getCalendarEventsInRangeMulti, upsertCalendarEvent, type DbCalendarEvent } from "@/services/db/calendarEvents";
import { getCalendarsForAccount, getAllCalendars, upsertCalendar, type DbCalendar } from "@/services/db/calendars";
import { getCalendarProvider, hasCalendarSupport } from "@/services/calendar/providerFactory";
import { createAndCacheCalendarEvent } from "@/services/calendar/calendarActions";
import type { CalendarEventData, CreateEventInput } from "@/services/calendar/types";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { EventCreateModal } from "./EventCreateModal";
import { EventDetailModal } from "./EventDetailModal";
import { CalendarList } from "./CalendarList";
import { CalendarReauthBanner } from "./CalendarReauthBanner";

export function CalendarPage() {
  const accounts = useAccountStore((s) => s.accounts);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<DbCalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<DbCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<DbCalendarEvent | null>(null);
  const [reauthAccounts, setReauthAccounts] = useState<Account[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(true);
  const [hasCalendar, setHasCalendar] = useState(true);
  // Accounts we've already prompted to re-authorize this session — avoids
  // looping the banner if Calendar API access is still denied afterward.
  const reauthAttemptedIds = useRef<Set<string>>(new Set());

  const getRange = useCallback((): { start: Date; end: Date } => {
    const d = new Date(currentDate);
    if (view === "month") {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setDate(end.getDate() + (6 - end.getDay()));
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === "week") {
      const start = new Date(d);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [currentDate, view]);

  /** Accounts that expose a calendar (Gmail, CalDAV, or an ICS subscription) — computed async since it hits the DB. */
  const getCalendarAccounts = useCallback(async (): Promise<Account[]> => {
    const flags = await Promise.all(
      accounts.map(async (a) => [a, await hasCalendarSupport(a.id)] as const),
    );
    return flags.filter(([, ok]) => ok).map(([a]) => a);
  }, [accounts]);

  const loadCalendars = useCallback(async () => {
    try {
      const calendarAccounts = await getCalendarAccounts();
      setHasCalendar(calendarAccounts.length > 0);
      if (calendarAccounts.length === 0) {
        setCalendars([]);
        return;
      }
      const accountIds = new Set(calendarAccounts.map((a) => a.id));
      const all = await getAllCalendars();
      setCalendars(all.filter((c) => accountIds.has(c.account_id)));
    } catch {
      // ignore
    }
  }, [getCalendarAccounts]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const { start, end } = getRange();
    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);

    const calendarAccounts = await getCalendarAccounts();
    if (calendarAccounts.length === 0) {
      setCalendars([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    // Load from local cache first, merged across every calendar-capable account
    try {
      const cachedCals = await getAllCalendars();
      const merged = await Promise.all(
        calendarAccounts.map((a) => {
          const visibleIds = cachedCals.filter((c) => c.account_id === a.id && c.is_visible).map((c) => c.id);
          return getCalendarEventsInRangeMulti(a.id, visibleIds, startTs, endTs);
        }),
      );
      setEvents(merged.flat());
      setCalendars(cachedCals.filter((c) => calendarAccounts.some((a) => a.id === c.account_id)));
    } catch {
      // ignore cache errors
    }

    // Sync fresh from each account's provider — one account's failure
    // (e.g. a revoked token) shouldn't block the others from loading.
    const newReauth: Account[] = [];
    let lastError: string | null = null;

    await Promise.all(
      calendarAccounts.map(async (account) => {
        try {
          const provider = await getCalendarProvider(account.id);

          const providerCalendars = await provider.listCalendars();
          for (const cal of providerCalendars) {
            await upsertCalendar({
              accountId: account.id,
              provider: provider.type,
              remoteId: cal.remoteId,
              displayName: cal.displayName,
              color: cal.color,
              isPrimary: cal.isPrimary,
            });
          }

          const accountCals = await getCalendarsForAccount(account.id);
          const visible = accountCals.filter((c) => c.is_visible);
          for (const cal of visible) {
            const apiEvents = await provider.fetchEvents(cal.remote_id, start.toISOString(), end.toISOString());
            for (const event of apiEvents) {
              await upsertCalendarEventFromProvider(account.id, cal.id, event);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (account.provider === "gmail_api" && (message.includes("403") || message.includes("insufficient"))) {
            if (reauthAttemptedIds.current.has(account.id)) {
              reauthAttemptedIds.current.delete(account.id);
              lastError =
                `${account.displayName ?? account.email}: Calendar access is still denied after re-authorization. ` +
                "Make sure the Google Calendar API is enabled in your Google Cloud Console project. " +
                "Visit console.cloud.google.com → APIs & Services → Enable the \"Google Calendar API\".";
            } else {
              newReauth.push(account);
            }
          } else {
            console.error(`Failed to load calendar events for ${account.email}:`, err);
            lastError = `${account.displayName ?? account.email}: ${message}`;
          }
        }
      }),
    );

    // Reload calendars + events fresh from DB now that sync attempts have landed
    const freshCals = await getAllCalendars();
    const visibleFresh = calendarAccounts.map((a) =>
      freshCals.filter((c) => c.account_id === a.id && c.is_visible).map((c) => c.id),
    );
    const freshEvents = await Promise.all(
      calendarAccounts.map((a, i) => getCalendarEventsInRangeMulti(a.id, visibleFresh[i]!, startTs, endTs)),
    );

    setCalendars(freshCals.filter((c) => calendarAccounts.some((a) => a.id === c.account_id)));
    setEvents(freshEvents.flat());
    setReauthAccounts(newReauth);
    setCalendarError(lastError);
    setLoading(false);
  }, [getCalendarAccounts, getRange]);

  useEffect(() => {
    loadCalendars();
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, currentDate, view]);

  const handlePrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() - 1);
      else if (view === "week") next.setDate(next.getDate() - 7);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() + 1);
      else if (view === "week") next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Calendars belonging to read-only (ICS subscription) accounts can't be create targets.
  const writableCalendars = useMemo(
    () => calendars.filter((c) => accounts.find((a) => a.id === c.account_id)?.provider !== "ics_url"),
    [calendars, accounts],
  );

  const calendarColorById = useMemo(
    () => Object.fromEntries(calendars.map((c) => [c.id, c.color])),
    [calendars],
  );

  const handleCreateEvent = useCallback(async (eventData: {
    summary: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    calendarId?: string;
  }) => {
    try {
      // Find the target calendar
      let calendarRemoteId: string | undefined;
      let calendarDbId: string | undefined;
      let ownerAccountId: string | undefined;

      if (eventData.calendarId) {
        const cal = writableCalendars.find((c) => c.id === eventData.calendarId);
        if (cal) {
          calendarRemoteId = cal.remote_id;
          calendarDbId = cal.id;
          ownerAccountId = cal.account_id;
        }
      }

      // Fallback to a primary writable calendar
      if (!ownerAccountId) {
        const primary = writableCalendars.find((c) => c.is_primary) ?? writableCalendars[0];
        if (primary) {
          calendarRemoteId = primary.remote_id;
          calendarDbId = primary.id;
          ownerAccountId = primary.account_id;
        }
      }

      if (!ownerAccountId) {
        console.error("No writable calendar available to create the event in.");
        return;
      }

      const input: CreateEventInput = {
        summary: eventData.summary,
        description: eventData.description || undefined,
        location: eventData.location || undefined,
        startTime: eventData.startTime,
        endTime: eventData.endTime,
      };

      await createAndCacheCalendarEvent(ownerAccountId, calendarRemoteId ?? "primary", calendarDbId ?? null, input);

      setShowCreate(false);
      loadEvents();
    } catch (err) {
      console.error("Failed to create event:", err);
    }
  }, [writableCalendars, loadEvents]);

  const handleEventClick = useCallback((event: DbCalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  const handleEventUpdated = useCallback(() => {
    setSelectedEvent(null);
    loadEvents();
  }, [loadEvents]);

  if (accounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Connect an account to use Calendar
      </div>
    );
  }

  if (!hasCalendar) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        <div className="text-center">
          <p>No connected account has a calendar configured.</p>
          <p className="mt-1 text-xs">For IMAP accounts, configure CalDAV in Settings, or add a Google/CalDAV/URL calendar account.</p>
        </div>
      </div>
    );
  }

  const accountLabels: Record<string, string> = Object.fromEntries(
    accounts.map((a) => [a.id, a.displayName ?? a.email]),
  );

  const selectedEventAccount = selectedEvent
    ? accounts.find((a) => a.id === selectedEvent.account_id)
    : undefined;

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-bg-primary">
      <CalendarToolbar
        currentDate={currentDate}
        view={view}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onViewChange={setView}
        onCreateEvent={() => setShowCreate(true)}
        onToggleCalendarList={() => setShowCalendarList((v) => !v)}
        showCalendarListButton={calendars.length > 1}
        createDisabled={writableCalendars.length === 0}
        createDisabledReason="No writable calendar available — read-only subscriptions can't have events added."
      />

      {reauthAccounts.map((account) => (
        <CalendarReauthBanner
          key={account.id}
          accountId={account.id}
          email={account.email}
          onReauthSuccess={() => {
            reauthAttemptedIds.current.add(account.id);
            setReauthAccounts((prev) => prev.filter((a) => a.id !== account.id));
            setCalendarError(null);
            loadEvents();
          }}
        />
      ))}

      {calendarError && (
        <div className="mx-6 my-4 p-4 rounded-lg bg-danger/10 border border-danger/30 flex items-start gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Calendar access error</p>
            <p className="text-xs text-text-secondary mt-1">{calendarError}</p>
          </div>
        </div>
      )}

      {loading && events.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
          Loading calendar...
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {showCalendarList && calendars.length > 1 && (
          <CalendarList
            calendars={calendars}
            accountLabels={accountLabels}
            onVisibilityChange={async (calendarId, visible) => {
              const { setCalendarVisibility } = await import("@/services/db/calendars");
              await setCalendarVisibility(calendarId, visible);
              await loadCalendars();
              loadEvents();
            }}
            onColorChange={async (calendarId, color) => {
              const { updateCalendarColor } = await import("@/services/db/calendars");
              await updateCalendarColor(calendarId, color);
              await loadCalendars();
            }}
          />
        )}

        <div className="flex-1 min-w-0">
          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              events={events}
              calendarColorById={calendarColorById}
              onEventClick={handleEventClick}
            />
          )}
          {view === "week" && (
            <WeekView
              currentDate={currentDate}
              events={events}
              calendarColorById={calendarColorById}
              onEventClick={handleEventClick}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              events={events}
              calendarColorById={calendarColorById}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <EventCreateModal
          calendars={writableCalendars}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateEvent}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          calendars={calendars}
          accountId={selectedEvent.account_id}
          readOnly={selectedEventAccount?.provider === "ics_url"}
          onClose={() => setSelectedEvent(null)}
          onUpdated={handleEventUpdated}
        />
      )}
    </div>
  );
}

async function upsertCalendarEventFromProvider(
  accountId: string,
  calendarId: string | null,
  event: CalendarEventData,
): Promise<void> {
  await upsertCalendarEvent({
    accountId,
    googleEventId: event.remoteEventId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    isAllDay: event.isAllDay,
    status: event.status,
    organizerEmail: event.organizerEmail,
    attendeesJson: event.attendeesJson,
    htmlLink: event.htmlLink,
    calendarId,
    remoteEventId: event.remoteEventId,
    etag: event.etag,
    icalData: event.icalData,
    uid: event.uid,
  });
}
