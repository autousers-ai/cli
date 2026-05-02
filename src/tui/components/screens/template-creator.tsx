/**
 * Wave 9 — AI-assisted template creator screen.
 *
 * Mirrors the autorater-creator from Wave 8: two modes (`describe` /
 * `form`) with the same a/e/t review keybinds. Reuses the
 * `useAiStream` hook against `/api/v1/templates/draft-from-prompt` —
 * the proposal shape differs (templates suggest dimensions + rubrics +
 * scoring scales rather than a persona), so the hook is generic over
 * the proposal type via its `validateProposal` option.
 *
 * On accept, POSTs to `/api/v1/templates` with a flattened payload —
 * the template-draft endpoint can suggest multiple dimensions per
 * proposal but the create endpoint accepts one at a time, so we send
 * the lead dimension's shape with the template name + description as
 * top-level fields. Future work: a follow-up "add dimension" sub-view
 * that lets the user create the rest of the suggested dimensions in
 * a batch. v1.0 ships the lead-dimension-only flow because the AI's
 * top suggestion is reliably the load-bearing one.
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  getResolvedBearer,
  type AutousersClient,
} from "../../../client.js";
import { getBaseUrl } from "../../../config.js";
import {
  isTemplateDraftProposal,
  useAiStream,
  type TemplateDraftProposal,
} from "../../hooks/use-ai-stream.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

// ─── Types ─────────────────────────────────────────────────────────────────

type Mode = "describe" | "form";
type Phase = "input" | "streaming" | "review" | "saving" | "done";

interface TemplateCreatorProps {
  /** Test seam — substitute the API client factory. */
  createClient?: () => Promise<Pick<AutousersClient, "post" | "patch" | "get">>;
  /** Test seam — provide a synchronous bearer / baseUrl. */
  bearer?: string | null;
  baseUrl?: string;
  /** Test seam — substitute the `useAiStream` hook so tests can drive it. */
  fetchImpl?: typeof fetch;
}

