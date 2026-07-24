export type ProviderInputSummary = {
  hasImageInput: boolean;
  inputContentTypes: string[];
};

export function summarizeProviderInput(
  payload: unknown,
): ProviderInputSummary {
  if (!payload || typeof payload !== "object") {
    throw new Error("provider_payload_invalid:not_object");
  }

  const contentTypes = new Set<string>();
  let hasImageInput = false;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }

    const type = Reflect.get(value, "type");
    if (typeof type === "string") {
      contentTypes.add(type);
      if (type === "input_image" || type === "image") {
        hasImageInput = true;
      }
    }

    if (typeof Reflect.get(value, "image_url") === "string") {
      hasImageInput = true;
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  visit(Reflect.get(payload, "input"));

  return {
    hasImageInput,
    inputContentTypes: [...contentTypes].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}
