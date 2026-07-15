import type { ProviderError } from "./types";

// Failures must be surfaced as visible, plain-language text, never a
// silent no-op. One message per ProviderError kind.
export function describeProviderError(error: ProviderError): string {
  switch (error.kind) {
    case "auth":
      return `Authentication failed: ${error.message}. Check your API key.`;
    case "rate_limit":
      return error.retryAfterSeconds
        ? `Rate limited by the provider. Try again in ${error.retryAfterSeconds}s.`
        : "Rate limited by the provider. Try again shortly.";
    case "malformed_response":
      return `The provider returned an unusable response: ${error.message}`;
    case "provider_error":
      return `Provider error: ${error.message}`;
    case "network":
      return `Network request failed: ${error.message}`;
  }
}