interface FormState {
  name: string;
  description: string;
  /** First suggested dimension's name (load-bearing). */
  dimensionName: string;
  /** Free-text rubric criteria — `:` separated, one per line. */
  rubricsText: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function TemplateCreator(props: TemplateCreatorProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const editingTemplateId = useTUIStore((s) => s.editingTemplateId);
  const setEditingTemplateId = useTUIStore((s) => s.setEditingTemplateId);
  const setToast = useTUIStore((s) => s.setToast);

  const [mode, setMode] = useState<Mode>(
    editingTemplateId ? "form" : "describe"
  );
  const [phase, setPhase] = useState<Phase>("input");
  const [prompt, setPrompt] = useState("");
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    dimensionName: "",
    rubricsText: "",
  });
  const [activeFormField, setActiveFormField] =
    useState<keyof FormState>("name");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bearer, setBearer] = useState<string | null>(props.bearer ?? null);
  const [baseUrl, setBaseUrl] = useState<string>(
    props.baseUrl ?? "https://app.autousers.ai"
  );

  const ai = useAiStream<TemplateDraftProposal>({
    bearer: bearer ?? undefined,
    baseUrl,
    fetchImpl: props.fetchImpl,
    endpoint: "/api/v1/templates/draft-from-prompt",
    validateProposal: isTemplateDraftProposal,
  });

  // Resolve bearer + base URL on mount unless overridden via props.
  useEffect(() => {
    if (props.bearer !== undefined && props.baseUrl !== undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const [b, u] = await Promise.all([getResolvedBearer(), getBaseUrl()]);
        if (cancelled) return;
        if (props.bearer === undefined) setBearer(b ?? null);
        if (props.baseUrl === undefined) setBaseUrl(u);
      } catch {
        // Non-fatal — the user can still operate the form mode without a
        // resolved bearer; the AI stream will just surface a 401.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit-mode prefetch. The template/dimension row carries far more than
  // just name + description (criteria, factors, sse fields, …) but for
  // the form-mode editor we only surface the fields the creator already
  // exposes. We do best-effort populate `rubricsText` from the row's
  // `criteria` or `factors` JSON arrays so the form pane shows something
  // meaningful — empty rubricsText made edit forms look blank.
  useEffect(() => {
    if (!editingTemplateId) return;
    let cancelled = false;
    void (async () => {
      try {
        const factory =
          props.createClient ?? (() => createClientFromConfig({}));
        const client = await Promise.resolve(factory());
        const env = await client.get<{
          data: {
            id: string;
            name: string;
            description: string | null;
            criteria?: unknown;
            factors?: unknown;
          };
        }>(`/api/v1/templates/${encodeURIComponent(editingTemplateId)}`);
        if (cancelled) return;
        const row = env.data;
        const stringifyList = (raw: unknown): string => {
          if (!Array.isArray(raw)) return "";
          return raw
            .map((entry) => {
              if (typeof entry === "string") return entry;
              if (entry && typeof entry === "object") {
                const obj = entry as Record<string, unknown>;
                const n = typeof obj.name === "string" ? obj.name : "";
                const d =
                  typeof obj.description === "string" ? obj.description : "";
                if (n && d) return `${n}: ${d}`;
                return n || d || "";
              }
              return "";
            })
            .filter((s) => s.length > 0)
            .join("\n");
        };
        const rubricsText =
          stringifyList(row.criteria) || stringifyList(row.factors);
        setForm({
          name: row.name,
          description: row.description ?? "",
          dimensionName: row.name,
          rubricsText,
        });
        setMode("form");
        setPhase("review");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // Surface the failure on the review pane (where saveError
        // renders) rather than leaving the user staring at an empty
        // input phase.
        setSaveError(`Failed to load template: ${msg}`);
        setMode("form");
        setPhase("review");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTemplateId]);

  // React to AI stream lifecycle — when status flips to "done" we
  // populate the form from the proposal and move to review phase.
  useEffect(() => {
    if (ai.status === "streaming" && phase !== "streaming") {
      setPhase("streaming");
    }
    if (ai.status === "done" && ai.proposal) {
      const lead = ai.proposal.suggestedDimensions[0];
      const rubricsText = (lead?.rubrics ?? [])
        .map((r) => `${r.name}: ${r.description}`)
        .join("\n");
      setForm({
        name: ai.proposal.name,
        description: ai.proposal.description,
        dimensionName: lead?.name ?? ai.proposal.name,
        rubricsText,
      });
      setPhase("review");
    }
  }, [ai.status, ai.proposal, phase]);

  // Clear the editing id on unmount so subsequent visits start fresh.
  useEffect(() => {
    return () => {
      setEditingTemplateId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(): Promise<void> {
    if (phase === "saving") return;
    if (!form.name.trim()) {
      setSaveError("Name is required.");
      return;
    }
    setPhase("saving");
    setSaveError(null);
    try {
      const factory = props.createClient ?? (() => createClientFromConfig({}));
      const client = await Promise.resolve(factory());

      if (editingTemplateId) {
        await client.patch(
          `/api/v1/templates/${encodeURIComponent(editingTemplateId)}`,
          {
            name: form.name,
            description: form.description,
          }
        );
        setToast({ kind: "success", message: `Updated ${form.name}` });
      } else {
        // Resolve the active team for the create call. The API requires
        // `teamId` for `POST /api/v1/templates`. We rely on the standard
        // `/api/v1/auth/whoami` shape — the test seam (props.createClient)
        // returning a stub get/post lets tests drive this without a real
        // backend.
        let teamId: string | undefined;
        try {
          const me = await client.get<{
            data: { teamId?: string };
          }>("/api/v1/auth/whoami");
          teamId = me.data.teamId;
        } catch {
          // fall through — the create call will surface a clearer error
        }

        const scoringScale = ai.proposal?.scoringScale ?? {
          scaleType: "FIVE_POINT" as const,
          scaleMin: 1,
          scaleMax: 5,
        };

        await client.post("/api/v1/templates", {
          teamId,
          name: form.name,
          description: form.description,
          type: "rating",
          icon: "📋",
          scaleType: scoringScale.scaleType,
          scaleMin: scoringScale.scaleMin,
          scaleMax: scoringScale.scaleMax,
          isPrimary: false,
          openTextEnabled: false,
        });
        setToast({ kind: "success", message: `Created ${form.name}` });
      }
      setTimeout(() => setToast(null), 3000);
      setPhase("done");
      setTimeout(() => setScreen("templates-hub"), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      setPhase("review");
    }
  }

  useInput((input, key) => {
    if (key.escape && phase !== "saving") {
      setScreen("templates-hub");
      return;
    }
    if (input === "?" && phase !== "streaming" && phase !== "saving") {
      setMode((m) => (m === "describe" ? "form" : "describe"));
      setPhase("input");
      return;
    }

    if (phase === "input" && mode === "describe") {
      if (key.return && prompt.trim()) {
        ai.start(prompt.trim());
        return;
      }
      if (key.backspace || key.delete) {
        setPrompt((p) => p.slice(0, -1));
        return;
      }
      if (
        input &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        !key.tab
      ) {
        setPrompt((p) => p + input);
      }
      return;
    }

    if (phase === "input" && mode === "form") {
      if (key.tab) {
        const order: Array<keyof FormState> = [
          "name",
          "description",
          "dimensionName",
          "rubricsText",
        ];
        const idx = order.indexOf(activeFormField);
        const next = order[(idx + 1) % order.length]!;
        setActiveFormField(next);
        return;
      }
      if (key.return) {
        setPhase("review");
        return;
      }
      if (key.backspace || key.delete) {
        setForm((f) => ({
          ...f,
          [activeFormField]: f[activeFormField].slice(0, -1),
        }));
        return;
      }
      if (
        input &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow
      ) {
        setForm((f) => ({
          ...f,
          [activeFormField]: f[activeFormField] + input,
        }));
      }
      return;
    }

    if (phase === "streaming") {
      if (input === "c" || (key.ctrl && input === "c")) {
        ai.reset();
        setPhase("input");
      }
      return;
    }

    if (phase === "review") {
      if (input === "a" || (key.return && !key.shift)) {
        void handleSave();
        return;
      }
      if (input === "e") {
        setMode("form");
        setPhase("input");
        setActiveFormField("name");
        return;
      }
      if (input === "t") {
        ai.reset();
        setPrompt("");
        setForm({
          name: "",
          description: "",
          dimensionName: "",
          rubricsText: "",
        });
        setMode("describe");
        setPhase("input");
        return;
      }
    }
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box paddingBottom={1}>
        <Text bold color={Theme.brand}>
          {editingTemplateId ? "Edit" : "Create"} template
        </Text>
        <Text dimColor>
          {"  "}({mode} mode · ? toggles)
        </Text>
      </Box>

      {phase === "input" && mode === "describe" ? (
        <DescribePane prompt={prompt} streamError={ai.error} />
      ) : null}

      {phase === "input" && mode === "form" ? (
        <FormPane form={form} active={activeFormField} />
      ) : null}

      {phase === "streaming" ? (
        <ThinkingPane thinking={ai.thinking} error={ai.error} />
      ) : null}

      {phase === "review" ? (
        <ReviewPane draft={ai.proposal} form={form} saveError={saveError} />
      ) : null}

      {phase === "saving" ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Saving…</Text>
        </Box>
      ) : null}

      {phase === "done" ? (
        <Box marginTop={1}>
          <Text color={Theme.success}>
            ✔ {editingTemplateId ? "Updated" : "Saved"}.
          </Text>
        </Box>
      ) : null}

      <Box paddingTop={1}>
        <Text dimColor>{footerHint(phase, mode)}</Text>
      </Box>
    </Box>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────────

function DescribePane({
  prompt,
  streamError,
}: {
  prompt: string;
  streamError: string | null;
}) {
  return (
    <Box flexDirection="column">
      <Text dimColor>
        Describe what you want to evaluate. Example: &quot;trust signals on a
        SaaS landing page&quot;, &quot;checkout flow friction&quot;.
      </Text>
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={Theme.brand}
        paddingX={1}
      >
        <Text color={Theme.brand} bold>
          {"❯ "}
        </Text>
        <Text>
          {prompt}
          <Text color={Theme.brand}>{"█"}</Text>
        </Text>
      </Box>
      {streamError ? (
        <Box marginTop={1}>
          <Text color={Theme.error}>Error: {streamError}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function FormPane({
  form,
  active,
}: {
  form: FormState;
  active: keyof FormState;
}) {
  const fields: Array<keyof FormState> = [
    "name",
    "description",
    "dimensionName",
    "rubricsText",
  ];
  return (
    <Box flexDirection="column" gap={0}>
      {fields.map((field) => (
        <Box key={field} flexDirection="row" gap={2}>
          <Box width={16}>
            <Text
              bold={active === field}
              color={active === field ? Theme.brand : undefined}
            >
              {active === field ? "❯ " : "  "}
              {field}:
            </Text>
          </Box>
          <Text wrap="wrap">{form[field] || <Text dimColor>—</Text>}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ThinkingPane({
  thinking,
  error,
}: {
  thinking: string;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <Text color={Theme.brand}>Thinking…</Text>
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexDirection="column"
      >
        <Text dimColor wrap="wrap">
          {thinking || "(waiting for the model)"}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={Theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ReviewPane({
  draft,
  form,
  saveError,
}: {
  draft: TemplateDraftProposal | null;
  form: FormState;
  saveError: string | null;
}) {
  const display = {
    name: form.name || draft?.name || "",
    description: form.description || draft?.description || "",
    dimensionName: form.dimensionName,
    suggestedDimensions: draft?.suggestedDimensions ?? [],
    suggestedRubrics: draft?.suggestedRubrics ?? [],
    scoringScale: draft?.scoringScale,
  };
  return (
    <Box flexDirection="column">
      <Text bold>Proposal</Text>
      <Box flexDirection="column" marginTop={1} gap={0}>
        <Box gap={2}>
          <Box width={16}>
            <Text bold>Name:</Text>
          </Box>
          <Text>{display.name}</Text>
        </Box>
        <Box gap={2}>
          <Box width={16}>
            <Text bold>Description:</Text>
          </Box>
          <Text wrap="wrap">{display.description}</Text>
        </Box>
        {display.scoringScale ? (
          <Box gap={2}>
            <Box width={16}>
              <Text bold>Scale:</Text>
            </Box>
            <Text>
              {display.scoringScale.scaleType} ({display.scoringScale.scaleMin}–
              {display.scoringScale.scaleMax})
            </Text>
          </Box>
        ) : null}
      </Box>
      {display.suggestedDimensions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Suggested dimensions ({display.suggestedDimensions.length})
          </Text>
          {display.suggestedDimensions.map((d, i) => (
            <Text key={i} dimColor wrap="wrap">
              · {d.name}: {d.description.slice(0, 100)}
            </Text>
          ))}
        </Box>
      ) : null}
      {display.suggestedRubrics.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Suggested rubrics
          </Text>
          {display.suggestedRubrics.map((r, i) => (
            <Text key={i} dimColor wrap="wrap">
              · {r.name}: {r.description.slice(0, 100)}
            </Text>
          ))}
        </Box>
      ) : null}
      {saveError ? (
        <Box marginTop={1}>
          <Text color={Theme.error}>Save error: {saveError}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function footerHint(phase: Phase, mode: Mode): string {
  if (phase === "input" && mode === "describe") {
    return "Type to describe · Enter send · ? toggle form mode · Esc cancel";
  }
  if (phase === "input" && mode === "form") {
    return "Tab next field · Enter review · ? toggle describe · Esc cancel";
  }
  if (phase === "streaming") {
    return "Streaming proposal… c to cancel · Esc back";
  }
  if (phase === "review") {
    return "a accept · e edit form · t try again · Esc cancel";
  }
  if (phase === "saving") return "Saving… please wait";
  if (phase === "done") return "Saved. Returning to hub…";
  return "";
}
