type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function createReasoningSummaryObserver(
  label: string,
  write: (value: string) => void = (value) => process.stdout.write(value),
  maxCharacters = 20_000,
): (chunk: unknown) => void {
  let writtenCharacters = 0;
  let truncated = false;

  return (chunk: unknown) => {
    const parsed = record(chunk);
    if (parsed?.type === "reasoning-start") {
      write(`\n[reasoning-summary:${label}]\n`);
      return;
    }
    if (parsed?.type === "reasoning-end") {
      write("\n[/reasoning-summary]\n");
      return;
    }
    if (parsed?.type !== "reasoning-delta" || truncated) return;
    const text = record(parsed.payload)?.text;
    if (typeof text !== "string" || text.length === 0) return;
    const remaining = Math.max(0, maxCharacters - writtenCharacters);
    write(text.slice(0, remaining));
    writtenCharacters += Math.min(text.length, remaining);
    if (text.length > remaining) {
      truncated = true;
      write("\n[reasoning summary truncated]\n");
    }
  };
}
