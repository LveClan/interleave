/**
 * Renderer-protocol tests (T007 hardening).
 *
 * The `app://` handler is a security boundary: it serves the built renderer
 * read-only from `rendererDir` and must reject path traversal that escapes that
 * directory, while still falling back to `index.html` for SPA client routes.
 * Electron is mocked so the registered handler can be invoked directly with
 * crafted `Request` URLs (no Electron runtime needed); `net.fetch` is stubbed to
 * capture which on-disk file would be served.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProtocolHandler = (request: Request) => Response | Promise<Response>;
let registeredHandler: ProtocolHandler | null = null;
const netFetch = vi.fn(
  (url: string) => new Response("file-bytes", { headers: { "x-served": url } }),
);

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, handler: ProtocolHandler) => {
      registeredHandler = handler;
    },
  },
  net: { fetch: (url: string) => netFetch(url) },
}));

import { registerRendererProtocol } from "./renderer-protocol";

let rendererDir: string;

beforeEach(() => {
  rendererDir = fs.mkdtempSync(path.join(os.tmpdir(), "interleave renderer #100%-"));
  // A real built renderer: index.html + a hashed asset.
  fs.writeFileSync(path.join(rendererDir, "index.html"), "<!doctype html><div id=root></div>");
  fs.mkdirSync(path.join(rendererDir, "assets"));
  fs.writeFileSync(path.join(rendererDir, "assets", "app.js"), "console.log(1)");
  registeredHandler = null;
  netFetch.mockClear();
  registerRendererProtocol(rendererDir);
});

afterEach(() => {
  fs.rmSync(rendererDir, { recursive: true, force: true });
});

async function handle(url: string): Promise<Response> {
  if (!registeredHandler) throw new Error("handler not registered");
  return registeredHandler(new Request(url));
}

describe("registerRendererProtocol", () => {
  it("serves a real asset file from the renderer dir", async () => {
    const res = await handle("app://bundle/assets/app.js");
    expect(res.status).toBe(200);
    const served = res.headers.get("x-served") ?? "";
    expect(served).toBe(pathToFileURL(path.join(rendererDir, "assets", "app.js")).href);
  });

  it("preserves spaces, Unicode, and URL-reserved characters in file paths", async () => {
    const filename = "\u4e2d\u6587 #100%.js";
    const assetPath = path.join(rendererDir, "assets", filename);
    fs.writeFileSync(assetPath, "console.log(2)");

    const res = await handle(`app://bundle/assets/${encodeURIComponent(filename)}`);
    const served = new URL(res.headers.get("x-served") ?? "");
    expect(served.protocol).toBe("file:");
    expect(served.hash).toBe("");
    expect(served.search).toBe("");
    expect(fileURLToPath(served)).toBe(assetPath);
    expect(fs.readFileSync(served, "utf8")).toBe("console.log(2)");
  });

  it("serves index.html for the SPA root", async () => {
    await handle("app://bundle/");
    expect(netFetch).toHaveBeenCalledWith(pathToFileURL(path.join(rendererDir, "index.html")).href);
  });

  it("falls back to index.html for an unknown client route (SPA history routing)", async () => {
    await handle("app://bundle/review/session");
    expect(netFetch).toHaveBeenCalledWith(pathToFileURL(path.join(rendererDir, "index.html")).href);
  });

  it("rejects ENCODED path traversal that escapes the renderer dir with 403", async () => {
    // `%2e%2e%2f` survives URL parsing (the URL constructor does not collapse it),
    // so it reaches the handler as `../../` after decode — the guard must reject it.
    const res = await handle("app://bundle/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd");
    expect(res.status).toBe(403);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it("rejects an encoded traversal into a sensitive sibling file with 403", async () => {
    const res = await handle("app://bundle/assets%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fapp.sqlite");
    expect(res.status).toBe(403);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it("normalizes a plain `..` URL safely and falls back to index.html (no escape)", async () => {
    // The URL constructor collapses unescaped `..` against the host, so the
    // pathname is already `/etc/passwd` — it stays inside the renderer dir, is
    // not a real file, and serves index.html (SPA fallback). It never escapes.
    const res = await handle("app://bundle/../../../../etc/passwd");
    expect(res.status).toBe(200);
    expect(netFetch).toHaveBeenCalledWith(pathToFileURL(path.join(rendererDir, "index.html")).href);
  });
});
