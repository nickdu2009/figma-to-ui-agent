/**
 * ValidationProfileV1（设计 §11.5，计划 S9 动作 1）。
 *
 * P0 profile：
 * - 覆盖全部静态路由；每个动态路由取至少一个 staticParams（P0 取声明的
 *   第一条）；桌面 1440×900 与移动 390×844 两默认视口；
 * - case 总数 ≤ maxCases（512）：在启动浏览器前计算完整清单，超限以
 *   validation_case_limit_exceeded 拒绝；
 * - fatal 视觉阈值与 DS-GATE-00 校准夹具 fatal-visual-cases.v1.json
 *   （profileVersion fatal-visual-v1）逐项一致（contract 测试锁定）。
 */

export const VALIDATION_PROFILE_VERSION = "p0-validation-v1";
export const FATAL_VISUAL_PROFILE_VERSION = "fatal-visual-v1";
export const VALIDATION_MAX_CASES = 512;

export interface ValidationViewport {
  label: "desktop" | "mobile";
  width: number;
  height: number;
}

export const VALIDATION_VIEWPORTS: readonly ValidationViewport[] =
  Object.freeze([
    Object.freeze({ label: "desktop", width: 1440, height: 900 }),
    Object.freeze({ label: "mobile", width: 390, height: 844 }),
  ]);

/** fatal 视觉阈值（fatal-visual-cases.v1.json thresholds；勿单独改动）。 */
export interface FatalVisualThresholds {
  /** mainWidthRatio < 该值 → content_width_too_narrow */
  contentWidthMinRatio: number;
  /** verticalCollapseCount >= 该值 → vertical_text_collapse */
  verticalCollapseMinCount: number;
  /** maxOverlapRatio > 该值 → critical_overlap */
  overlapMinRatio: number;
  /** horizontalOverflowPx > 该值 → viewport_overflow */
  overflowMaxPx: number;
  /** maxClippedPx > 该值 → content_clipped */
  clippedMinPx: number;
  /** navMainGapPx > 该值 → navigation_content_detached */
  navGapMaxPx: number;
  /** maxBlankBandPx > 该值 → excessive_blank_region */
  blankBandMaxPx: number;
}

export const FATAL_VISUAL_THRESHOLDS_V1: FatalVisualThresholds = Object.freeze({
  contentWidthMinRatio: 0.2,
  verticalCollapseMinCount: 1,
  overlapMinRatio: 0.5,
  overflowMaxPx: 24,
  clippedMinPx: 64,
  navGapMaxPx: 320,
  blankBandMaxPx: 400,
});

/** 展开后的单个验证 case（路由 × 视口；动态路由带 staticParams）。 */
export interface ValidationCase {
  route: string;
  /** 动态路由的 staticParams（静态路由缺省）。 */
  params?: Record<string, string>;
  viewport: ValidationViewport;
}

export class ValidationCaseLimitError extends Error {
  readonly code = "validation_case_limit_exceeded";
  readonly caseCount: number;
  readonly maxCases: number;
  constructor(caseCount: number, maxCases: number) {
    super(`验证 case 数超限：${caseCount} > ${maxCases}`);
    this.caseCount = caseCount;
    this.maxCases = maxCases;
  }
}

interface BundleRouteSpec {
  staticParams?: Array<Record<string, string>>;
}

interface BundleSpecLike {
  routes?: Record<string, BundleRouteSpec>;
}

/**
 * 从 AppUiBundle 的 spec.routes 展开 P0 case 清单（确定性顺序：
 * 路由按字典序，每路由 desktop 后 mobile）。
 * 超限抛 ValidationCaseLimitError（启动浏览器前）。
 */
export function expandValidationCases(
  bundleSpec: BundleSpecLike,
  options?: { maxCases?: number },
): ValidationCase[] {
  const maxCases = options?.maxCases ?? VALIDATION_MAX_CASES;
  const routes = Object.keys(bundleSpec.routes ?? {}).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const baseCases: Array<Omit<ValidationCase, "viewport">> = [];
  for (const route of routes) {
    const spec = bundleSpec.routes?.[route];
    if (route.includes("[")) {
      // 动态路由：P0 取声明的第一条 staticParams（设计：至少一个）
      const first = spec?.staticParams?.[0];
      if (first) {
        baseCases.push({ route, params: { ...first } });
      }
      // 无 staticParams 的动态路由无法具体化：P0 不产生 case
      // （S11 静态 Gate 会拒绝缺 staticParams 的动态路由 Bundle）。
      continue;
    }
    baseCases.push({ route });
  }
  const cases: ValidationCase[] = [];
  for (const base of baseCases) {
    for (const viewport of VALIDATION_VIEWPORTS) {
      cases.push({ ...base, viewport });
    }
  }
  if (cases.length > maxCases) {
    throw new ValidationCaseLimitError(cases.length, maxCases);
  }
  return cases;
}
