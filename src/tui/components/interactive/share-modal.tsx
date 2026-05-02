/**
 * Share modal — collects email + role, POSTs `/api/v1/evaluations/:id/shares`.
 *
 * Wave 7. Opened from the eval-history list when the user presses `s` on
 * a highlighted row. Built on the {@link Modal} primitive — the modal
 * provides the bordered chrome + title; this component owns the form
 * state, key handling, and the POST.
 *
 * Form layout:
 *   ┌─ Share evaluation ────────────────────┐
 *   │ Email:  [user@example.com|]            │
 *   │ Role:   < viewer >                     │
 *   │                                        │
 *   │ Tab cycles · ←/→ role · Enter submit   │
 *   │ Esc cancel                             │
 *   └────────────────────────────────────────┘
 *
 * On success the parent receives a `kind: "success"` resolution; on
 * failure a `kind: "error"`. The modal stays mounted until the parent
 * routes the screen back to the list.
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { Theme } from "../../theme.js";
import { InlineTextInput } from "../inline-text-input.js";
import { Modal } from "./modal.js";

export type ShareRole = "viewer" | "editor" | "owner";
export const SHARE_ROLES: ShareRole[] = ["viewer", "editor", "owner"];

/** Minimal client surface — only `post`. Tests inject a stub. */
export interface ShareClient {
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

export interface ShareResolution {
  kind: "success" | "error" | "cancel";
  message: string;
}

interface ShareModalProps {
  /** The evaluation being shared. */
  evaluationId: string;
  /** Display name (only used for the title hint). */
  evaluationName?: string;
  /** Closes the modal — parent decides whether to drop back to the list. */
  onClose: (resolution: ShareResolution) => void;
  /** Test seam — overrides the API client factory. */
  createClient?: () => Promise<ShareClient>;
}

type Field = "email" | "role";

export function ShareModal(props: ShareModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [field, setField] = useState<Field>("email");
  const [editingEmail, setEditingEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (submitting) return;
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/evaluations/${encodeURIComponent(props.evaluationId)}/shares`,
        { email, role }
      );
      props.onClose({
        kind: "success",
        message: `Shared with ${email} (${role})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
    }
  }

  // Esc must always cancel, even while the email field has focus.
  // Registering a dedicated handler here means InlineTextInput's
  // own `useInput` (which ignores Esc but keeps swallowing it for
  // other purposes) doesn't shadow the cancel keybind.
  useInput((_input, key) => {
    if (submitting) return;
    if (key.escape) {
      props.onClose({ kind: "cancel", message: "Share cancelled" });
    }
  });

  useInput(
    (input, key) => {
      if (submitting) return;
      if (key.escape) return; // owned by the always-on handler above
      if (key.tab) {
        setField((f) => (f === "email" ? "role" : "email"));
        if (field === "email") setEditingEmail(false);
        else setEditingEmail(true);
        return;
      }
      if (field === "role") {
        if (key.leftArrow || input === "h") {
          const idx = SHARE_ROLES.indexOf(role);
          setRole(SHARE_ROLES[Math.max(0, idx - 1)]!);
          return;
        }
        if (key.rightArrow || input === "l") {
          const idx = SHARE_ROLES.indexOf(role);
          setRole(SHARE_ROLES[Math.min(SHARE_ROLES.length - 1, idx + 1)]!);
          return;
        }
        if (key.return) {
          void submit();
          return;
        }
      }
    },
    { isActive: !editingEmail }
  );

  return (
    <Modal
      title={`Share evaluation${props.evaluationName ? ` — ${props.evaluationName}` : ""}`}
      width={64}
      footer={
        <Text dimColor>Tab field · ← → role · Enter submit · Esc cancel</Text>
      }
    >
      <Box gap={1}>
        <Text color={field === "email" ? Theme.brand : undefined}>
          {field === "email" ? ">" : " "}
        </Text>
        <Text bold={field === "email"}>Email:</Text>
        {editingEmail ? (
          <InlineTextInput
            placeholder="user@example.com"
            defaultValue={email}
            onChange={setEmail}
            onSubmit={(val) => {
              setEmail(val);
              setEditingEmail(false);
              setField("role");
            }}
          />
        ) : (
          <Text color={email ? undefined : Theme.textDim}>
            {email || "(Tab to email, type to enter)"}
          </Text>
        )}
      </Box>

      <Box gap={1} marginTop={1}>
        <Text color={field === "role" ? Theme.brand : undefined}>
          {field === "role" ? ">" : " "}
        </Text>
        <Text bold={field === "role"}>Role:</Text>
        <Text color={Theme.brand}>{`< ${role} >`}</Text>
      </Box>

      {submitting ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Sharing…</Text>
        </Box>
      ) : null}

      {error ? (
        <Box marginTop={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
    </Modal>
  );
}
