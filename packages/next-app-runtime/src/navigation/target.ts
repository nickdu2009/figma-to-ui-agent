const DANGEROUS_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:"]);

export function resolveBrowserNavigationTarget(
  href: string,
  baseHref: string,
): URL | null {
  try {
    const target = new URL(href, baseHref);
    return DANGEROUS_PROTOCOLS.has(target.protocol.toLowerCase()) ? null : target;
  } catch {
    return null;
  }
}

export function isSameOriginHttpNavigationTarget(target: URL, origin: string): boolean {
  return (
    (target.protocol === "http:" || target.protocol === "https:") &&
    target.origin === origin
  );
}
