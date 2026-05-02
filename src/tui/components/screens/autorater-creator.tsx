/**
 * Wave 8 — AI-assisted autorater creator screen.
 *
 * The marquee Wave 8 surface. Two modes, toggled by `?`:
 *
 *   1. **Describe** (default) — user types a free-text persona
 *      description, presses Enter, the CLI POSTs to
 *      `/api/v1/autousers/draft-from-prompt` and streams the model's
 *      reasoning into a "Thinking..." pane. When the server emits the
 *      `proposal` SSE event, the proposal renders in a review pane
 *      with [Accept] / [Edit] / [Try again] / [Cancel] options.
 *
 *   2. **Form** (manual) — bare-bones name + description fields for
 *      users who already know what they want or whose connection
 *      doesn't allow streaming.
 *
 * Edit mode: when the store's `editingAutouserId` is set on mount, the
 * screen loads the existing autouser via `GET /api/v1/autousers/:id`
 * and pre-populates the form mode. The user can tweak fields and save
 * via PATCH instead of POST.
 *
 * Architecture: streaming is delegated to `useAiStream`
 * (cli/src/tui/hooks/use-ai-stream.ts) — an Ink-friendly fetch +
 * ReadableStream + manual SSE parser. We deliberately do NOT pull in
 * `@ai-sdk/react` because Ink renders to a terminal not the DOM, and
 * the React-specific hooks in that package don't fit. See the hook
 * file's docblock for the full rationale.
 */
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "@jrichman/ink";

import {
  createClientFromConfig,
  getResolvedBearer,
  type AutousersClient,
} from "../../../client.js";
import { getBaseUrl } from "../../../config.js";
import { useAiStream, type AutouserDraft } from "../../hooks/use-ai-stream.js";
import { useTUIStore } from "../../state.js";
import { Theme } from "../../theme.js";

// ─── Types ─────────────────────────────────────────────────────────────────

type Mode = "describe" | "form";
type Phase = "input" | "streaming" | "review" | "saving" | "done";

