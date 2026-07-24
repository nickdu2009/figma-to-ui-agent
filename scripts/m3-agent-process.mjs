import { spawn } from "node:child_process";
import { resolve } from "node:path";

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

export function buildM3PiProcessArgs(baseArgs) {
  return [
    ...baseArgs,
    "--print",
    "--mode",
    "text",
    "--no-session",
  ];
}

export function runPiProcess({
  projectRoot,
  args,
  env,
  prompt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      resolve(projectRoot, "node_modules/.bin/pi"),
      args,
      {
        cwd: projectRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let terminationReason;
    let forceKillTimer;

    const terminate = (reason) => {
      if (terminationReason || child.exitCode !== null) {
        return;
      }
      terminationReason = reason;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 5_000);
      forceKillTimer.unref();
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        target.push(chunk);
      } else {
        terminate("output_limit");
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    const timeout = setTimeout(
      () => terminate("timeout"),
      timeoutMs,
    );
    timeout.unref();
    const forwardSignal = (signal) => {
      terminate(`parent_${signal.toLowerCase()}`);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };
    child.once("error", (error) => {
      cleanup();
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolveRun({
        code: code ?? 1,
        signal,
        terminationReason,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        terminate("stdin_error");
      }
    });
    child.stdin.end(prompt);
  });
}

export function redactAgentOutput(text, values = []) {
  let redacted = text;
  for (const value of values.filter(Boolean)) {
    redacted = redacted.replaceAll(value, "<redacted>");
  }
  return redacted
    .replace(/\bfigd_[A-Za-z0-9_-]{12,}\b/g, "<figma-token-redacted>")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "<api-key-redacted>");
}
