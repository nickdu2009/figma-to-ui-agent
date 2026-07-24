export function normalizeOpenAiBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("openai_base_url_invalid");
  }

  if (url.protocol !== "https:") {
    throw new Error("openai_base_url_requires_https");
  }
  if (url.username || url.password) {
    throw new Error("openai_base_url_userinfo_forbidden");
  }
  if (url.search || url.hash) {
    throw new Error("openai_base_url_query_or_hash_forbidden");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname === "" ? "/v1" : pathname;
  return url.toString().replace(/\/$/, "");
}

export function buildOpenAiModelsConfig(baseUrl: string) {
  return {
    providers: {
      openai: {
        baseUrl: normalizeOpenAiBaseUrl(baseUrl),
        apiKey: "$OPENAI_API_KEY",
      },
    },
  };
}
