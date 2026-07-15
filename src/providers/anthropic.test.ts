import { describe, expect, it, vi } from "vitest";
import { createAnthropicAdapter } from "./anthropic";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("createAnthropicAdapter", () => {
  it("sends the correct request shape and headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: [{ type: "text", text: "Hi there." }] }),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    await adapter.call("system prompt text", "user message text");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("system prompt text");
    expect(body.messages).toEqual([{ role: "user", content: "user message text" }]);
    expect(body.max_tokens).toBe(4096);
  });

  it("returns ok:true with concatenated text on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        content: [
          { type: "text", text: "Part one. " },
          { type: "text", text: "Part two." },
        ],
      }),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({ ok: true, text: "Part one. Part two." });
  });

  it("surfaces real usage when the provider includes it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        content: [{ type: "text", text: "Hi there." }],
        usage: { input_tokens: 123, output_tokens: 45 },
      }),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({ ok: true, text: "Hi there.", usage: { inputTokens: 123, outputTokens: 45 } });
  });

  it("omits usage (not zero-fills it) when the provider doesn't include it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "text", text: "Hi." }] }));
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toBeUndefined();
  });

  it("classifies HTTP 401 as an auth error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }),
    );
    const adapter = createAnthropicAdapter({ apiKey: "bad-key", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({ ok: false, error: { kind: "auth", message: "invalid x-api-key" } });
  });

  it("classifies HTTP 429 as a rate_limit error and surfaces retry-after", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        429,
        { error: { type: "rate_limit_error", message: "rate limited" } },
        { "retry-after": "30" },
      ),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({
      ok: false,
      error: { kind: "rate_limit", message: "rate limited", retryAfterSeconds: 30 },
    });
  });

  it("classifies other non-2xx responses as provider_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(529, { error: { type: "overloaded_error", message: "overloaded" } }),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({ ok: false, error: { kind: "provider_error", message: "overloaded" } });
  });

  it("classifies a non-JSON body as malformed_response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("classifies a 200 response with no text content as malformed_response (empty response)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }));
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("classifies a thrown fetch (e.g. CORS block) as a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = createAnthropicAdapter({ apiKey: "sk-test", model: "claude-sonnet-5" }, { fetchImpl });

    const result = await adapter.call("sys", "hi");
    expect(result).toEqual({ ok: false, error: { kind: "network", message: "Failed to fetch" } });
  });

  it("never mutates or reads the sheet — purely a text-in/text-out call", async () => {
    // No sheet/store dependency exists in this module at all; this test
    // documents that guarantee rather than exercising a mock.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "bad key" } }));
    const adapter = createAnthropicAdapter({ apiKey: "bad", model: "claude-sonnet-5" }, { fetchImpl });
    await adapter.call("sys", "hi");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
