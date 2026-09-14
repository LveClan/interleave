import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("./windows-onnx.cjs", import.meta.url), "utf8");

function loadHelper(platform: string) {
  const load = vi.fn(() => ({ unload: vi.fn() }));
  const resolve = vi.fn(() => "C:\\runtime\\onnxruntime-node\\dist\\index.js");
  const requireModule = Object.assign(
    vi.fn(() => ({ load })),
    { resolve },
  );
  const createRequire = vi.fn(() => requireModule);
  const module = { exports: {} as { preloadWindowsOnnx: (entry: string, koffi: string) => void } };
  runInNewContext(source, {
    module,
    process: { platform, arch: "x64" },
    require: (name: string) => {
      if (name === "node:module") return { createRequire };
      if (name === "node:path") return path.win32;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { preload: module.exports.preloadWindowsOnnx, load, resolve, createRequire };
}

describe("Windows ONNX DLL preload", () => {
  it.each(["darwin", "linux"])("does not resolve or load native DLLs on %s", (platform) => {
    const { preload, createRequire, load } = loadHelper(platform);
    preload("/runtime/transformers/index.js", "/runtime/koffi/index.js");
    expect(createRequire).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the DLL from the selected Transformers dependency graph once", () => {
    const { preload, createRequire, resolve, load } = loadHelper("win32");
    const entry = "C:\\model runtime\\transformers\\index.js";
    preload(entry, "C:\\model runtime\\koffi\\index.js");
    preload(entry, "C:\\model runtime\\koffi\\index.js");
    expect(createRequire).toHaveBeenCalledWith(entry);
    expect(resolve).toHaveBeenCalledWith("onnxruntime-node");
    expect(load).toHaveBeenCalledExactlyOnceWith(
      "C:\\runtime\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime.dll",
    );
  });

  it("reports a preload failure so the caller never imports the incompatible binding", () => {
    const { preload, load } = loadHelper("win32");
    load.mockImplementationOnce(() => {
      throw new Error("DLL missing");
    });
    expect(() => preload("C:\\transformers\\index.js", "C:\\koffi\\index.js")).toThrow(
      "DLL missing",
    );
    preload("C:\\transformers\\index.js", "C:\\koffi\\index.js");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
