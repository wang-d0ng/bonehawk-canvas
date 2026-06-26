import type { NextFunction, Request, Response } from "express";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const requests = new Map<string, number[]>();

  return (request: Request, response: Response, next: NextFunction) => {
    const identifier = request.ip ?? "unknown";
    const now = Date.now();
    const recent = (requests.get(identifier) ?? []).filter(
      (timestamp) => now - timestamp < options.windowMs
    );

    if (recent.length >= options.maxRequests) {
      response.status(429).json({
        success: false,
        error: "Too many requests. Please try again soon."
      });
      return;
    }

    requests.set(identifier, [...recent, now]);
    next();
  };
}
