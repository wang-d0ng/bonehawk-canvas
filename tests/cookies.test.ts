import { describe, expect, it, vi } from "vitest";
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from "../src/auth/cookies.js";

describe("signed cookies", () => {
  it("writes and reads signed session cookies", () => {
    const response = responseDouble();
    writeSessionCookie(response as never, "session-123", { secret: "a".repeat(32) });
    const [name, value, options] = response.cookie.mock.calls[0];

    const request = {
      headers: {
        cookie: `${name}=${value}`
      }
    };

    expect(options.httpOnly).toBe(true);
    expect(readSessionCookie(request as never, { secret: "a".repeat(32) })).toBe("session-123");
  });

  it("rejects tampered session cookies", () => {
    const request = {
      headers: {
        cookie: "cw_session=session-123.bad"
      }
    };

    expect(readSessionCookie(request as never, { secret: "a".repeat(32) })).toBeUndefined();
  });

  it("clears session cookies", () => {
    const response = responseDouble();

    clearSessionCookie(response as never, { secret: "a".repeat(32) });

    expect(response.clearCookie).toHaveBeenCalledWith(
      "cw_session",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
  });
});

function responseDouble() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn()
  };
}
