import { useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle, Loader2, Link as LinkIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { insertIcsAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import { testIcsFeedUrl } from "@/services/calendar/icsUrlProvider";

interface AddIcsCalendarAccountProps {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

type Step = "basic" | "test" | "done";

export function AddIcsCalendarAccount({ onClose, onSuccess, onBack }: AddIcsCalendarAccountProps) {
  const addAccount = useAccountStore((s) => s.addAccount);
  const [step, setStep] = useState<Step>("basic");

  const [displayName, setDisplayName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testIcsFeedUrl(icsUrl.trim());
    setTestResult(result);
    setTesting(false);
  }, [icsUrl]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      await insertIcsAccount({
        id,
        displayName: displayName.trim() || "Subscribed Calendar",
        icsUrl: icsUrl.trim(),
      });

      addAccount({
        id,
        email: `ics-${id}@velo.local`,
        displayName: displayName.trim() || "Subscribed Calendar",
        avatarUrl: null,
        isActive: true,
        provider: "ics_url",
      });

      setStep("done");
    } catch (err) {
      console.error("Failed to create ICS calendar account:", err);
      setTestResult({ success: false, message: "Failed to save calendar" });
    } finally {
      setCreating(false);
    }
  }, [displayName, icsUrl, addAccount]);

  return (
    <Modal isOpen={true} onClose={onClose} title="Subscribe to a Calendar URL" width="w-full max-w-md">
      <div className="p-4">
        {step === "basic" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <LinkIcon size={20} className="text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-primary">Read-only Calendar Subscription</h3>
                <p className="text-xs text-text-tertiary">
                  Add any public or "secret" .ics / webcal feed URL — e.g. your university's class
                  schedule, or a Google Calendar "secret address in iCal format." No sign-in needed;
                  events sync one-way and can't be edited from Velo.
                </p>
              </div>
            </div>

            <TextField
              label="Calendar Name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="University Schedule"
              autoFocus
            />

            <TextField
              label="Feed URL"
              type="url"
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://example.edu/calendar/feed.ics"
            />

            <div className="flex justify-between pt-2">
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                onClick={() => { setStep("test"); handleTest(); }}
                disabled={!icsUrl.trim()}
                className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
              >
                Test & Connect
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {step === "test" && (
          <div className="space-y-4">
            <div className="text-center py-6">
              {testing && (
                <>
                  <Loader2 size={32} className="animate-spin text-accent mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">Fetching feed...</p>
                </>
              )}

              {!testing && testResult?.success && (
                <>
                  <CheckCircle2 size={32} className="text-success mx-auto mb-3" />
                  <p className="text-sm font-medium text-text-primary">{testResult.message}</p>
                </>
              )}

              {!testing && testResult && !testResult.success && (
                <>
                  <XCircle size={32} className="text-danger mx-auto mb-3" />
                  <p className="text-sm font-medium text-text-primary">Connection failed</p>
                  <p className="text-xs text-text-tertiary mt-1">{testResult.message}</p>
                </>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => { setStep("basic"); setTestResult(null); }}
                className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>

              {testResult?.success ? (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Add Calendar"}
                </button>
              ) : !testing ? (
                <button
                  onClick={handleTest}
                  className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
                >
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-6">
            <CheckCircle2 size={32} className="text-success mx-auto mb-3" />
            <p className="text-sm font-medium text-text-primary">Calendar added!</p>
            <p className="text-xs text-text-tertiary mt-1">
              Events will sync automatically. This calendar is read-only.
            </p>
            <button
              onClick={onSuccess}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
