export const VALIDATION_BASELINE = {
  policyVersion: "playwright-rgba-tolerance-v1",
  maxComparePixels: 20_000_000,
  maxChannelDelta: 8,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "zh-CN",
  timezoneId: "UTC",
  serviceWorkers: "block",
  fontFamily: "Arial, sans-serif",
  animationsDisabled: true,
  diffAlgorithm: "rgba_max_channel_delta_8",
} as const;
