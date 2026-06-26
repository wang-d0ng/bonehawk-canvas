import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../src/api/rateLimiter.js";

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2 });
    const next = vi.fn();
    const response = responseDouble();

    limiter({ ip: "127.0.0.1" } as never, response as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("rejects requests over the limit", () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const firstNext = vi.fn();
    const secondNext = vi.fn();
    const response = responseDouble();

    limiter({ ip: "127.0.0.1" } as never, responseDouble() as never, firstNext);
    limiter({ ip: "127.0.0.1" } as never, response as never, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

function responseDouble() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
}
