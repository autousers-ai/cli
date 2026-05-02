/**
 * Tiny markdown-ish renderer for prose results bodies.
 *
 * Ported verbatim from uxrater. Intentionally NOT using `react-markdown`
 * — that pulls in `remark`, `unified`, `mdast-util-*` and a fair chunk
 * of transitive deps (~600 KB unpacked). We only need bold, bullet lists,
 * numbered lists, and paragraph spacing, which is ~30 lines of regex.
 *
 * If we ever need tables / code blocks / links, the swap is:
 *   import ReactMarkdown from "react-markdown";
 *   <ReactMarkdown components={{ p: …, li: …, strong: … }}>{md}</ReactMarkdown>
 * but the bundle cost should be re-justified at that time.
 */
import React from "react";
import { Box, Text } from "@jrichman/ink";

/** Parse inline `**bold**` markers into React nodes. */
export function parseInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    result.push(
      <Text key={`b-${i}`} bold>
        {match[1]}
      </Text>
    );
    lastIndex = match.index + match[0].length;
    i++;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

/** Render markdown text with bold, lists, and paragraph spacing. */
export function MarkdownText({
  children,
  dimColor,
}: {
  children: string;
  dimColor?: boolean;
}) {
  const lines = children.split("\n");
  const elements: React.ReactNode[] = [];
  let prevEmpty = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      if (!prevEmpty) {
        elements.push(<Text key={`empty-${i}`}> </Text>);
      }
      prevEmpty = true;
      continue;
    }
    prevEmpty = false;

    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <Text key={`line-${i}`} wrap="wrap" dimColor={dimColor}>
          {"  "}
          {numMatch[1]}. {parseInline(numMatch[2])}
        </Text>
      );
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      elements.push(
        <Text key={`line-${i}`} wrap="wrap" dimColor={dimColor}>
          {"  • "}
          {parseInline(bulletMatch[1])}
        </Text>
      );
      continue;
    }

    elements.push(
      <Text key={`line-${i}`} wrap="wrap" dimColor={dimColor}>
        {parseInline(trimmed)}
      </Text>
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
}
