import type { DbCalendar } from "@/services/db/calendars";
import { toColorInputValue } from "@/utils/calendarColor";

interface CalendarListProps {
  calendars: DbCalendar[];
  /** account_id -> display label, used to group calendars when more than one account is present. */
  accountLabels?: Record<string, string>;
  onVisibilityChange: (calendarId: string, visible: boolean) => void;
  onColorChange?: (calendarId: string, color: string) => void;
}

export function CalendarList({ calendars, accountLabels, onVisibilityChange, onColorChange }: CalendarListProps) {
  const accountIds = [...new Set(calendars.map((c) => c.account_id))];
  const showGroups = accountIds.length > 1;

  return (
    <div className="w-52 border-r border-border-primary p-3 overflow-y-auto shrink-0">
      <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
        Calendars
      </h3>
      <div className="space-y-3">
        {accountIds.map((accountId) => (
          <div key={accountId}>
            {showGroups && (
              <div className="text-[0.65rem] font-medium text-text-tertiary/80 uppercase tracking-wide mb-1 px-2 truncate">
                {accountLabels?.[accountId] ?? "Calendar"}
              </div>
            )}
            <div className="space-y-1">
              {calendars.filter((cal) => cal.account_id === accountId).map((cal) => (
                <div
                  key={cal.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover transition-colors"
                >
                  <label className="flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={!!cal.is_visible}
                      onChange={(e) => onVisibilityChange(cal.id, e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`w-3 h-3 rounded-sm border-2 flex items-center justify-center transition-colors ${
                        cal.is_visible
                          ? "border-transparent"
                          : "border-border-primary bg-transparent"
                      }`}
                      style={cal.is_visible ? { backgroundColor: cal.color ?? "var(--color-accent)" } : undefined}
                    >
                      {!!cal.is_visible && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </label>
                  <span
                    className="text-sm text-text-primary truncate flex-1 cursor-pointer"
                    onClick={() => onVisibilityChange(cal.id, !cal.is_visible)}
                  >
                    {cal.display_name ?? "Calendar"}
                  </span>
                  {!!cal.is_primary && (
                    <span className="text-[0.6rem] text-text-tertiary shrink-0">Primary</span>
                  )}
                  {onColorChange && (
                    <input
                      type="color"
                      value={toColorInputValue(cal.color)}
                      onChange={(e) => onColorChange(cal.id, e.target.value)}
                      title="Change calendar color"
                      aria-label={`Color for ${cal.display_name ?? "Calendar"}`}
                      className="w-4 h-4 rounded border border-border-primary shrink-0 cursor-pointer bg-transparent p-0"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
