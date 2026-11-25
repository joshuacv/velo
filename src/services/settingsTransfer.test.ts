import {
  isSecretSettingKey,
  buildSettingsBackup,
  serializeBackup,
  parseBackup,
  applySettingsBackup,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type SettingsBackup,
} from "./settingsTransfer";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("./db/connection", () => ({
  getDb: vi.fn(() => ({
    execute: (...args: unknown[]) => mockExecute(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  })),
}));

const mockGetAllSettings = vi.fn();
const mockSetSetting = vi.fn();

vi.mock("./db/settings", () => ({
  getAllSettings: (...args: unknown[]) => mockGetAllSettings(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue(undefined);
  mockSelect.mockResolvedValue([]);
  mockGetAllSettings.mockResolvedValue({});
  mockSetSetting.mockResolvedValue(undefined);
});

describe("isSecretSettingKey", () => {
  it("flags API keys, tokens, secrets and passwords", () => {
    for (const key of [
      "claude_api_key",
      "openai_api_key",
      "gemini_api_key",
      "copilot_api_key",
      "telegram_bot_token",
      "refresh_token",
      "oauth_refresh_token",
      "oauth_exchange_token",
      "google_client_secret",
      "imap_password",
    ]) {
      expect(isSecretSettingKey(key)).toBe(true);
    }
  });

  it("does not flag ordinary preferences", () => {
    for (const key of [
      "theme",
      "color_theme",
      "sync_period_days",
      "reading_pane_position",
      "claude_model",
      "oauth_client_id",
      "google_client_id",
    ]) {
      expect(isSecretSettingKey(key)).toBe(false);
    }
  });
});

describe("buildSettingsBackup", () => {
  it("includes accounts and non-secret settings, excludes secret settings", async () => {
    mockSelect.mockResolvedValue([
      { email: "a@x.com", provider: "imap", imap_host: "imap.x.com" },
    ]);
    mockGetAllSettings.mockResolvedValue({
      theme: "dark",
      sync_period_days: "0",
      claude_api_key: "sk-secret",
      telegram_bot_token: "12345:secret",
    });

    const backup = await buildSettingsBackup();

    expect(backup.app).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.accounts).toHaveLength(1);
    expect(backup.settings).toEqual({ theme: "dark", sync_period_days: "0" });
    expect(backup.settings).not.toHaveProperty("claude_api_key");
    expect(backup.settings).not.toHaveProperty("telegram_bot_token");
  });

  it("selects only non-secret account columns", async () => {
    await buildSettingsBackup();
    const sql = mockSelect.mock.calls[0]?.[0] as string;
    expect(sql).toContain("imap_host");
    expect(sql).toContain("caldav_url");
    expect(sql).not.toContain("imap_password");
    expect(sql).not.toContain("access_token");
    expect(sql).not.toContain("caldav_password");
  });
});

describe("serializeBackup / parseBackup", () => {
  const backup: SettingsBackup = {
    app: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 123,
    accounts: [],
    settings: { theme: "dark" },
  };

  it("round-trips", () => {
    expect(parseBackup(serializeBackup(backup))).toEqual(backup);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseBackup("{not json")).toThrow(/invalid JSON/i);
  });

  it("rejects a file that is not a Velo backup", () => {
    expect(() => parseBackup(JSON.stringify({ app: "something-else" }))).toThrow(
      /not a valid velo/i,
    );
  });

  it("rejects a newer backup version", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, version: BACKUP_VERSION + 1 })),
    ).toThrow(/unsupported backup version/i);
  });

  it("rejects a backup missing accounts/settings", () => {
    expect(() =>
      parseBackup(JSON.stringify({ app: BACKUP_FORMAT, version: 1 })),
    ).toThrow(/missing accounts or settings/i);
  });
});

describe("applySettingsBackup", () => {
  const backup: SettingsBackup = {
    app: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 0,
    accounts: [
      { email: "new@x.com", provider: "imap", imap_host: "imap.x.com" } as never,
      { email: "dupe@x.com", provider: "gmail_api" } as never,
    ],
    settings: { theme: "dark", claude_api_key: "sk-should-be-ignored" },
  };

  it("inserts new accounts and skips ones that already exist", async () => {
    mockSelect.mockResolvedValue([{ email: "dupe@x.com", provider: "gmail_api" }]);

    const summary = await applySettingsBackup(backup);

    expect(summary.accountsAdded).toBe(1);
    expect(summary.accountsSkipped).toEqual(["dupe@x.com"]);
    expect(summary.accountsNeedingCredentials).toEqual(["new@x.com"]);
    // one INSERT for the single new account
    const inserts = mockExecute.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO accounts"),
    );
    expect(inserts).toHaveLength(1);
  });

  it("never writes secret settings even if present in the file", async () => {
    await applySettingsBackup(backup);
    expect(mockSetSetting).toHaveBeenCalledWith("theme", "dark");
    expect(mockSetSetting).not.toHaveBeenCalledWith(
      "claude_api_key",
      expect.anything(),
    );
  });

  it("does not include a password column in the account insert", async () => {
    await applySettingsBackup(backup);
    const insert = mockExecute.mock.calls.find((c) =>
      String(c[0]).startsWith("INSERT INTO accounts"),
    );
    expect(String(insert?.[0])).not.toContain("imap_password");
    expect(String(insert?.[0])).not.toContain("access_token");
  });
});
