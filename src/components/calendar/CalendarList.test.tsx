import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { CalendarList } from "./CalendarList";
import type { DbCalendar } from "@/services/db/calendars";

function makeCalendar(overrides: Partial<DbCalendar> = {}): DbCalendar {
  return {
    id: "cal-1",
    account_id: "acc-1",
    provider: "google",
    remote_id: "remote-1",
    display_name: "Work",
    color: "#4285f4",
    is_primary: 0,
    is_visible: 1,
    sync_token: null,
    ctag: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  };
}

describe("CalendarList", () => {
  it("renders all calendar names", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Work" }),
      makeCalendar({ id: "cal-2", display_name: "Personal" }),
      makeCalendar({ id: "cal-3", display_name: "Holidays" }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />,
    );

    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Holidays")).toBeInTheDocument();
  });

  it('shows "Primary" badge for primary calendar', () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Main", is_primary: 1 }),
      makeCalendar({ id: "cal-2", display_name: "Secondary", is_primary: 0 }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />,
    );

    expect(screen.getByText("Primary")).toBeInTheDocument();
    // Only one Primary badge
    expect(screen.getAllByText("Primary")).toHaveLength(1);
  });

  it("checkboxes reflect is_visible state", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Visible", is_visible: 1 }),
      makeCalendar({
        id: "cal-2",
        display_name: "Hidden",
        is_visible: 0,
      }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it("clicking checkbox calls onVisibilityChange with correct calendarId and new state", () => {
    const onVisibilityChange = vi.fn();
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Work", is_visible: 1 }),
      makeCalendar({ id: "cal-2", display_name: "Personal", is_visible: 0 }),
    ];

    render(
      <CalendarList
        calendars={calendars}
        onVisibilityChange={onVisibilityChange}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");

    // Uncheck the visible calendar
    fireEvent.click(checkboxes[0]);
    expect(onVisibilityChange).toHaveBeenCalledWith("cal-1", false);

    // Check the hidden calendar
    fireEvent.click(checkboxes[1]);
    expect(onVisibilityChange).toHaveBeenCalledWith("cal-2", true);
  });

  it("calendar color is applied to the checkbox indicator", () => {
    const calendars = [
      makeCalendar({
        id: "cal-1",
        display_name: "Work",
        color: "#e63946",
        is_visible: 1,
      }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />,
    );

    // The color indicator span is the sibling after the sr-only checkbox
    const checkbox = screen.getByRole("checkbox");
    const indicator = checkbox.nextElementSibling as HTMLElement;
    expect(indicator.style.backgroundColor).toBe("rgb(230, 57, 70)");
  });

  it('handles null display_name by showing "Calendar" fallback', () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: null }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />,
    );

    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });

  it("does not show account group headers when all calendars belong to one account", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", account_id: "acc-1", display_name: "Work" }),
      makeCalendar({ id: "cal-2", account_id: "acc-1", display_name: "Personal" }),
    ];

    render(
      <CalendarList
        calendars={calendars}
        accountLabels={{ "acc-1": "me@gmail.com" }}
        onVisibilityChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("me@gmail.com")).not.toBeInTheDocument();
  });

  it("groups calendars under an account label when multiple accounts are present", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", account_id: "acc-1", display_name: "Work" }),
      makeCalendar({ id: "cal-2", account_id: "acc-2", display_name: "University Schedule" }),
    ];

    render(
      <CalendarList
        calendars={calendars}
        accountLabels={{ "acc-1": "me@gmail.com", "acc-2": "Uni Feed" }}
        onVisibilityChange={vi.fn()}
      />,
    );

    expect(screen.getByText("me@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Uni Feed")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("University Schedule")).toBeInTheDocument();
  });

  it("does not render a color picker when onColorChange is not provided", () => {
    const calendars = [makeCalendar({ id: "cal-1", display_name: "Work" })];

    render(<CalendarList calendars={calendars} onVisibilityChange={vi.fn()} />);

    expect(document.querySelector('input[type="color"]')).not.toBeInTheDocument();
  });

  it("renders a color picker per calendar reflecting its current color", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Work", color: "#e63946" }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} onColorChange={vi.fn()} />,
    );

    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput).toBeInTheDocument();
    expect(colorInput.value).toBe("#e63946");
  });

  it("falls back to the default color in the picker when the calendar has none", () => {
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Work", color: null }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} onColorChange={vi.fn()} />,
    );

    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput.value).toBe("#6366f1");
  });

  it("calls onColorChange with the calendar id and new color", () => {
    const onColorChange = vi.fn();
    const calendars = [
      makeCalendar({ id: "cal-1", display_name: "Work", color: "#e63946" }),
    ];

    render(
      <CalendarList calendars={calendars} onVisibilityChange={vi.fn()} onColorChange={onColorChange} />,
    );

    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#0b8043" } });

    expect(onColorChange).toHaveBeenCalledWith("cal-1", "#0b8043");
  });
});
