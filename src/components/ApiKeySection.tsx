import { Section } from "@/components/SettingsView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { isAppError } from "@/lib/client";
import { useEffect, useRef, useState } from "react";

/**
 * Where a curator finds their key, written out rather than linked: the app
 * opens no external links (ADR 0052).
 */
const KEY_PAGE = "wallhaven.cc/settings/account";

/** A key the check refused, which is then not stored (ADR 0052). */
const KEY_REFUSED = "Wallhaven rejected that key, so it wasn't saved.";
const SAVE_FAILED = "Couldn't save the key.";
const REMOVE_FAILED = "Couldn't remove the key.";

/**
 * Saved without the check reaching Wallhaven, offline or rate-limited. The key
 * is stored anyway, and the next search is what finds out (ADR 0052).
 */
const UNVERIFIED =
  "Couldn't verify it with Wallhaven just now. The next search will use it.";

/**
 * The Wallhaven API key section: what a key unlocks, then an entry field until
 * one is saved, and "Key saved" with Replace and Remove after.
 *
 * The key goes one way. It crosses into the webview only as it is typed here,
 * and nothing sends it back, so the saved state never shows it: `Settings`
 * carries `wallhaven_key_set` and nothing more (ADR 0052). Replace and Remove
 * reach the next search, because the backend reads the key on every call.
 *
 * Saved on Save or Enter rather than on blur like the path fields, because a
 * save waits on one keyed search, and a blur on the way to another control
 * should not spend an API call on a half-pasted key.
 */
export function ApiKeySection() {
  const { settings, saveWallhavenKey } = useApp();
  const saved = settings.wallhaven_key_set;

  // A saved key is being replaced, so the field is back.
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"saving" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last save answered `verified: false`. Held until the next save or
  // remove, since nothing else learns anything new about the key.
  const [unverified, setUnverified] = useState(false);

  const entering = !saved || replacing;

  // Replace moves the caret into the field it brings back, which is where the
  // curator is about to paste.
  const field = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (replacing) field.current?.focus();
  }, [replacing]);

  // A save, a Cancel or a Remove swaps the controls out from under the caret,
  // so it lands on whichever stands where they were: the Replace button, or
  // the field again. Only then: a page that opens leaves the focus where it
  // was.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (saved && !replacing) replaceButton.current?.focus();
    else field.current?.focus();
  }, [replacing, saved]);

  const save = async () => {
    const key = draft.trim();
    if (!key || busy) return;
    setBusy("saving");
    setError(null);
    try {
      const verified = await saveWallhavenKey(key);
      refocus.current = true;
      setDraft("");
      setReplacing(false);
      setUnverified(!verified);
    } catch (err) {
      setError(
        isAppError(err) && err.kind === "bad_request"
          ? KEY_REFUSED
          : SAVE_FAILED,
      );
      console.error("Failed to save the Wallhaven key:", err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy("removing");
    setError(null);
    try {
      await saveWallhavenKey("");
      refocus.current = true;
      setUnverified(false);
    } catch (err) {
      setError(REMOVE_FAILED);
      console.error("Failed to remove the Wallhaven key:", err);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    refocus.current = true;
    setReplacing(false);
    setDraft("");
    setError(null);
  };

  return (
    <Section heading="API key">
      <p className="text-xs text-muted-foreground">
        Optional. A key unlocks NSFW Results and applies your account's
        blacklists. Find yours at{" "}
        <span data-slot="wallhaven-key-page" className="font-mono">
          {KEY_PAGE}
        </span>
        .
      </p>

      {entering ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            ref={field}
            type="password"
            aria-label="Wallhaven API key"
            placeholder="Paste your API key"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            // Read-only rather than disabled while the check runs, so the
            // caret stays put for a key that comes back refused.
            readOnly={busy !== null}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy !== null || draft.trim() === ""}
          >
            {busy === "saving" ? "Checking…" : "Save"}
          </Button>
          {replacing && (
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p data-slot="wallhaven-key-state" className="mr-auto text-sm">
            Key saved
          </p>
          <Button
            ref={replaceButton}
            variant="outline"
            onClick={() => {
              setError(null);
              setReplacing(true);
            }}
            disabled={busy !== null}
          >
            Replace
          </Button>
          {/* Outline rather than destructive: a removed key is pasted back in
              from the same page it came from. */}
          <Button
            variant="outline"
            onClick={() => void remove()}
            disabled={busy !== null}
          >
            {busy === "removing" ? "Removing…" : "Remove"}
          </Button>
        </div>
      )}

      {error ? (
        <p
          data-slot="wallhaven-key-status"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : (
        saved &&
        !replacing &&
        unverified && (
          <p
            data-slot="wallhaven-key-status"
            className="text-xs text-muted-foreground"
          >
            {UNVERIFIED}
          </p>
        )
      )}
    </Section>
  );
}
