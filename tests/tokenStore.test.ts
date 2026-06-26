import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileTokenStore, MemoryTokenStore, type StoredCanvasToken } from "../src/auth/tokenStore.js";

describe("MemoryTokenStore", () => {
  it("sets, gets, and deletes tokens", async () => {
    const store = new MemoryTokenStore();
    const token = tokenFor("session-1");

    await store.set(token);
    await expect(store.get("session-1")).resolves.toEqual(token);
    await store.delete("session-1");
    await expect(store.get("session-1")).resolves.toBeUndefined();
  });
});

describe("FileTokenStore", () => {
  it("persists tokens to disk", async () => {
    const filePath = await tokenPath();
    const store = new FileTokenStore(filePath);
    const token = tokenFor("session-1");

    await store.set(token);

    await expect(new FileTokenStore(filePath).get("session-1")).resolves.toEqual(token);
    await expect(readFile(filePath, "utf8")).resolves.toContain("session-1");
  });

  it("returns undefined when the file does not exist", async () => {
    const store = new FileTokenStore(await tokenPath());

    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  it("removes the token file when the final session is deleted", async () => {
    const filePath = await tokenPath();
    const store = new FileTokenStore(filePath);
    await store.set(tokenFor("session-1"));

    await store.delete("session-1");

    await expect(store.get("session-1")).resolves.toBeUndefined();
  });

  it("keeps other sessions when one session is deleted", async () => {
    const filePath = await tokenPath();
    const store = new FileTokenStore(filePath);
    await store.set(tokenFor("session-1"));
    await store.set(tokenFor("session-2"));

    await store.delete("session-1");

    await expect(store.get("session-1")).resolves.toBeUndefined();
    await expect(store.get("session-2")).resolves.toMatchObject({ sessionId: "session-2" });
  });
});

async function tokenPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "canvas-token-store-")), "tokens.json");
}

function tokenFor(sessionId: string): StoredCanvasToken {
  return {
    sessionId,
    accessToken: `access-${sessionId}`,
    refreshToken: `refresh-${sessionId}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    canvasBaseUrl: "https://school.instructure.com",
    updatedAt: new Date().toISOString()
  };
}
