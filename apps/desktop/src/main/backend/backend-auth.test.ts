import { describe, expect, it } from "vitest";
import { createLocalBackendToken, isLocalBackendToken } from "./backend-auth";

describe("desktop startup auth", () => {
  it("creates unpredictable protocol-compatible tokens without consulting the environment", () => {
    const first = createLocalBackendToken();
    const second = createLocalBackendToken();

    expect(first).not.toBe(second);
    expect(isLocalBackendToken(first)).toBe(true);
    expect(isLocalBackendToken(second)).toBe(true);
    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
  });

  it("rejects ambient or malformed credential values", () => {
    const ambient = "z".repeat(43);
    const previous = process.env.ADVX_LOCAL_TOKEN;
    process.env.ADVX_LOCAL_TOKEN = ambient;
    try {
      expect(createLocalBackendToken()).not.toBe(ambient);
    } finally {
      if (previous === undefined) delete process.env.ADVX_LOCAL_TOKEN;
      else process.env.ADVX_LOCAL_TOKEN = previous;
    }
    expect(isLocalBackendToken("short-token")).toBe(false);
    expect(isLocalBackendToken("a".repeat(129))).toBe(false);
  });
});
