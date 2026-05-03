/**
 * Single-line text input for the TUI.
 *
 * Ported from uxrater's `cli/components/inline-text-input.tsx`. Used by
 * Wave 3+ wizard / modal flows; lives here from Wave 2 because it has no
 * upstream deps and the port is trivial.
 */
import { useState } from "react";
import { Text, useInput } from "@jrichman/ink";

interface InlineTextInputProps {
  placeholder?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function InlineTextInput({
  placeholder = "",
  defaultValue = "",
  onChange,
  onSubmit,
}: InlineTextInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [cursor, setCursor] = useState(defaultValue.length);

  const updateValue = (newValue: string) => {
    setValue(newValue);
    onChange?.(newValue);
  };

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const newVal = value.slice(0, cursor - 1) + value.slice(cursor);
        updateValue(newVal);
        setCursor((c) => c - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }

    // Ignore control sequences
    if (
      key.upArrow ||
      key.downArrow ||
      key.tab ||
      key.escape ||
      (key.ctrl && input === "c")
    ) {
      return;
    }

    // Insert printable character
    if (input) {
      const newVal = value.slice(0, cursor) + input + value.slice(cursor);
      updateValue(newVal);
      setCursor((c) => c + input.length);
    }
  });

  if (value.length === 0) {
    // Show placeholder with cursor
    return (
      <Text>
        <Text inverse> </Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  // Render value with cursor
  const before = value.slice(0, cursor);
  const at = value[cursor] || " ";
  const after = cursor < value.length ? value.slice(cursor + 1) : "";

  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}
