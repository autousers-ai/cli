/**
 * Delete-confirm modal — prompts for [y/N], DELETEs
 * `/api/v1/evaluations/:id`.
 *
 * Wave 7. Opened from the eval-history list when the user presses `d`.
 * Mirror of the plain-mode `eval delete` confirm prompt — same destructive-
 * action contract, same single keystroke (y to confirm, anything else to
 * cancel). Border colour is `Theme.error` so it visually pops vs. the
 * brand-blue share/invite modals.
 */
import { useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import { createClientFromConfig } from "../../../client.js";
import { Theme } from "../../theme.js";
import { Modal } from "./modal.js";

export interface DeleteClient {
  delete: <T = unknown>(path: string) => Promise<T>;
}

export interface DeleteResolution {
  kind: "success" | "error" | "cancel";
  message: string;
}

interface DeleteConfirmModalProps {
  evaluationId: string;
  evaluationName?: string;
  onClose: (resolution: DeleteResolution) => void;
  createClient?: () => Promise<DeleteClient>;
}

export function DeleteConfirmModal(props: DeleteConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());
      await client.delete(
        `/api/v1/evaluations/${encodeURIComponent(props.evaluationId)}`
      );
      props.onClose({
        kind: "success",
        message: `Deleted ${props.evaluationName ?? props.evaluationId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
    }
  }

  useInput((input, key) => {
    if (submitting) return;
    if (key.escape) {
      props.onClose({ kind: "cancel", message: "Delete cancelled" });
      return;
    }
    if (input === "y" || input === "Y") {
      void submit();
      return;
    }
    if (input === "n" || input === "N" || key.return) {
      props.onClose({ kind: "cancel", message: "Delete cancelled" });
    }
  });

  return (
    <Modal
      title="Delete evaluation"
      width={64}
      borderColor={Theme.error}
      footer={<Text dimColor>y confirm · n / Esc cancel</Text>}
    >
      <Text color={Theme.error}>
        ⚠ Delete <Text bold>{props.evaluationName ?? props.evaluationId}</Text>?
      </Text>
      <Text dimColor>This cannot be undone.</Text>

      {submitting ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Deleting…</Text>
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
