import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateNpmApproval,
  validatePublicationRequest,
  assertRegistryVersion,
  verifyNpmFiles,
  parseNpmPublishResult,
} from "./npm-publication.mjs";

const approval = validateNpmApproval(
  JSON.parse(await readFile(new URL("./npm-release-approved.json", import.meta.url))),
);
const selection = validatePublicationRequest(approval, process.env);
const [action, directoryArg, receiptsArg, key] = process.argv.slice(2);
const directory = path.resolve(directoryArg);
const receipts = path.resolve(receiptsArg);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const api = (route) =>
  JSON.parse(
    execFileSync("gh", ["api", `repos/${approval.repository}/${route}`], { encoding: "utf8" }),
  );
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const registryVersion = async (p) => {
  const response = await fetch(`${approval.registry}${encodeURIComponent(p.name)}/${p.version}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry GET failed: HTTP${response.status}`);
  return response.json();
};
const verifyLatest = async (p) => {
  const response = await fetch(`${approval.registry}${encodeURIComponent(p.name)}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Registry tag GET failed: HTTP${response.status}`);
  if ((await response.json())["dist-tags"]?.latest !== p.version)
    throw new Error(
      `Published version exists but latest differs for ${p.name}; stop and reconcile`,
    );
};
const save = async (name, value) => {
  await mkdir(receipts, { recursive: true });
  await writeFile(path.join(receipts, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
};
await verifyNpmFiles(directory, approval);
if (action === "verify") {
  const build = api(`actions/runs/${approval.buildRunId}`);
  if (
    build.repository.full_name !== approval.repository ||
    build.workflow_id !== approval.buildWorkflowId ||
    build.event !== "workflow_dispatch" ||
    build.head_branch !== "personal/stable" ||
    build.head_sha !== approval.payloadSource ||
    build.status !== "completed" ||
    build.conclusion !== "success"
  )
    throw new Error("Original accepted build is not successful or trusted");
  git("fetch", "--no-tags", "origin", approval.payloadSource);
  git(
    "merge-base",
    "--is-ancestor",
    "de796a7e2e7bc941fcf194346a043e2717bd8c5a",
    approval.payloadSource,
  );
  git("merge-base", "--is-ancestor", approval.payloadSource, process.env.GITHUB_SHA);
  git("fetch", "--no-tags", "origin", "personal/stable:refs/remotes/origin/personal/stable");
  git("merge-base", "--is-ancestor", process.env.GITHUB_SHA, "refs/remotes/origin/personal/stable");
  for (const p of approval.packages) {
    const value = await registryVersion(p);
    if (selection.confirmed.includes(p.key)) assertRegistryVersion(value, p);
    else if (value)
      throw new Error(`Version already exists; parent must reconcile ${p.name}@${p.version}`);
  }
  await save("preflight.json", {
    payloadSource: approval.payloadSource,
    publisherSource: process.env.GITHUB_SHA,
    buildRunId: approval.buildRunId,
    publisherRunId: process.env.GITHUB_RUN_ID,
    marker: process.env.PASEO_NPM_PUBLISH_MARKER,
    confirmed: selection.confirmed,
    tokens: selection.tokens,
    passed: true,
  });
  console.log("Exact accepted archives and prior native proofs verified; no package published");
} else if (action === "publish") {
  const preflight = JSON.parse(await readFile(path.join(receipts, "preflight.json")));
  if (
    !preflight.passed ||
    preflight.publisherRunId !== process.env.GITHUB_RUN_ID ||
    preflight.publisherSource !== process.env.GITHUB_SHA ||
    preflight.marker !== process.env.PASEO_NPM_PUBLISH_MARKER ||
    JSON.stringify(preflight.tokens) !== JSON.stringify(selection.tokens) ||
    JSON.stringify(preflight.confirmed) !== JSON.stringify(selection.confirmed)
  )
    throw new Error("Missing matching preflight receipt");
  const index = approval.packages.findIndex((p) => p.key === key);
  if (index < 0) throw new Error("Unexpected publication package");
  const p = approval.packages[index];
  const record = {
    id: `${p.name}@${p.version}`,
    packageKey: p.key,
    packageName: p.name,
    version: p.version,
    sha256: p.sha256,
    expectedIntegrity: p.integrity,
    distTag: approval.distTag,
    payloadSource: approval.payloadSource,
    publisherSource: process.env.GITHUB_SHA,
    buildRunId: approval.buildRunId,
    publisherRunId: process.env.GITHUB_RUN_ID,
    marker: process.env.PASEO_NPM_PUBLISH_MARKER,
    intentToken: selection.tokens[key] ?? null,
  };
  if (selection.confirmed.includes(key)) {
    assertRegistryVersion(await registryVersion(p), p);
    await verifyLatest(p);
    await save(`receipt-${key}.json`, {
      ...record,
      status: "already-confirmed",
      registryVerified: true,
    });
  } else {
    // The dependency order is enforced even if a workflow step is accidentally reordered.
    for (const dependency of approval.packages.slice(0, index))
      assertRegistryVersion(await registryVersion(dependency), dependency);
    if (await registryVersion(p))
      throw new Error("Version appeared after preflight; stop and reconcile");
    if (process.env.PASEO_NPM_AUTH_MODE === "bootstrap" && !process.env.NODE_AUTH_TOKEN)
      throw new Error("Configure PASEO_NPM_BOOTSTRAP_TOKEN before an approved first publication");
    if (process.env.PASEO_NPM_AUTH_MODE === "bootstrap") {
      const identity = spawnSync("npm", ["whoami", "--registry", approval.registry], {
        encoding: "utf8",
        timeout: 30000,
      });
      if (identity.status !== 0 || identity.stdout.trim() !== "yinaoxiong")
        throw new Error("Bootstrap token must authenticate the approved npm owner yinaoxiong");
    }
    await save(`intent-${key}.json`, { ...record, status: "submission-starting" });
    const result = spawnSync(
      "npm",
      [
        "publish",
        path.join(directory, p.file),
        "--ignore-scripts",
        "--access",
        "public",
        "--tag",
        "latest",
        "--registry",
        approval.registry,
        "--provenance",
        "--json",
      ],
      { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
    );
    let response;
    try {
      response = parseNpmPublishResult(result.stdout, p);
    } catch {
      /* Retain an uncertain result for parent lookup. */
    }
    const responseMatches = response?.id === record.id && response?.integrity === p.integrity;
    // Persist the direct result before another lookup or package submission. Never retry here.
    await save(`receipt-${key}.json`, {
      ...record,
      status: result.status === 0 && !result.error && responseMatches ? "submitted" : "unknown",
      exitCode: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
      responseId: response?.id ?? null,
      responseIntegrity: response?.integrity ?? null,
    });
    if (result.status !== 0 || result.error || !responseMatches)
      throw new Error(
        `Publication result uncertain for ${record.id}; parent must inspect the receipt and registry`,
      );
    assertRegistryVersion(await registryVersion(p), p);
    await verifyLatest(p);
    await save(`verified-${key}.json`, {
      ...record,
      status: "registry-verified",
      registryIntegrity: p.integrity,
      registryTag: "latest",
    });
  }
  console.log(`Publication receipt retained for ${record.id}`);
} else throw new Error("Expected verify or publish action");
