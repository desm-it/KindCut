#!/usr/bin/env node
// Dev launcher: start the Vite renderer on a free port and point Electron at
// that same port. A hard-coded port (5173) made Electron load whatever already
// listened there — e.g. another project's dev server — whenever it was busy,
// because Vite silently moved to the next port while Electron did not.
//
// Set VITE_DEV_SERVER_PORT (or PORT) to force a specific port.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 5173;
const PORT_SCAN_LIMIT = 50;

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code ?? 0);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, HOST);
  });
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function pickPort() {
  const requested = Number(process.env.VITE_DEV_SERVER_PORT || process.env.PORT);
  if (Number.isInteger(requested) && requested > 0) {
    return requested;
  }
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_SCAN_LIMIT; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  return getEphemeralPort();
}

function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for the dev server at ${url}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

function viteCliPath() {
  // vite's package exports don't expose bin/vite.js, so locate it from the
  // package root instead of require.resolve("vite/bin/vite.js").
  const viteRoot = path.dirname(require.resolve("vite/package.json"));
  const cli = path.join(viteRoot, "bin", "vite.js");
  if (!fs.existsSync(cli)) {
    throw new Error(`Could not find the Vite CLI at ${cli}`);
  }
  return cli;
}

async function main() {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const port = await pickPort();
  const url = `http://${HOST}:${port}`;
  console.log(`[dev-shell] Starting renderer on ${url}`);

  // --strictPort: if the port is taken after all, fail loudly instead of moving
  // to another port that Electron would not know about.
  const vite = spawn(
    process.execPath,
    [viteCliPath(), "--host", HOST, "--port", String(port), "--strictPort"],
    { cwd: desktopRoot, stdio: "inherit", env: process.env },
  );
  children.push(vite);
  vite.on("exit", (code) => shutdown(code ?? 0));

  await waitForServer(url);

  console.log(`[dev-shell] Launching Electron with VITE_DEV_SERVER_URL=${url}`);
  const electron = spawn(require("electron"), ["."], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  children.push(electron);
  electron.on("exit", (code) => shutdown(code ?? 0));
}

main().catch((error) => {
  console.error(`[dev-shell] ${error instanceof Error ? error.stack || error.message : error}`);
  shutdown(1);
});
