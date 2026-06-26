import { describe, expect, it, vi } from "vitest";
import { CanvasOAuthService } from "../src/auth/canvasOAuthService.js";
import { MemoryTokenStore } from "../src/auth/tokenStore.js";

describe("CanvasOAuthService", () => {
  it("builds the Canvas authorization URL", () => {
    const service = serviceWithFetch();

    const url = new URL(service.createAuthorizationUrl("state-123"));

    expect(url.origin).toBe("https://school.instructure.com");
    expect(url.pathname).toBe("/login/oauth2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("exchanges an OAuth code and stores a usable token", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const service = serviceWithFetch(fetchImpl as unknown as typeof fetch);

    await service.exchangeCode("session-1", "code-123");

    await expect(service.getUsableAccessToken("session-1")).resolves.toBe("access-token");
    const request = fetchImpl.mock.calls[0];
    expect(String(request?.[0])).toBe("https://school.instructure.com/login/oauth2/token");
    expect(String(request?.[1]?.body)).toContain("grant_type=authorization_code");
  });

  it("refreshes expired access tokens", async () => {
    const store = new MemoryTokenStore();
    await store.set({
      sessionId: "session-1",
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      canvasBaseUrl: "https://school.instructure.com",
      updatedAt: new Date().toISOString()
    });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          access_token: "new-token",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const service = serviceWithFetch(fetchImpl as unknown as typeof fetch, store);

    await expect(service.getUsableAccessToken("session-1")).resolves.toBe("new-token");
    const saved = await store.get("session-1");
    expect(saved?.refreshToken).toBe("refresh-token");
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain("grant_type=refresh_token");
  });

  it("requires a connected session for token use", async () => {
    const service = serviceWithFetch();

    await expect(service.getUsableAccessToken("missing")).rejects.toThrow("Connect Canvas");
  });

  it("rejects token exchange failures", async () => {
    const service = serviceWithFetch(async () =>
      new Response(JSON.stringify({ error: "bad" }), { status: 401 })
    );

    await expect(service.exchangeCode("session-1", "code")).rejects.toThrow("Canvas OAuth");
  });

  it("rejects auth URL creation when OAuth is not configured", () => {
    const service = new CanvasOAuthService(
      { canvasBaseUrl: "https://school.instructure.com" },
      new MemoryTokenStore()
    );

    expect(() => service.createAuthorizationUrl("state")).toThrow("Canvas OAuth is not configured");
  });
});

function serviceWithFetch(fetchImpl: typeof fetch = fetch, store = new MemoryTokenStore()) {
  return new CanvasOAuthService(
    {
      canvasBaseUrl: "https://school.instructure.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/api/auth/canvas/callback"
    },
    store,
    fetchImpl
  );
}
