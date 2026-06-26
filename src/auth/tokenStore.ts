import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredCanvasToken {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  canvasBaseUrl: string;
  updatedAt: string;
}

export interface TokenStore {
  get(sessionId: string): Promise<StoredCanvasToken | undefined>;
  set(token: StoredCanvasToken): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredCanvasToken>();

  async get(sessionId: string): Promise<StoredCanvasToken | undefined> {
    return this.tokens.get(sessionId);
  }

  async set(token: StoredCanvasToken): Promise<void> {
    this.tokens.set(token.sessionId, token);
  }

  async delete(sessionId: string): Promise<void> {
    this.tokens.delete(sessionId);
  }
}

export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async get(sessionId: string): Promise<StoredCanvasToken | undefined> {
    const tokens = await this.readTokens();
    return tokens[sessionId];
  }

  async set(token: StoredCanvasToken): Promise<void> {
    const tokens = await this.readTokens();
    const nextTokens = {
      ...tokens,
      [token.sessionId]: token
    };
    await this.writeTokens(nextTokens);
  }

  async delete(sessionId: string): Promise<void> {
    const tokens = await this.readTokens();
    const { [sessionId]: _deleted, ...nextTokens } = tokens;

    if (Object.keys(nextTokens).length === 0) {
      await rm(this.filePath, { force: true });
      return;
    }

    await this.writeTokens(nextTokens);
  }

  private async readTokens(): Promise<Record<string, StoredCanvasToken>> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as Record<string, StoredCanvasToken>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeTokens(tokens: Record<string, StoredCanvasToken>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(tokens, null, 2)}\n`, {
      mode: 0o600
    });
  }
}
