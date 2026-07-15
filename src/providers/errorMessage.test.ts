import { describe, expect, it } from "vitest";
import { describeProviderError } from "./errorMessage";

describe("describeProviderError", () => {
  it("mentions the API key on auth errors", () => {
    expect(describeProviderError({ kind: "auth", message: "bad key" })).toContain("API key");
  });

  it("includes retryAfterSeconds when present on rate_limit errors", () => {
    expect(describeProviderError({ kind: "rate_limit", message: "slow down", retryAfterSeconds: 12 })).toContain(
      "12s",
    );
  });

  it("falls back to generic wording when retryAfterSeconds is absent", () => {
    expect(describeProviderError({ kind: "rate_limit", message: "slow down" })).not.toContain("undefined");
  });

  it("surfaces the provider's own message for provider_error and malformed_response", () => {
    expect(describeProviderError({ kind: "provider_error", message: "overloaded" })).toContain("overloaded");
    expect(describeProviderError({ kind: "malformed_response", message: "empty body" })).toContain("empty body");
  });
});
