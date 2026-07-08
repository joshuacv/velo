import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { updateImapAccount, type DbAccount } from "@/services/db/accounts";
import { getDefaultImapPort, getDefaultSmtpPort, type SecurityType } from "@/services/imap/autoDiscovery";

interface ImapAccountSettingsProps {
  account: DbAccount;
  onSaved: () => void;
}

interface TestStatus {
  state: "idle" | "testing" | "success" | "error";
  message?: string;
}

/** Map UI security value ("ssl") to Rust config value ("tls") */
function mapSecurity(security: string): string {
  return security === "ssl" ? "tls" : security;
}

const inputClass =
  "w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-colors appearance-none";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";

export function ImapAccountSettings({ account, onSaved }: ImapAccountSettingsProps) {
  const [imapHost, setImapHost] = useState(account.imap_host ?? "");
  const [imapPort, setImapPort] = useState(account.imap_port ?? 993);
  const [imapSecurity, setImapSecurity] = useState<SecurityType>(
    (account.imap_security as SecurityType) ?? "ssl",
  );
  const [smtpHost, setSmtpHost] = useState(account.smtp_host ?? "");
  const [smtpPort, setSmtpPort] = useState(account.smtp_port ?? 587);
  const [smtpSecurity, setSmtpSecurity] = useState<SecurityType>(
    (account.smtp_security as SecurityType) ?? "ssl",
  );
  const [username, setUsername] = useState(account.imap_username ?? "");
  const [password, setPassword] = useState("");
  const [acceptInvalidCerts, setAcceptInvalidCerts] = useState(!!account.accept_invalid_certs);
  const [imapTest, setImapTest] = useState<TestStatus>({ state: "idle" });
  const [smtpTest, setSmtpTest] = useState<TestStatus>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isOAuth = account.auth_method === "oauth2";
  const effectiveUsername = username.trim() || account.email;
  const effectivePassword = isOAuth
    ? (account.access_token ?? "")
    : password || account.imap_password || "";

  const testImap = useCallback(async () => {
    setImapTest({ state: "testing" });
    try {
      const result = await invoke<string>("imap_test_connection", {
        config: {
          host: imapHost,
          port: imapPort,
          security: mapSecurity(imapSecurity),
          username: effectiveUsername,
          password: effectivePassword,
          auth_method: isOAuth ? "oauth2" : "password",
          accept_invalid_certs: acceptInvalidCerts,
        },
      });
      setImapTest({ state: "success", message: result });
    } catch (err) {
      setImapTest({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [imapHost, imapPort, imapSecurity, effectiveUsername, effectivePassword, acceptInvalidCerts, isOAuth]);

  const testSmtp = useCallback(async () => {
    setSmtpTest({ state: "testing" });
    try {
      const result = await invoke<{ success: boolean; message: string }>("smtp_test_connection", {
        config: {
          host: smtpHost,
          port: smtpPort,
          security: mapSecurity(smtpSecurity),
          username: effectiveUsername,
          password: effectivePassword,
          auth_method: isOAuth ? "oauth2" : "password",
          accept_invalid_certs: acceptInvalidCerts,
        },
      });
      setSmtpTest({ state: result.success ? "success" : "error", message: result.message });
    } catch (err) {
      setSmtpTest({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [smtpHost, smtpPort, smtpSecurity, effectiveUsername, effectivePassword, acceptInvalidCerts, isOAuth]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateImapAccount(account.id, {
        imapHost: imapHost.trim(),
        imapPort,
        imapSecurity,
        smtpHost: smtpHost.trim(),
        smtpPort,
        smtpSecurity,
        imapUsername: username.trim() || null,
        password: password.trim() || undefined,
        acceptInvalidCerts,
      });
      setPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    account.id,
    imapHost,
    imapPort,
    imapSecurity,
    smtpHost,
    smtpPort,
    smtpSecurity,
    username,
    password,
    acceptInvalidCerts,
    onSaved,
  ]);

  return (
    <div className="space-y-4 pt-3">
      {isOAuth && (
        <p className="text-xs text-text-tertiary">
          This account signs in via OAuth2. Server settings can be adjusted below; to refresh
          credentials use Re-authorize instead.
        </p>
      )}

      <div>
        <h5 className="text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
          Incoming Mail (IMAP)
        </h5>
        <div className="space-y-3">
          <TextField
            label="IMAP Server"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            placeholder="imap.example.com"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Port"
              type="number"
              value={imapPort}
              onChange={(e) => setImapPort(parseInt(e.target.value, 10) || 0)}
            />
            <div>
              <label className={labelClass}>Security</label>
              <select
                value={imapSecurity}
                onChange={(e) => {
                  const sec = e.target.value as SecurityType;
                  setImapSecurity(sec);
                  setImapPort(getDefaultImapPort(sec));
                }}
                className={inputClass}
              >
                <option value="ssl">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h5 className="text-[0.7rem] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
          Outgoing Mail (SMTP)
        </h5>
        <div className="space-y-3">
          <TextField
            label="SMTP Server"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="smtp.example.com"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Port"
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 0)}
            />
            <div>
              <label className={labelClass}>Security</label>
              <select
                value={smtpSecurity}
                onChange={(e) => {
                  const sec = e.target.value as SecurityType;
                  setSmtpSecurity(sec);
                  setSmtpPort(getDefaultSmtpPort(sec));
                }}
                className={inputClass}
              >
                <option value="ssl">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <TextField
          label="Username (optional)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={account.email}
        />
        {!isOAuth && (
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              account.imap_password ? "Leave blank to keep current password" : "Enter password"
            }
          />
        )}
        <div className="flex items-center gap-2">
          <input
            id={`accept-invalid-certs-${account.id}`}
            type="checkbox"
            checked={acceptInvalidCerts}
            onChange={(e) => setAcceptInvalidCerts(e.target.checked)}
            className="rounded border-border-primary text-accent focus:ring-accent"
          />
          <label
            htmlFor={`accept-invalid-certs-${account.id}`}
            className="text-sm text-text-secondary"
          >
            Accept self-signed certificates
          </label>
        </div>
      </div>

      {(imapTest.state !== "idle" || smtpTest.state !== "idle") && (
        <div className="space-y-1.5">
          {imapTest.state !== "idle" && (
            <div
              className={`flex items-center gap-2 text-xs ${
                imapTest.state === "success"
                  ? "text-success"
                  : imapTest.state === "error"
                    ? "text-danger"
                    : "text-text-tertiary"
              }`}
            >
              {imapTest.state === "testing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : imapTest.state === "success" ? (
                <CheckCircle2 size={14} />
              ) : (
                <XCircle size={14} />
              )}
              IMAP: {imapTest.message ?? "Testing..."}
            </div>
          )}
          {smtpTest.state !== "idle" && (
            <div
              className={`flex items-center gap-2 text-xs ${
                smtpTest.state === "success"
                  ? "text-success"
                  : smtpTest.state === "error"
                    ? "text-danger"
                    : "text-text-tertiary"
              }`}
            >
              {smtpTest.state === "testing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : smtpTest.state === "success" ? (
                <CheckCircle2 size={14} />
              ) : (
                <XCircle size={14} />
              )}
              SMTP: {smtpTest.message ?? "Testing..."}
            </div>
          )}
        </div>
      )}

      {saveError && <div className="text-xs text-danger">{saveError}</div>}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={testImap}
          disabled={imapTest.state === "testing" || !imapHost}
        >
          {imapTest.state === "testing" && <Loader2 size={14} className="animate-spin" />}
          Test IMAP
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={testSmtp}
          disabled={smtpTest.state === "testing" || !smtpHost}
        >
          {smtpTest.state === "testing" && <Loader2 size={14} className="animate-spin" />}
          Test SMTP
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !imapHost || !smtpHost}
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
