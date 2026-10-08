import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localCliScratch } from "./cli-platform.mjs";
import { smokeCli } from "./smoke-cli.mjs";

const [directoryArg, reportArg] = process.argv.slice(2);
if (!directoryArg || !reportArg)
  throw new Error("Usage: validate-npm <candidate-directory> <report-file>");
const directory = path.resolve(directoryArg);
const reportFile = path.resolve(reportArg);
const info = JSON.parse(await readFile(path.join(directory, "manifest-npm.json"), "utf8"));
const expectedHash = process.env.PASEO_NPM_CANDIDATE_MANIFEST_SHA256;
if (expectedHash) {
  const actual = createHash("sha256")
    .update(await readFile(path.join(directory, "manifest-npm.json")))
    .digest("hex");
  if (
    actual !== expectedHash ||
    String(info.githubRunId) !== process.env.PASEO_NPM_CANDIDATE_RUN_ID
  )
    throw new Error("Candidate manifest/Run identity mismatch");
}
const scratch = await mkdtemp(path.join(await localCliScratch(os.tmpdir()), "paseo-registry-"));
const ready = path.join(scratch, "ready.json");
const fixtureLog = createWriteStream(path.join(scratch, "fixture.log"));
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL("./fixture-registry.mjs", import.meta.url)), directory, ready],
  { stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.pipe(fixtureLog, { end: false });
child.stderr.pipe(fixtureLog, { end: false });
let spawnError;
child.once("error", (error) => {
  spawnError = error;
});
let report;
let failure;
try {
  let state;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error("Fixture registry exited before ready");
    try {
      state = JSON.parse(await readFile(ready, "utf8"));
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!state) throw new Error("Fixture registry did not become ready");
  if (state.sourceSha !== info.sourceSha) throw new Error("Fixture source mismatch");
  const cli = info.packages.find((p) => p.key === "cli");
  const validation = await smokeCli(path.join(directory, cli.file), info, state.registry);
  report = {
    schemaVersion: 1,
    sourceSha: info.sourceSha,
    version: info.version,
    lockSha256: info.lockSha256,
    githubRunId: info.githubRunId ?? null,
    marker: info.marker ?? null,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    candidateAssets: info.assets,
    validation,
  };
} catch (error) {
  failure = error;
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    await exited;
    clearTimeout(timer);
  }
  fixtureLog.end();
}
if (failure) {
  console.error(`Fixture diagnostics retained at ${scratch}`);
  throw failure;
}
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(
  reportFile,
  JSON.stringify({ ...report, registryCleanup: "passed" }, null, 2) + "\n",
  { flag: "wx" },
);
await rm(scratch, { recursive: true, force: true });
console.log(`Online npm validation passed: ${reportFile}`);
