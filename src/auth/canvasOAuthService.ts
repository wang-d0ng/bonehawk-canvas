import { randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "../lib/apiError.js";
import type { StoredCanvasToken, TokenStore } from "./tokenStore.js";

type FetchLike = typeof fetch;

export interface CanvasOAuthConfig {
  canvasBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class CanvasOAuthService {
  readonly canvasBaseUrl: string;

  constructor(
    private readonly config: CanvasOAuthConfig,
    private readonly tokenStore: TokenStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.canvasBaseUrl = config.canvasBaseUrl.replace(/\/+$/, "");
  }

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  createState(): string {
    return randomBytes(32).toString("base64url");
  }

  createSessionId(): string {
    return randomUUID();
  }

  createAuthorizationUrl(state: string): string {
    this.requireConfig();
    const url = new URL("/login/oauth2/auth", this.canvasBaseUrl);
    url.searchParams.set("client_id", this.config.clientId!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.config.redirectUri!);
    return url.toString();
  }

  async exchangeCode(sessionId: string, code: string): Promise<void> {
    this.requireConfig();
    const token = await this.requestToken({
      grant_type: "authorization_code",
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      redirect_uri: this.config.redirectUri!,
      code
    });

    if (!token.refresh_token) {
      throw new ApiError(502, "Canvas did not return a refresh token", "OAUTH_TOKEN_MISSING");
    }

    await this.tokenStore.set(toStoredToken(sessionId, this.canvasBaseUrl, token, token.refresh_token));
  }

  async getUsableAccessToken(sessionId: string): Promise<string> {
    const token = await this.tokenStore.get(sessionId);

    if (!token) {
      throw new ApiError(401, "Connect Canvas before using this feature.", "CANVAS_NOT_CONNECTED");
    }

    if (new Date(token.expiresAt).getTime() - Date.now() > 300_000) {
      return token.accessToken;
    }

    return this.refreshAccessToken(token);
  }

  async isConnected(sessionId: string | undefined): Promise<boolean> {
    return sessionId ? Boolean(await this.tokenStore.get(sessionId)) : false;
  }

  async disconnect(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.tokenStore.delete(sessionId);
  }

  private async refreshAccessToken(storedToken: StoredCanvasToken): Promise<string> {
    this.requireConfig();
    const token = await this.requestToken({
      grant_type: "refresh_token",
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      refresh_token: storedToken.refreshToken
    });

    const refreshed = toStoredToken(
      storedToken.sessionId,
      storedToken.canvasBaseUrl,
      token,
      storedToken.refreshToken
    );
    await this.tokenStore.set(refreshed);
    return refreshed.accessToken;
  }

  private async requestToken(params: Record<string, string>): Promise<OAuthTokenResponse> {
    const response = await this.fetchImpl(new URL("/login/oauth2/token", this.canvasBaseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(params)
    });

    if (!response.ok) {
      throw new ApiError(response.status, "Canvas OAuth token exchange failed", "OAUTH_TOKEN_FAILED");
    }

    return (await response.json()) as OAuthTokenResponse;
  }

  private requireConfig(): void {
    if (!this.isConfigured()) {
      throw new ApiError(501, "Canvas OAuth is not configured.", "OAUTH_NOT_CONFIGURED");
    }
  }
}

function toStoredToken(
  sessionId: string,
  canvasBaseUrl: string,
  token: OAuthTokenResponse,
  refreshToken: string
): StoredCanvasToken {
  return {
    sessionId,
    accessToken: token.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    canvasBaseUrl,
    updatedAt: new Date().toISOString()
  };
}
