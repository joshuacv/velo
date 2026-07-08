import { hexToRgba, toColorInputValue, eventColorStyle, DEFAULT_CALENDAR_COLOR } from "./calendarColor";

describe("hexToRgba", () => {
  it("converts a 6-digit hex color to rgba", () => {
    expect(hexToRgba("#4285f4", 0.5)).toBe("rgba(66, 133, 244, 0.5)");
  });

  it("is case-insensitive", () => {
    expect(hexToRgba("#4285F4", 0.5)).toBe("rgba(66, 133, 244, 0.5)");
  });

  it("returns null for a non-hex value", () => {
    expect(hexToRgba("cornflowerblue", 0.5)).toBeNull();
  });

  it("returns null for a malformed hex value", () => {
    expect(hexToRgba("#fff", 0.5)).toBeNull();
    expect(hexToRgba("4285f4", 0.5)).toBeNull();
  });
});

describe("toColorInputValue", () => {
  it("returns the color when it's a valid hex value", () => {
    expect(toColorInputValue("#e63946")).toBe("#e63946");
  });

  it("falls back to the default color when null", () => {
    expect(toColorInputValue(null)).toBe(DEFAULT_CALENDAR_COLOR);
  });

  it("falls back to the default color when undefined", () => {
    expect(toColorInputValue(undefined)).toBe(DEFAULT_CALENDAR_COLOR);
  });

  it("falls back to the default color for a non-hex value", () => {
    expect(toColorInputValue("rebeccapurple")).toBe(DEFAULT_CALENDAR_COLOR);
  });
});

describe("eventColorStyle", () => {
  it("returns an empty object when no color is given", () => {
    expect(eventColorStyle(null)).toEqual({});
    expect(eventColorStyle(undefined)).toEqual({});
  });

  it("returns a tinted background and solid text color for a hex value", () => {
    expect(eventColorStyle("#4285f4")).toEqual({
      backgroundColor: "rgba(66, 133, 244, 0.14)",
      color: "#4285f4",
    });
  });

  it("falls back to just the text color for a non-hex value", () => {
    expect(eventColorStyle("cornflowerblue")).toEqual({ color: "cornflowerblue" });
  });
});
