/**
 * Invite modal — collects email, POSTs `/api/v1/evaluations/:id/invites`.
 *
 * Wave 7. Opened from the eval-history list when the user presses `i`
 * on a highlighted row. Built on the {@link Modal} primitive.
 *
 * Simpler than the share modal: just an email input + submit. Kept as
 * its own component (rather than a share-modal mode) because the API
 * shape is meaningfully different — `invites` provisions a teammate
 * via email, `shares` adds an existing user to the eval ACL.
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { Theme } from "../../theme.js";
import { InlineTextInput } from "../inline-text-input.js";
import { Modal } from "./modal.js";

export interface InviteClient {
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

export interface InviteResolution {
  kind: "success" | "error" | "cancel";
  message: string;
}

interface InviteModalProps {
  evaluationId: string;
  evaluationName?: string;
  onClose: (resolution: InviteResolution) => void;
  createClient?: () => Promise<InviteClient>;
}

export function InviteModal(props: InviteModalProps) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string): Promise<void> {
    if (submitting) return;
    if (!value.includes("@")) {
      setError("Enter a valid email address.");
      setEditing(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/evaluations/${encodeURIComponent(props.evaluationId)}/invites`,
        { email: value }
      );
      props.onClose({
        kind: "success",
        message: `Invite sent to ${value}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
      setEditing(true);
    }
  }

  // Always-on Esc handler so the user can bail mid-typing. InlineTextInput
  // ignores Esc internally but still owns the keystream while editing,
  // so we attach a dedicated handler here.
  useInput((_input, key) => {
    if (submitting) return;
    if (key.escape) {
      props.onClose({ kind: "cancel", message: "Invite cancelled" });
    }
  });

  return (
    <Modal
      title={`Invite to evaluation${props.evaluationName ? ` — ${props.evaluationName}` : ""}`}
      width={64}
      footer={<Text dimColor>Enter submit · Esc cancel</Text>}
    >
      <Box gap={1}>
        <Text bold>Email:</Text>
        {editing ? (
          <InlineTextInput
            placeholder="teammate@example.com"
            defaultValue={email}
            onChange={setEmail}
            onSubmit={(val) => {
              setEmail(val);
              setEditing(false);
              void submit(val);
            }}
          />
        ) : (
          <Text>{email}</Text>
        )}
      </Box>

      {submitting ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Sending invite…</Text>
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
