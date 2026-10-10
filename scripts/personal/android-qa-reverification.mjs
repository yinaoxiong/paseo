import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { personalVersion, repoRoot } from "./build-info.mjs";

export const androidQaVerifyScope = "android-qa-verify";
// These files drive verification, not the packaged app. The excluded workflow's
// actual QA build definition and global build environment are checked separately.
const verifierFiles = new Set([
  ".github/workflows/personal-build.yml",
  "docs/mobile-testing.md",
  "scripts/ci-workflow.test.mjs",
  "scripts/personal/trusted-source.mjs",
  "scripts/personal/android-qa-reverification.mjs",
  "scripts/personal/resolve-android-qa-candidate.mjs",
  "scripts/personal/verify-android-qa-input.mjs",
  "scripts/personal/android-ui-proof.mjs",
  "scripts/personal/smoke-android-release.mjs",
  "packages/app/maestro/android-release-connect.yaml",
  "packages/app/e2e/mobile/android-release/fixture.ts",
  "packages/app/e2e/fixtures/catalog-codex.mjs",
]);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isSha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
const isHash = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
export function androidQaRequest(input) {
  const requested = Boolean(input.runId || input.manifestHash);
  if (!requested && input.scope !== androidQaVerifyScope) return null;
  if (
    input.scope !== androidQaVerifyScope ||
    !/^[1-9][0-9]*$/.test(input.runId ?? "") ||
    !isHash(input.manifestHash) ||
    input.npmRunId ||
    input.macRunId ||
    input.npmManifestHash ||
    input.macArchiveHash
  )
    throw new Error(
      "Android QA reverification requires its exclusive scope and exact Run/manifest hash",
    );
  return { runId: input.runId, manifestHash: input.manifestHash };
}
function assertQaProducerRun(run) {
  if (
    run.repository?.full_name !== "yinaoxiong/paseo" ||
    run.workflow_id !== 377643758 ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/personal-build.yml" ||
    !["personal/stable", "integration/android-latex"].includes(run.head_branch) ||
    run.status !== "completed" ||
    !isSha(run.head_sha) ||
    !Number.isInteger(run.run_attempt) ||
    run.run_attempt < 1
  )
    throw new Error("Unapproved Android QA producer Run");
}
export function admitAndroidQaRun(run, jobs, artifacts) {
  assertQaProducerRun(run);
  const build = jobs.filter((j) => j.name === "android-qa-build");
  if (
    build.length !== 1 ||
    build[0].status !== "completed" ||
    build[0].conclusion !== "success" ||
    Number(build[0].run_id) !== Number(run.id) ||
    build[0].head_sha !== run.head_sha
  )
    throw new Error("Exact producer QA build job has not succeeded");
  const matches = artifacts.filter((a) => a.name === "personal-android-qa-x86_64");
  if (matches.length !== 1) throw new Error("Missing or ambiguous producer QA artifact");
  const artifact = matches[0];
  if (
    artifact.expired ||
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== run.head_sha ||
    artifact.workflow_run?.head_branch !== run.head_branch ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")
  )
    throw new Error("Expired or mismatched producer QA artifact");
  return {
    sourceSha: run.head_sha,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    artifactId: String(artifact.id),
    artifactDigest: artifact.digest,
  };
}
export function androidRuntimeTreeHash(sha, cwd = repoRoot) {
  if (!isSha(sha)) throw new Error("Invalid runtime source SHA");
  const entries = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", sha], {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  })
    .toString()
    .split("\0")
    .filter(Boolean);
  return sha256(
    entries
      .filter((entry) => {
        const name = entry.slice(entry.indexOf("\t") + 1);
        return !verifierFiles.has(name);
      })
      .join("\0"),
  );
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function androidBuildContractHash(workflow) {
  const job = workflow.jobs?.["android-qa-build"];
  if (!job?.steps?.length) throw new Error("Missing Android QA build contract");
  const build = structuredClone(job);
  delete build.if;
  return sha256(JSON.stringify(canonical({ env: workflow.env ?? {}, build })));
}
export function verifyAndroidQaArtifact(directory, context) {
  const cwd = context.cwd ?? repoRoot;
  const bytes = readFileSync(path.join(directory, "qa-build.json"));
  const manifestHash = sha256(bytes),
    meta = JSON.parse(bytes);
  if (context.manifestHash && manifestHash !== context.manifestHash)
    throw new Error("QA manifest hash mismatch");
  const root = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  const version = personalVersion(root.version, Number(context.revision ?? meta.revision));
  const identity = {
    schemaVersion: 1,
    sourceSha: context.payloadSha,
    kind: "emulator-qa-only",
    abi: "x86_64",
    buildType: "release",
    hermes: true,
    productionSigner: false,
    signature: "qa-debug-key",
  };
  if (
    !isSha(meta.sourceSha) ||
    Object.entries(identity).some(([key, value]) => meta[key] !== value)
  )
    throw new Error("QA payload identity mismatch");
  for (const key of ["upstreamVersion", "revision", "version", "appVersion", "androidVersionCode"])
    if (meta[key] !== version[key]) throw new Error(`QA version mismatch: ${key}`);
  if (context.runId && meta.githubRunId !== context.runId)
    throw new Error("QA producer Run mismatch");
  if (context.runAttempt && meta.githubRunAttempt !== context.runAttempt)
    throw new Error("QA producer attempt mismatch");
  if (sha256(readFileSync(path.join(cwd, "package-lock.json"))) !== meta.lockSha256)
    throw new Error("QA dependency lock mismatch");
  const productionPin = JSON.parse(
    readFileSync(new URL("./android-signing.json", import.meta.url), "utf8"),
  ).certificateSha256;
  if (!isHash(meta.signerSha256) || meta.signerSha256 === productionPin)
    throw new Error("QA must retain a non-production signer");
  if (meta.apk !== `paseo-qa-${version.version}-android-x86_64.apk` || !isHash(meta.apkSha256))
    throw new Error("Invalid QA APK filename/hash");
  const apk = path.join(directory, meta.apk);
  if (statSync(apk).size !== meta.apkBytes || sha256(readFileSync(apk)) !== meta.apkSha256)
    throw new Error("QA APK bytes mismatch");
  return { manifest: meta, manifestHash };
}
export function assertAndroidQaBinding(binding, artifact, verifierSha, cwd = repoRoot) {
  if (
    !isSha(verifierSha) ||
    binding.schemaVersion !== 1 ||
    binding.verifierSourceSha !== verifierSha ||
    binding.payloadSourceSha !== artifact.manifest.sourceSha ||
    binding.manifestSha256 !== artifact.manifestHash ||
    binding.apkSha256 !== artifact.manifest.apkSha256 ||
    !isHash(binding.runtimeInputSha256) ||
    !isHash(binding.buildContractSha256)
  )
    throw new Error("QA verification binding mismatch");
  if (
    androidRuntimeTreeHash(binding.payloadSourceSha, cwd) !== binding.runtimeInputSha256 ||
    androidRuntimeTreeHash(verifierSha, cwd) !== binding.runtimeInputSha256
  )
    throw new Error("App/native/build inputs changed; build a new QA APK");
}
