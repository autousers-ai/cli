/**
 * Transfer modal — collects target team slug/id, POSTs
 * `/api/v1/evaluations/:id/transfer`.
 *
 * Wave 7. Opened from the eval-history list when the user presses `t`.
 * Transferring ownership is destructive (the current team loses Owner
 * access and gets re-classed as a member-with-access), so the modal
 * uses `Theme.warning` for its border and shows a confirmation hint.
 *
 * Future improvement (deferred): swap the free-text target field for a
 * picker over `GET /api/v1/teams`. The picker pattern lives in Wave 9
 * (teams-section), so reusing it requires Wave 9 to land first.
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { Theme } from "../../theme.js";
import { InlineTextInput } from "../inline-text-input.js";
import { Modal } from "./modal.js";

export interface TransferClient {
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

export interface TransferResolution {
  kind: "success" | "error" | "cancel";
  message: string;
}

interface TransferModalProps {
  evaluationId: string;
  evaluationName?: string;
  onClose: (resolution: TransferResolution) => void;
  createClient?: () => Promise<TransferClient>;
}

export function TransferModal(props: TransferModalProps) {
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string): Promise<void> {
    if (submitting) return;
    if (value.trim().length === 0) {
      setError("Team slug or id is required.");
      setEditing(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.post(
        `/api/v1/evaluations/${encodeURIComponent(props.evaluationId)}/transfer`,
        { to: value.trim() }
      );
      props.onClose({
        kind: "success",
        message: `Transferred to ${value}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
      setEditing(true);
    }
  }

  useInput((_input, key) => {
    if (submitting) return;
    if (key.escape) {
      props.onClose({ kind: "cancel", message: "Transfer cancelled" });
    }
  });

  return (
    <Modal
      title="Transfer ownership"
      width={64}
      borderColor={Theme.warning}
      footer={<Text dimColor>Enter submit · Esc cancel</Text>}
    >
      <Text color={Theme.warning}>
        ⚠ Transferring moves Owner-rights to another team. This is hard to
        reverse.
      </Text>

      <Box gap={1} marginTop={1}>
        <Text bold>Target:</Text>
        {editing ? (
          <InlineTextInput
            placeholder="team-slug or team-id"
            defaultValue={target}
            onChange={setTarget}
            onSubmit={(val) => {
              setTarget(val);
              setEditing(false);
              void submit(val);
            }}
          />
        ) : (
          <Text>{target}</Text>
        )}
      </Box>

      {submitting ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Transferring…</Text>
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