interface AutoraterCreatorProps {
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
  persona: string;
  criteria: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AutoraterCreator(props: AutoraterCreatorProps = {}) {
  const setScreen = useTUIStore((s) => s.setScreen);
  const editingAutouserId = useTUIStore((s) => s.editingAutouserId);
  const setEditingAutouserId = useTUIStore((s) => s.setEditingAutouserId);
  const setToast = useTUIStore((s) => s.setToast);

  const [mode, setMode] = useState<Mode>(
    editingAutouserId ? "form" : "describe"
  );
  const [phase, setPhase] = useState<Phase>("input");
  const [prompt, setPrompt] = useState("");
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    persona: "",
    criteria: "",
  });
  const [activeFormField, setActiveFormField] =
    useState<keyof FormState>("name");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bearer, setBearer] = useState<string | null>(props.bearer ?? null);
  const [baseUrl, setBaseUrl] = useState<string>(
    props.baseUrl ?? "https://app.autousers.ai"
  );

  const ai = useAiStream({
    bearer: bearer ?? undefined,
    baseUrl,
    fetchImpl: props.fetchImpl,
  });

  // Resolve bearer + base URL on mount unless overridden via props (tests).
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

  // Edit-mode prefetch. On success, drop the user on the review pane
  // with the loaded fields populated; pressing `e` from there enters
  // form-edit mode. On failure, surface the error on the review pane —
  // empty input fields with no error message would make the screen
  // look broken (the bug the user reported on first real login).
  useEffect(() => {
    if (!editingAutouserId) return;
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
            systemPrompt?: string;
            capabilities?: { criteria?: string; persona?: string } | null;
          };
        }>(`/api/v1/autousers/${encodeURIComponent(editingAutouserId)}`);
        if (cancelled) return;
        const row = env.data;
        const caps =
          row.capabilities && typeof row.capabilities === "object"
            ? (row.capabilities as Record<string, unknown>)
            : {};
        setForm({
          name: row.name,
          description: row.description ?? "",
          persona:
            (typeof caps.persona === "string" ? caps.persona : "") ||
            row.systemPrompt ||
            "",
          criteria: typeof caps.criteria === "string" ? caps.criteria : "",
        });
        setMode("form");
        setPhase("review");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setSaveError(`Failed to load autouser: ${msg}`);
        setMode("form");
        setPhase("review");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAutouserId]);

  // React to AI stream lifecycle — when status flips to "done" we
  // populate the form from the proposal and move to review phase.
  useEffect(() => {
    if (ai.status === "streaming" && phase !== "streaming") {
      setPhase("streaming");
    }
    if (ai.status === "done" && ai.proposal) {
      setForm({
        name: ai.proposal.name,
        description: ai.proposal.description,
        persona: ai.proposal.persona,
        criteria: ai.proposal.criteria,
      });
      setPhase("review");
    }
  }, [ai.status, ai.proposal, phase]);

  // Clear the editing id on unmount so subsequent visits to the screen
  // start fresh unless the hub explicitly seeds a row.
  useEffect(() => {
    return () => {
      setEditingAutouserId(null);
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

      const capabilities: Record<string, unknown> = {};
      if (form.persona) capabilities.persona = form.persona;
      if (form.criteria) capabilities.criteria = form.criteria;

      if (editingAutouserId) {
        await client.patch(
          `/api/v1/autousers/${encodeURIComponent(editingAutouserId)}`,
          {
            name: form.name,
            description: form.description,
            systemPrompt: form.persona,
            ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
          }
        );
        setToast({ kind: "success", message: `Updated ${form.name}` });
      } else {
        await client.post("/api/v1/autousers", {
          name: form.name,
          description: form.description,
          role: "autouser",
          systemPrompt: form.persona || form.description,
          isSystem: false,
          status: "published",
          visibility: "private",
          ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
        });
        setToast({ kind: "success", message: `Created ${form.name}` });
      }
      setTimeout(() => setToast(null), 3000);
      setPhase("done");
      // Slight delay so the user sees the success state before we route
      // back to the hub.
      setTimeout(() => setScreen("autoraters-hub"), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      setPhase("review");
    }
  }

  useInput((input, key) => {
    // Esc — back to hub at any time except mid-save.
    if (key.escape && phase !== "saving") {
      setScreen("autoraters-hub");
      return;
    }
    // ? — toggle mode unless we're actively streaming.
    if (input === "?" && phase !== "streaming" && phase !== "saving") {
      setMode((m) => (m === "describe" ? "form" : "describe"));
      setPhase("input");
      return;
    }

    // Phase-specific handlers.
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
      // Field nav with Tab; text into the active field.
      if (key.tab) {
        const order: Array<keyof FormState> = [
          "name",
          "description",
          "persona",
          "criteria",
        ];
        const idx = order.indexOf(activeFormField);
        const next = order[(idx + 1) % order.length]!;
        setActiveFormField(next);
        return;
      }
      if (key.return) {
        // Enter on the last field saves; otherwise transitions to review
        // pane so the user can confirm.
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
      // Allow cancel during streaming.
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
        // Try again — wipe state and go back to the prompt.
        ai.reset();
        setPrompt("");
        setForm({ name: "", description: "", persona: "", criteria: "" });
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
          {editingAutouserId ? "Edit" : "Create"} autouser
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
        <ReviewPane
          draft={
            ai.proposal ?? {
              name: form.name,
              description: form.description,
              persona: form.persona,
              criteria: form.criteria,
              suggestedRubrics: [],
              suggestedTemplates: [],
            }
          }
          form={form}
          saveError={saveError}
        />
      ) : null}

      {phase === "saving" ? (
        <Box marginTop={1}>
          <Text color={Theme.brand}>Saving…</Text>
        </Box>
      ) : null}

      {phase === "done" ? (
        <Box marginTop={1}>
          <Text color={Theme.success}>
            ✔ {editingAutouserId ? "Updated" : "Saved"}.
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
        Describe the autouser you want to create. Example: &quot;a busy parent
        shopping for car insurance, has 3 quotes open in tabs, getting impatient
        with jargon&quot;.
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
  return (
    <Box flexDirection="column" gap={0}>
      {(["name", "description", "persona", "criteria"] as const).map(
        (field) => (
          <Box key={field} flexDirection="row" gap={2}>
            <Box width={14}>
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
        )
      )}
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
  draft: AutouserDraft;
  form: FormState;
  saveError: string | null;
}) {
  // Form takes precedence when populated — that's the "edit" branch
  // where the user has tweaked the AI's proposal.
  const display: AutouserDraft = {
    name: form.name || draft.name,
    description: form.description || draft.description,
    persona: form.persona || draft.persona,
    criteria: form.criteria || draft.criteria,
    suggestedRubrics: draft.suggestedRubrics,
    suggestedTemplates: draft.suggestedTemplates,
  };
  return (
    <Box flexDirection="column">
      <Text bold>Proposal</Text>
      <Box flexDirection="column" marginTop={1} gap={0}>
        <Box gap={2}>
          <Box width={14}>
            <Text bold>Name:</Text>
          </Box>
          <Text>{display.name}</Text>
        </Box>
        <Box gap={2}>
          <Box width={14}>
            <Text bold>Description:</Text>
          </Box>
          <Text wrap="wrap">{display.description}</Text>
        </Box>
        <Box gap={2}>
          <Box width={14}>
            <Text bold>Persona:</Text>
          </Box>
          <Text wrap="wrap">{display.persona}</Text>
        </Box>
        <Box gap={2}>
          <Box width={14}>
            <Text bold>Criteria:</Text>
          </Box>
          <Text wrap="wrap">{display.criteria}</Text>
        </Box>
      </Box>
      {display.suggestedRubrics && display.suggestedRubrics.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Suggested rubrics
          </Text>
          {display.suggestedRubrics.map((r, i) => (
            <Text key={i} dimColor wrap="wrap">
              · {r.name}: {r.criteriaText.slice(0, 100)}
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
