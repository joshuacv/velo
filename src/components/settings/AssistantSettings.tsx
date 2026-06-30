import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import {
  getAssistantConfig,
  saveAssistantConfig,
  restartAssistant,
  testToken,
} from "@/services/assistant/assistantManager";

/**
 * Settings panel for the phone assistant (Telegram). Read-only assistant in
 * slice 1: pair a bot, lock it to your Telegram user ID, enable it.
 */
export function AssistantSettings() {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [allowedUserId, setAllowedUserId] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void getAssistantConfig().then((cfg) => {
      setEnabled(cfg.enabled);
      setToken(cfg.token ?? "");
      setAllowedUserId(cfg.allowedUserId ?? "");
    });
  }, []);

  const handleSave = async () => {
    await saveAssistantConfig({ enabled, token, allowedUserId });
    await restartAssistant();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testToken(token);
    setTestResult(
      res.ok ? `Connected as @${res.username ?? "bot"}` : `Failed: ${res.error ?? "unknown error"}`,
    );
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">
          Phone Assistant (Telegram)
        </h3>
        <p className="text-xs text-text-tertiary mb-4 leading-relaxed">
          Chat with your inbox from your phone via a Telegram bot. Right now it's
          read-only — it can read and summarize mail, but not send. Velo must be
          running (it can stay minimized in the tray) for the bot to respond.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-text-secondary">Enable assistant</span>
              <p className="text-xs text-text-tertiary mt-0.5">
                Start the Telegram bot when Velo is running.
              </p>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ml-4 ${
                enabled ? "bg-accent" : "bg-bg-tertiary"
              }`}
              aria-pressed={enabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                  enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <TextField
            label="Bot token"
            size="md"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
          />

          <TextField
            label="Allowed Telegram user ID"
            size="md"
            type="text"
            value={allowedUserId}
            onChange={(e) => setAllowedUserId(e.target.value)}
            placeholder="e.g. 12345678"
          />

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} className="bg-accent text-white">
              {saved ? "Saved!" : "Save"}
            </Button>
            <Button
              onClick={handleTest}
              disabled={!token.trim() || testing}
              className="bg-bg-tertiary text-text-primary border border-border-primary"
            >
              {testing ? "Testing..." : "Test token"}
            </Button>
            {testResult && (
              <span
                className={`text-xs ${
                  testResult.startsWith("Connected") ? "text-success" : "text-danger"
                }`}
              >
                {testResult}
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">
          Setup
        </h3>
        <ol className="text-xs text-text-tertiary space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>In Telegram, message <span className="text-text-secondary">@BotFather</span> and send <span className="text-text-secondary">/newbot</span> to create a bot. Paste the token it gives you above.</li>
          <li>Save and enable. Then message your new bot anything — it'll reply with your Telegram user ID.</li>
          <li>Paste that ID into "Allowed Telegram user ID" and Save again. Only that account can talk to your mail.</li>
        </ol>
      </div>
    </div>
  );
}
