import type { DesignBundle } from "../../src/design-bundle/schema.ts";

export interface FontAssetStatus {
  status: "loading" | "ready" | "failed";
  registered: number;
  loaded: number;
  failed: number;
  missing: number;
  errors: string[];
}

declare global {
  interface Window {
    __FIGMA_TO_UI_FONT_STATUS__?: FontAssetStatus;
  }
}

export function setFontStatus(status: FontAssetStatus): void {
  window.__FIGMA_TO_UI_FONT_STATUS__ = status;
}

export async function loadRegisteredFonts(
  bundle: DesignBundle,
  fontUrl: (path: string) => string,
): Promise<FontAssetStatus> {
  const fonts = bundle.fonts ?? [];
  if (fonts.length === 0) {
    const ready = {
      status: "ready",
      registered: 0,
      loaded: 0,
      failed: 0,
      missing: 0,
      errors: [],
    } satisfies FontAssetStatus;
    setFontStatus(ready);
    return ready;
  }

  setFontStatus({
    status: "loading",
    registered: fonts.length,
    loaded: 0,
    failed: 0,
    missing: 0,
    errors: [],
  });

  const errors: string[] = [];
  let loaded = 0;
  let failed = 0;
  for (const font of fonts) {
    try {
      const face = new FontFace(
        font.family,
        `url(${fontUrl(font.path)})`,
        {
          weight: String(font.weight),
          style: font.style,
        },
      );
      const loadedFace = await face.load();
      document.fonts.add(loadedFace);
      loaded += 1;
    } catch (error) {
      failed += 1;
      errors.push(
        `${font.family} ${font.weight} ${font.style}: ${
          error instanceof Error ? error.message : "font_load_failed"
        }`,
      );
    }
  }
  await document.fonts.ready;
  const status = {
    status: failed > 0 ? "failed" : "ready",
    registered: fonts.length,
    loaded,
    failed,
    missing: 0,
    errors,
  } satisfies FontAssetStatus;
  setFontStatus(status);
  return status;
}
