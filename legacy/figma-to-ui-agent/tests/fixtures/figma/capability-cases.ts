import type { FigmaRestCapabilityEvidence } from "../../../src/figma/capability-policy.ts";

export const capabilityCases = {
  allAvailable: {
    nodes: { readable: true },
    screenshot: { readable: true },
    assets: { readable: true, imageCount: 5 },
    variables: { readable: true },
  },
  variablesForbidden: {
    nodes: { readable: true },
    screenshot: { readable: true },
    assets: { readable: true, imageCount: 5 },
    variables: { httpStatus: 403, readable: false },
  },
  zeroImageFills: {
    nodes: { readable: true },
    screenshot: { readable: true },
    assets: { readable: true, imageCount: 0 },
    variables: { readable: false },
  },
  unreadableNodes: {
    nodes: { readable: false },
    screenshot: { readable: true },
    assets: { readable: true, imageCount: 5 },
    variables: { readable: true },
  },
  invalidScreenshotImage: {
    nodes: { readable: true },
    screenshot: { httpStatus: 200, readable: false },
    assets: { readable: true, imageCount: 5 },
    variables: { readable: true },
  },
  unreadableImageFills: {
    nodes: { readable: true },
    screenshot: { readable: true },
    assets: { readable: false, imageCount: 0 },
    variables: { readable: true },
  },
} satisfies Record<string, FigmaRestCapabilityEvidence>;
