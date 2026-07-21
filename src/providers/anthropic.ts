import type { ProviderCallResult, ProviderConfig, ProviderError } from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicAdapterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicSuccessBody {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicErrorBody {
  error?: { type?: string; message?: string };
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapErrorResponse(response: Response, body: unknown): ProviderError {
  const errorBody = body as AnthropicErrorBody;
  const message = errorBody.error?.message ?? `Provider returned HTTP ${response.status}`;

  // Auth failure and rate limit are the two named categories that get
  // their own kind; every other non-2xx is a provider_error (not its own
  // named category, but a real, unavoidable one — e.g. invalid_request_error,
  // overloaded_error).
  if (response.status === 401) {
    return { kind: "auth", message };
  }
  if (response.status === 429) {
    return { kind: "rate_limit", message, retryAfterSeconds: parseRetryAfter(response) };
  }
  return { kind: "provider_error", message };
}

// Anthropic Messages API adapter. Uses the
// anthropic-dangerous-direct-browser-access header, which Anthropic added
// specifically to support BYOK client-side tools like this one — direct
// browser calls to api.anthropic.com are a supported, documented path,
// unlike OpenAI's API.
export function createAnthropicAdapter(config: ProviderConfig, options: AnthropicAdapterOptions = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "anthropic",
    async call(systemPrompt: string, userMessage: string): Promise<ProviderCallResult> {
      let response: Response;
      try {
        response = await fetchImpl(baseUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });
      } catch (err) {
        // Never reached an HTTP response at all (CORS block, offline, DNS failure).
        return {
          ok: false,
          error: { kind: "network", message: err instanceof Error ? err.message : "Network request failed" },
        };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          error: { kind: "malformed_response", message: "Provider returned a response that wasn't valid JSON." },
        };
      }

      if (!response.ok) {
        return { ok: false, error: mapErrorResponse(response, body) };
      }

      const successBody = body as AnthropicSuccessBody;
      const text = successBody.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");

      if (!text) {
        return {
          ok: false,
          error: { kind: "malformed_response", message: "Provider returned an empty response." },
        };
      }

      // real usage, when the provider includes it —
      // omitted (not zero-filled) if either field is missing/malformed, so
      // callers can tell "no data" apart from "genuinely zero tokens."
      const inputTokens = successBody.usage?.input_tokens;
      const outputTokens = successBody.usage?.output_tokens;
      const usage =
        typeof inputTokens === "number" && typeof outputTokens === "number" ? { inputTokens, outputTokens } : undefined;

      return { ok: true, text, usage };
    },
  };
}
