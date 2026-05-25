import { describe, expect, test } from "vitest";
import { parseChatBody } from "./route";

/**
 * Tests for the `/api/chat` request body validator.
 *
 * Pre-validation, the POST handler did `(await req.json()) as { ... }`
 * with no defensive checks — malformed JSON or a missing `messages`
 * field produced an unhandled exception inside `convertToModelMessages`
 * and surfaced as a generic 500. Pin the contract so bad input returns
 * a clean 400 with a single-line reason and stays out of the streaming
 * code path.
 */

describe("parseChatBody", () => {
  test("accepts a minimal valid body", () => {
    const result = parseChatBody({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.messages).toHaveLength(1);
      expect(result.body.model).toBeUndefined();
    }
  });

  test("accepts a body with an explicit model id and trims it", () => {
    const result = parseChatBody({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      model: "  Qwen3-8B  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.model).toBe("Qwen3-8B");
  });

  test("rejects non-object bodies", () => {
    for (const raw of [null, "hello", 42, true, [1, 2, 3]]) {
      const result = parseChatBody(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error).toMatch(/JSON object/);
      }
    }
  });

  test("rejects bodies whose `messages` is not an array", () => {
    const result = parseChatBody({ messages: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/messages.*array/);
    }
  });

  test("rejects bodies with non-object entries inside `messages`", () => {
    const result = parseChatBody({
      messages: [{ role: "user", parts: [] }, "oops"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/messages\[1\]/);
    }
  });

  test("accepts an empty messages array (handler delegates further checks to the AI SDK)", () => {
    const result = parseChatBody({ messages: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.messages).toEqual([]);
  });

  test("rejects legacy {role, content} messages with a 400 that names the v5 fix", () => {
    const result = parseChatBody({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/parts.*must be an array/);
      expect(result.error).toMatch(/UIMessage/);
    }
  });

  test("rejects messages where `parts` is present but not an array", () => {
    const result = parseChatBody({
      messages: [{ role: "user", parts: "hi" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/messages\[0\]\.parts/);
    }
  });

  test("rejects non-string `model` values", () => {
    const result = parseChatBody({ messages: [], model: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/model.*string/);
  });

  test("rejects empty / whitespace-only `model` values", () => {
    const result = parseChatBody({ messages: [], model: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/non-empty/);
  });
});
