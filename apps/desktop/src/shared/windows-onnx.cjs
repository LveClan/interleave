const { createRequire } = require("node:module");
const path = require("node:path");

// Keep the handle alive for the process lifetime while ORT uses the loaded library.
const libraries = new Map();

function preloadWindowsOnnx(transformersEntry, koffiEntry) {
  if (process.platform !== "win32") return;
  const runtimeRequire = createRequire(transformersEntry);
  const runtimeEntry = runtimeRequire.resolve("onnxruntime-node");
  const dll = path.resolve(
    path.dirname(runtimeEntry),
    "../bin/napi-v6/win32",
    process.arch,
    "onnxruntime.dll",
  );
  if (!libraries.has(dll)) {
    // An absolute preload prevents the binding from selecting Windows' older system ORT.
    const koffi = createRequire(koffiEntry)(koffiEntry);
    libraries.set(dll, koffi.load(dll));
  }
}

module.exports = { preloadWindowsOnnx };
