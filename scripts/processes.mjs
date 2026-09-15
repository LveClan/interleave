import { spawn, spawnSync } from "node:child_process";

export function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
}

export class Processes {
  children = new Set();
  closing = false;
  spawn(executable, args, options = {}) {
    if (this.closing) throw new Error("Cannot start another subprocess during shutdown.");
    const child = spawn(executable, args, {
      stdio: "inherit",
      shell: false,
      detached: process.platform !== "win32",
      ...options,
    });
    this.children.add(child);
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${executable} exited with ${code ?? signal}`));
      });
    });
    // Long-lived children may fail while another build step is being awaited.
    done.catch(() => {});
    return { child, done };
  }
  async run(executable, args, options) {
    await this.spawn(executable, args, options).done;
  }
  close() {
    this.closing = true;
    for (const child of this.children) stopTree(child);
    this.children.clear();
  }
  handleSignals() {
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      process.once(signal, () => {
        this.close();
        process.exit(code);
      });
    }
  }
}
