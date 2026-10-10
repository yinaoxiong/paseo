import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  relative as relativePath,
  join as joinPath,
  isAbsolute as isAbsolutePath,
} from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { load as loadYaml } from "js-yaml";
import { runInNewContext } from "node:vm";
import {
  cliTarget,
  assertMacScratchInfo,
  tarToolPath,
  installedCliPaths,
  windowsShimCommand,
  terminalProofCommand,
  terminalProofMatches,
} from "./personal/cli-platform.mjs";
import {
  npmManifest,
  pinDirectDependencies,
  rebrandExecutable,
  assertPackageFiles,
} from "./personal/npm-distribution.mjs";
import { windowsInstallerArgs } from "./personal/windows-install.mjs";
import {
  validateNpmApproval,
  assertRegistryVersion,
  parseNpmPublishResult,
  npmPublicationInputs,
} from "./personal/npm-publication.mjs";
import {
  trustedPersonalBase,
  assertTrustedPersonalSource,
  resolvePersonalDiffBase,
  resolvePersonalBuildBranch,
} from "./personal/trusted-source.mjs";

import { androidBuildScript } from "./personal/android-build-script.mjs";
import {
  androidQaRequest,
  androidDeliveryRequest,
  admitAndroidVerifiedQaRun,
  verifyAndroidDeliveryReport,
  assertAndroidDeliveryBinding,
  androidDeliveryProvenance,
  admitAndroidQaRun,
  androidRuntimeTreeHash,
  androidBuildContractHash,
  verifyAndroidQaArtifact,
  assertAndroidQaBinding,
  sha256 as hashQaBytes,
} from "./personal/android-qa-reverification.mjs";
import {
  assertHealthyAndroidUi,
  androidFrameChanged,
  androidUiNodes,
  assertAndroidPanelsClosed,
  assertAndroidFormulaFrameStable,
  assertAndroidDestination,
  androidFrameBrightness,
  androidCaptureOptions,
  androidInteriorHorizontalSwipe,
  assertAndroidThemeSample,
  androidQaLongFormulaRect,
  androidQaFormulaSwipeRect,
  androidQaWorkspaceRowId,
  assertAndroidWorkspaceSelected,
} from "./personal/android-ui-proof.mjs";
const repoRoot = new URL("../", import.meta.url);
test("Android APK reverification requires exclusive exact producer inputs", () => {
  assert.equal(androidQaRequest({ scope: "all" }), null);
  const input = { scope: "android-qa-verify", runId: "42", manifestHash: "a".repeat(64) };
  assert.deepEqual(androidQaRequest(input), { runId: "42", manifestHash: "a".repeat(64) });
  for (const patch of [
    { scope: "android-only" },
    { runId: "" },
    { manifestHash: "x" },
    { npmRunId: "9" },
    { macRunId: "8" },
  ])
    assert.throws(() => androidQaRequest({ ...input, ...patch }), /exclusive scope/);
});
test("QA producer admission requires its completed compilation, not overall native success", () => {
  const source = "a".repeat(40);
  const run = {
    id: 42,
    run_attempt: 1,
    repository: { full_name: "yinaoxiong/paseo" },
    workflow_id: 377643758,
    path: ".github/workflows/personal-build.yml",
    event: "workflow_dispatch",
    head_branch: "integration/android-latex",
    head_sha: source,
    status: "completed",
    conclusion: "failure",
  };
  const job = {
    name: "android-qa-build",
    run_id: 42,
    head_sha: source,
    status: "completed",
    conclusion: "success",
  };
  const artifact = {
    id: 99,
    name: "personal-android-qa-x86_64",
    expired: false,
    digest: "sha256:" + "b".repeat(64),
    workflow_run: { id: 42, head_sha: source, head_branch: run.head_branch },
  };
  assert.equal(admitAndroidQaRun(run, [job], [artifact]).sourceSha, source);
  for (const patch of [
    { event: "pull_request" },
    { head_branch: "pr/foreign" },
    { status: "in_progress" },
    { workflow_id: 2 },
    { repository: { full_name: "getpaseo/paseo" } },
  ])
    assert.throws(() => admitAndroidQaRun({ ...run, ...patch }, [job], [artifact]), /producer Run/);
  for (const patch of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_sha: "c".repeat(40) },
    { run_id: 7 },
  ])
    assert.throws(() => admitAndroidQaRun(run, [{ ...job, ...patch }], [artifact]), /build job/);
  assert.throws(() => admitAndroidQaRun(run, [job], [artifact, artifact]), /ambiguous/);
  for (const patch of [
    { expired: true },
    { digest: null },
    { workflow_run: { ...artifact.workflow_run, head_sha: "c".repeat(40) } },
  ])
    assert.throws(() => admitAndroidQaRun(run, [job], [{ ...artifact, ...patch }]), /artifact/);
});
test("QA build contract ignores only job admission while retaining actual compilation inputs", () => {
  const original = {
    env: { FLAG: "1" },
    jobs: { "android-qa-build": { if: "old", runs_on: "linux", steps: [{ run: "compile" }] } },
  };
  const revised = structuredClone(original);
  revised.jobs["android-qa-build"].if = "new QA-only exclusion";
  assert.equal(androidBuildContractHash(original), androidBuildContractHash(revised));
  revised.jobs["android-qa-build"].steps[0].run = "different compile";
  assert.notEqual(androidBuildContractHash(original), androidBuildContractHash(revised));
  revised.jobs["android-qa-build"].steps[0].run = "compile";
  revised.env.FLAG = "2";
  assert.notEqual(androidBuildContractHash(original), androidBuildContractHash(revised));
});
test("Exact QA artifact reuse detects app/dependency edits and keeps payload and verifier distinct", () => {
  const temp = mkdtempSync(joinPath(os.tmpdir(), "paseo-qa-input-test-"));
  const cwd = joinPath(temp, "source"),
    directory = joinPath(temp, "artifact");
  mkdirSync(cwd);
  mkdirSync(directory);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (file, body) => {
    mkdirSync(joinPath(cwd, file, ".."), { recursive: true });
    writeFileSync(joinPath(cwd, file), body);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=QA",
      "-c",
      "user.email=qa@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    put("package.json", '{"version":"0.11.2"}');
    put("package-lock.json", "{}");
    put("packages/app/src/example.ts", "old app");
    put("scripts/personal/smoke-android-release.mjs", "old verifier");
    const payloadSha = commit(),
      fingerprint = androidRuntimeTreeHash(payloadSha, cwd);
    put("scripts/personal/smoke-android-release.mjs", "new verifier");
    const verifierSha = commit();
    assert.notEqual(payloadSha, verifierSha);
    assert.equal(fingerprint, androidRuntimeTreeHash(verifierSha, cwd));
    const apk = Buffer.from("QA");
    const meta = {
      schemaVersion: 1,
      sourceSha: payloadSha,
      kind: "emulator-qa-only",
      abi: "x86_64",
      buildType: "release",
      hermes: true,
      productionSigner: false,
      signature: "qa-debug-key",
      signerSha256: "d".repeat(64),
      upstreamVersion: "0.11.2",
      revision: 4,
      version: "0.11.2+personal.4",
      appVersion: "0.11.2",
      androidVersionCode: 11002004,
      githubRunId: "42",
      githubRunAttempt: "1",
      lockSha256: hashQaBytes(Buffer.from("{}")),
      apk: "paseo-qa-0.11.2+personal.4-android-x86_64.apk",
      apkBytes: 2,
      apkSha256: hashQaBytes(apk),
    };
    const metadata = Buffer.from(JSON.stringify(meta));
    writeFileSync(joinPath(directory, "qa-build.json"), metadata);
    writeFileSync(joinPath(directory, meta.apk), apk);
    const context = {
      cwd,
      payloadSha,
      revision: 4,
      runId: "42",
      runAttempt: "1",
      manifestHash: hashQaBytes(metadata),
    };
    const artifact = verifyAndroidQaArtifact(directory, context);
    const binding = {
      schemaVersion: 1,
      payloadSourceSha: payloadSha,
      verifierSourceSha: verifierSha,
      manifestSha256: artifact.manifestHash,
      apkSha256: meta.apkSha256,
      runtimeInputSha256: fingerprint,
      buildContractSha256: "e".repeat(64),
    };
    assert.doesNotThrow(() => assertAndroidQaBinding(binding, artifact, verifierSha, cwd));
    assert.throws(
      () => verifyAndroidQaArtifact(directory, { ...context, manifestHash: "f".repeat(64) }),
      /manifest hash/,
    );
    assert.throws(
      () => verifyAndroidQaArtifact(directory, { ...context, runId: "43" }),
      /producer Run/,
    );
    assert.throws(
      () => verifyAndroidQaArtifact(directory, { ...context, revision: 5 }),
      /version mismatch/,
    );
    writeFileSync(joinPath(directory, meta.apk), "bad");
    assert.throws(() => verifyAndroidQaArtifact(directory, context), /APK bytes/);
    writeFileSync(joinPath(directory, meta.apk), apk);
    put("packages/app/src/example.ts", "changed app");
    const newApp = commit();
    assert.throws(
      () =>
        assertAndroidQaBinding({ ...binding, verifierSourceSha: newApp }, artifact, newApp, cwd),
      /inputs changed/,
    );
    put("packages/app/src/example.ts", "old app");
    put("package-lock.json", '{"changed":true}');
    const newLock = commit();
    assert.notEqual(androidRuntimeTreeHash(newLock, cwd), fingerprint);
    assert.throws(() => verifyAndroidQaArtifact(directory, context), /lock mismatch/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test("QA-only workflow never builds or signs and preflights explicit container inputs", () => {
  const w = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-build.yml", import.meta.url), "utf8"),
  );
  assert.ok(w.on.workflow_dispatch.inputs.build_scope.options.includes("android-qa-verify"));
  for (const name of ["cli", "npm-install", "android-qa-build"])
    assert.match(w.jobs[name].if, /build_scope != 'android-qa-verify'/);
  for (const name of ["desktop", "android"])
    assert.doesNotMatch(w.jobs[name].if, /android-qa-verify/);
  const qa = w.jobs["android-qa"];
  assert.match(qa.if, /needs.resolve.result == 'success'/);
  assert.match(qa.if, /build_scope == 'android-qa-verify'/);
  assert.doesNotMatch(JSON.stringify(qa), /secrets\.|android:builder:image|build-android-qa/);
  const download = qa.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
  assert.match(download.with["run-id"], /android_qa_run_id/);
  const start = qa.steps.find((s) => s.name === "Start native QA fixture");
  assert.match(start.run, /--remote-env "PASEO_ANDROID_QA_PAYLOAD_SHA=/);
  assert.ok(
    start.run.indexOf("verify-android-qa-input.mjs") < start.run.indexOf("npm run build:server"),
  );
});
test("fresh QA checkout remains clean after downloading inputs and writing its binding", () => {
  const workflow = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-build.yml", import.meta.url), "utf8"),
  );
  const download = workflow.jobs["android-qa"].steps.find((s) =>
    s.uses?.startsWith("actions/download-artifact@"),
  );
  const temp = mkdtempSync(joinPath(os.tmpdir(), "paseo-fresh-qa-checkout-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.excludesFile=/dev/null", ...args], {
      cwd: temp,
      encoding: "utf8",
    }).trim();
  try {
    git("init", "-q");
    writeFileSync(
      joinPath(temp, ".gitignore"),
      execFileSync("git", ["show", "HEAD:.gitignore"], { encoding: "utf8" }),
    );
    git("add", ".gitignore");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=QA",
      "-c",
      "user.email=qa@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const input = joinPath(temp, download.with.path);
    mkdirSync(input, { recursive: true });
    for (const name of ["qa-build.json", "qa-verification-input.json", "paseo-qa.apk"])
      writeFileSync(joinPath(input, name), "QA fixture");
    assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), "");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test("native QA rejects error pages and absent normal UI despite a surviving process", () => {
  const healthy =
    '<hierarchy><node resource-id="message-input-root" text="" bounds="[0,0][100,100]" /></hierarchy>';
  assert.doesNotThrow(() => assertHealthyAndroidUi(healthy, "message-input-root"));
  assert.throws(
    () =>
      assertHealthyAndroidUi(
        healthy.replace("[0,0][100,100]", "[-100,0][-1,100]"),
        "message-input-root",
      ),
    /Normal UI/,
  );
  assert.throws(() => assertHealthyAndroidUi(healthy, "android-math-webview"), /Normal UI/);
  assert.throws(
    () =>
      assertHealthyAndroidUi(
        healthy.replace("</hierarchy>", '<node resource-id="root-error-boundary" /></hierarchy>'),
        "message-input-root",
      ),
    /error boundary/,
  );
  assert.throws(
    () =>
      assertHealthyAndroidUi(
        healthy.replace('text=""', 'text="Object is not a function"'),
        "message-input-root",
      ),
    /error boundary/,
  );
  const before = Buffer.alloc(16 + 30 * 30 * 4);
  before.writeUInt32LE(30, 0);
  before.writeUInt32LE(30, 4);
  before.writeUInt32LE(1, 8);
  const after = Buffer.from(before);
  after.fill(255, 16);
  assert.equal(androidFrameChanged(before, before, [0, 0, 30, 30]), false);
  assert.equal(androidFrameChanged(before, after, [0, 0, 30, 30]), true);
  assert.throws(() => androidFrameChanged(before, after, [-1, 0, 30, 30]), /crop/);
});
test("native QA rejects visible panels and ignored navigation or appearance transitions", () => {
  const base =
    '<hierarchy><node resource-id="root" bounds="[0,0][300,600]" /><node resource-id="message-input-root" text="Plain QA ready." bounds="[0,300][300,500]" /></hierarchy>';
  const nodes = androidUiNodes(base);
  assert.doesNotThrow(() => assertAndroidPanelsClosed(nodes));
  assert.doesNotThrow(() =>
    assertAndroidDestination(nodes, { text: "Plain QA ready.", noMath: true }),
  );
  assert.throws(
    () => assertAndroidDestination(nodes, { text: "Math QA marker." }),
    /Destination text/,
  );
  const panel = androidUiNodes(
    base.replace(
      "</hierarchy>",
      '<node resource-id="sidebar-close" bounds="[0,0][30,30]" /></hierarchy>',
    ),
  );
  assert.throws(() => assertAndroidPanelsClosed(panel), /visible panel control/);
  const math = androidUiNodes(
    base.replace(
      "</hierarchy>",
      '<node resource-id="android-math-webview" bounds="[0,0][300,100]" /></hierarchy>',
    ),
  );
  assert.throws(() => assertAndroidDestination(math, { noMath: true }), /still visible/);
  assert.throws(
    () => assertAndroidFormulaFrameStable([0, 0, 300, 100], [30, 0, 330, 100]),
    /host moved/,
  );
  const dark = Buffer.alloc(16 + 30 * 30 * 4);
  dark.writeUInt32LE(30, 0);
  dark.writeUInt32LE(30, 4);
  dark.writeUInt32LE(1, 8);
  const light = Buffer.from(dark);
  light.fill(255, 16);
  assert.equal(androidFrameBrightness(dark, [0, 0, 30, 30]), 0);
  assert.equal(androidFrameBrightness(light, [0, 0, 30, 30]), 255);
});
test("native QA keeps normal motion and fills the current separate Host/Port inputs", () => {
  const w = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-build.yml", import.meta.url), "utf8"),
  );
  const emulator = w.jobs["android-qa"].steps.find((s) =>
    s.uses?.startsWith("ReactiveCircus/android-emulator-runner@"),
  );
  assert.equal(emulator.with["disable-animations"], false);
  const flow = readFileSync(
    new URL("../packages/app/maestro/android-release-connect.yaml", import.meta.url),
    "utf8",
  );
  assert.match(flow, /extendedWaitUntil:[\s\S]*direct-host-input/);
  assert.match(flow, /direct-host-input[\s\S]*QA_HOST[\s\S]*direct-port-input[\s\S]*QA_PORT/);
  assert.doesNotMatch(flow, /QA_ENDPOINT/);
});
test("native QA initializes only the fixture-owned workspace through a visible sidebar row", () => {
  const fixture = {
    serverId: "srv_qa",
    workspaceIds: { math: "wks_math" },
    routes: { math: "paseo-personal://h/srv_qa/workspace/wks_math?open=agent%3Atest" },
  };
  const id = androidQaWorkspaceRowId(fixture);
  assert.equal(id, "sidebar-workspace-row-srv_qa:wks_math");
  assert.throws(() => androidQaWorkspaceRowId({ ...fixture, serverId: "srv_other" }), /identity/);
  assert.throws(() => androidQaWorkspaceRowId({ ...fixture, workspaceIds: {} }), /identity/);
  const absent =
    '<hierarchy><node resource-id="root" bounds="[0,0][300,600]" /><node resource-id="menu-button" bounds="[0,0][50,50]" /></hierarchy>';
  assert.throws(() => assertHealthyAndroidUi(absent, id), /Normal UI/);
  const ready = absent.replace(
    "</hierarchy>",
    `<node resource-id="${id}" bounds="[0,50][300,100]" /></hierarchy>`,
  );
  assert.doesNotThrow(() => assertHealthyAndroidUi(ready, id));
  assert.throws(
    () => assertAndroidWorkspaceSelected(androidUiNodes(ready), fixture),
    /measured node/,
  );
  const selected =
    '<hierarchy><node resource-id="root" bounds="[0,0][300,600]" /><node resource-id="workspace-deck-entry-srv_qa:wks_math" bounds="[0,0][300,600]" /><node resource-id="workspace-header-menu-trigger" bounds="[250,0][300,50]" /></hierarchy>';
  assert.doesNotThrow(() => assertAndroidWorkspaceSelected(androidUiNodes(selected), fixture));
  assert.throws(
    () =>
      assertAndroidWorkspaceSelected(
        androidUiNodes(selected.replace("srv_qa:wks_math", "srv_other:wks_math")),
        fixture,
      ),
    /measured node/,
  );
  assert.throws(
    () =>
      assertAndroidWorkspaceSelected(
        androidUiNodes(selected.replace("workspace-header-menu-trigger", "menu-button")),
        fixture,
      ),
    /measured node/,
  );
  const stillOpen = selected.replace(
    "</hierarchy>",
    '<node resource-id="sidebar-close" bounds="[0,0][50,50]" /></hierarchy>',
  );
  assert.throws(
    () => assertAndroidWorkspaceSelected(androidUiNodes(stillOpen), fixture),
    /visible panel control/,
  );
});
test("native screenshot capture accepts a complete Pixel RGBA frame", () => {
  const command = [process.execPath, ["-e", "process.stdout.write(Buffer.alloc(1080*2400*4))"]];
  assert.throws(
    () => execFileSync(...command),
    (error) => error.code === "ENOBUFS",
  );
  assert.equal(execFileSync(...command, androidCaptureOptions).length, 1080 * 2400 * 4);
});
test("native QA shares optimized compilation and gates signer-bearing Android delivery", () => {
  assert.equal(
    androidBuildScript("x86_64").replace("x86_64", "arm64-v8a"),
    androidBuildScript("arm64-v8a"),
  );
  assert.match(androidBuildScript("x86_64"), /:app:createBundleReleaseJsAndAssets/);
  assert.throws(() => androidBuildScript("shell;evil"), /Unsupported/);
  const w = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-build.yml", import.meta.url), "utf8"),
  );
  assert.deepEqual(w.jobs.android.needs, ["resolve", "android-qa"]);
  for (const key of ["android-qa-build", "android-qa"]) {
    assert.doesNotMatch(JSON.stringify(w.jobs[key]), /secrets\./);
    assert.equal(w.jobs[key].permissions.contents, "read");
  }
  assert.deepEqual(w.jobs["android-qa"].needs, ["resolve", "android-qa-build"]);
  assert.match(JSON.stringify(w.jobs["android-qa"]), /android-emulator-runner@[a-f0-9]{40}/);
  assert.match(JSON.stringify(w.jobs["android-qa"]), /smoke-android-release/);
});
test("signed Android preview admits only its exact named candidate and frozen lineage", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const candidate = {
    eventName: "workflow_dispatch",
    ref: "refs/heads/integration/android-latex",
    buildScope: "android-only",
    sourceSha: head,
    workflowSha: head,
  };
  assert.equal(resolvePersonalBuildBranch(candidate), "integration/android-latex");
  assert.equal(
    resolvePersonalBuildBranch({ ...candidate, buildScope: "android-qa-verify" }),
    "integration/android-latex",
  );
  assert.equal(
    resolvePersonalBuildBranch({
      ...candidate,
      ref: "refs/heads/personal/stable",
      buildScope: "all",
    }),
    "personal/stable",
  );
  assert.throws(
    () => resolvePersonalBuildBranch({ ...candidate, eventName: "pull_request" }),
    /manual/,
  );
  assert.throws(
    () => resolvePersonalBuildBranch({ ...candidate, ref: "refs/heads/feature/unsafe" }),
    /branch/,
  );
  assert.throws(() => resolvePersonalBuildBranch({ ...candidate, buildScope: "all" }), /Android/);
  assert.throws(
    () => resolvePersonalBuildBranch({ ...candidate, sourceSha: trustedPersonalBase }),
    /exact/,
  );
  assert.throws(() =>
    resolvePersonalBuildBranch({
      ...candidate,
      sourceSha: trustedPersonalBase,
      workflowSha: trustedPersonalBase,
    }),
  );
});
test("replayed CI admits the reviewed overlay and handles absent or unrelated push bases", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Fork CI has the upstream commit through ancestry, but need not have its tag ref.
  const official = "75953250959979b8f088bbca8dbd6ee61d0151b1";
  assert.doesNotThrow(() => assertTrustedPersonalSource(head));
  assert.throws(() => assertTrustedPersonalSource(official));
  assert.throws(() => assertTrustedPersonalSource("3916a1e615bb8f084e418bc7f205ea8d4fc40255"));
  assert.throws(() => assertTrustedPersonalSource("personal/stable"), /Invalid personal/);
  assert.equal(resolvePersonalDiffBase(undefined), trustedPersonalBase);
  assert.equal(resolvePersonalDiffBase("0".repeat(40)), trustedPersonalBase);
  assert.equal(resolvePersonalDiffBase("f".repeat(40)), trustedPersonalBase);
  assert.equal(
    resolvePersonalDiffBase("3916a1e615bb8f084e418bc7f205ea8d4fc40255"),
    trustedPersonalBase,
  );
  assert.equal(resolvePersonalDiffBase(official), official);
  const result = spawnSync(process.execPath, ["scripts/personal/check-diff.mjs"], {
    encoding: "utf8",
    env: { ...process.env, PASEO_DIFF_BASE: "f".repeat(40) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(trustedPersonalBase));
});
test("npm batch inputs reject old upstream approvals and inconsistent or unsafe versions", () => {
  const accepted = JSON.parse(
    readFileSync(new URL("./personal/npm-release-approved.json", import.meta.url)),
  );
  const base = accepted.version.split("-personal.")[0];
  assert.deepEqual(npmPublicationInputs(accepted, base), {
    version: accepted.version,
    buildRunId: accepted.buildRunId,
    confirmation: `PUBLISH @yinaoxiong ${accepted.version}`,
  });
  assert.throws(() => npmPublicationInputs(accepted, "99.0.0"), /upstream version/);
  assert.throws(
    () => validateNpmApproval({ ...accepted, version: "0.11.2-personal.1000" }),
    /Invalid accepted/,
  );
  assert.throws(
    () => validateNpmApproval({ ...accepted, version: "0.11.2-personal.0" }),
    /Invalid accepted/,
  );
  assert.throws(
    () => validateNpmApproval({ ...accepted, version: "0.11.2-personal.1\nother" }),
    /Invalid accepted/,
  );
  const wrong = structuredClone(accepted);
  wrong.packages[0].version = "0.11.2-personal.999";
  assert.throws(() => validateNpmApproval(wrong), /Invalid package/);
});
test("publisher admits only the fixed personal batch and validates standard npm responses", () => {
  const accepted = JSON.parse(
    readFileSync(new URL("./personal/npm-release-approved.json", import.meta.url)),
  );
  assert.equal(validateNpmApproval(accepted), accepted);
  const wrongPackage = structuredClone(accepted);
  wrongPackage.packages[0].name = "@getpaseo/protocol";
  assert.throws(() => validateNpmApproval(wrongPackage), /Invalid package/);
  assert.throws(
    () => validateNpmApproval({ ...accepted, registry: "https://example.com/" }),
    /Invalid accepted/,
  );
  const p = accepted.packages[0];
  const response = {
    id: `${p.name}@${p.version}`,
    name: p.name,
    version: p.version,
    integrity: p.integrity,
  };
  assert.deepEqual(parseNpmPublishResult(JSON.stringify({ [p.name]: response }), p), response);
  assert.throws(() => parseNpmPublishResult(JSON.stringify(response), p), /Unexpected npm/);
  assert.throws(
    () =>
      parseNpmPublishResult(JSON.stringify({ [p.name]: { ...response, integrity: "wrong" } }), p),
    /Unexpected npm/,
  );
  assertRegistryVersion({ name: p.name, version: p.version, dist: { integrity: p.integrity } }, p);
  assert.throws(
    () =>
      assertRegistryVersion({ name: p.name, version: p.version, dist: { integrity: "wrong" } }, p),
    /Registry conflict/,
  );
});
test("npm publisher keeps publication manual, file-pinned and receipts between package submissions", () => {
  const workflow = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-npm-publish.yml", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.auth_mode.default, "trusted");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.auth_mode.options, [
    "bootstrap",
    "trusted",
  ]);
  const job = workflow.jobs.publish;
  assert.doesNotMatch(JSON.stringify(job.env), /\$\{\{\s*runner\./);
  const setup = job.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
  assert.equal(setup.with["registry-url"], "https://registry.npmjs.org");
  assert.equal(workflow.on.workflow_dispatch.inputs.operation_tokens, undefined);
  assert.equal(job.permissions["contents"], "read");
  assert.equal(job.permissions["actions"], "read");
  assert.equal(job.permissions["id-token"], "write");
  const publish = job.steps.filter((s) => s.id?.startsWith("publish_"));
  assert.deepEqual(
    publish.map((s) => s.id),
    ["publish_protocol", "publish_client", "publish_plugin", "publish_server", "publish_cli"],
  );
  for (const step of publish) {
    assert.match(step.run, /npm publish/);
    assert.match(step.run, /\$\{PASEO_NPM_VERSION\}/);
    assert.doesNotMatch(step.run, /publish-npm\.mjs/);
    assert.equal(step.env.PASEO_NPM_VERSION, "${{ steps.batch.outputs.version }}");
    assert.equal(
      step.env.NODE_AUTH_TOKEN,
      "${{ inputs.auth_mode == 'bootstrap' && secrets.PASEO_NPM_BOOTSTRAP_TOKEN || '' }}",
    );
    const next = job.steps[job.steps.indexOf(step) + 1];
    assert.match(next.uses, /^actions\/upload-artifact@/);
    assert.match(next.if, /always\(\)/);
  }
  assert.equal(
    job.steps.some((s) => s.run?.includes("npm ci") || s.run?.includes("build:")),
    false,
  );
  const batch = job.steps.find((s) => s.id === "batch");
  assert.equal(batch.run, "node scripts/personal/verify-npm-release.mjs --inputs");
  for (const step of job.steps.filter((s) => s.uses?.startsWith("actions/download-artifact"))) {
    assert.equal(step.with["run-id"], "${{ steps.batch.outputs.build_run_id }}");
    assert.ok(job.steps.indexOf(batch) < job.steps.indexOf(step));
  }
});
test("normal postinstall applies the upstream bounded NSIS per-user path copy", () => {
  const require = createRequire(import.meta.url);
  const template = readFileSync(
    joinPath(require.resolve("app-builder-lib/package.json"), "../templates/nsis/multiUser.nsh"),
    "utf8",
  );
  const macro = template.split("!macro setInstallModePerUser")[1].split("!macroend")[0];
  assert.match(macro, /KERNEL32::lstrcpynW\(w \.r0, p r2, i \$\{NSIS_MAX_STRLEN\}\)p/);
  assert.doesNotMatch(macro, /System::Store|&w\$\{NSIS_MAX_STRLEN\}/);
  assert.match(macro, /Push \$1[\s\S]*Push \$2[\s\S]*Pop \$2[\s\S]*Pop \$1/);
  assert.match(macro, /\$2 != 0[\s\S]*OLE32::CoTaskMemFree/);
});
test("npm fork keeps canonical imports, moves internal peers to explicit aliases and reuses upstream leaves", () => {
  const result = npmManifest(
    {
      name: "@getpaseo/plugin",
      version: "0.11.0",
      files: ["dist"],
      scripts: { install: "bad" },
      peerDependencies: {
        "@getpaseo/client": "0.11.0",
        "@getpaseo/protocol": "0.11.0",
        react: "~19.1.0",
      },
      dependencies: { "@getpaseo/relay": "*", "@getpaseo/highlight": "*" },
    },
    "0.11.0-personal.1",
    "0.11.0",
  );
  assert.equal(result.name, "@yinaoxiong/paseo-plugin");
  for (const key of ["protocol", "client", "plugin", "server", "cli"]) {
    const staged = npmManifest(
      { name: `@getpaseo/${key}`, version: "0.11.0" },
      "0.11.0-personal.1",
      "0.11.0",
    );
    assert.deepEqual(staged.repository, {
      type: "git",
      url: "git+https://github.com/yinaoxiong/paseo.git",
      directory: `packages/${key}`,
    });
  }
  assert.equal(
    result.dependencies["@getpaseo/client"],
    "npm:@yinaoxiong/paseo-client@0.11.0-personal.1",
  );
  assert.equal(
    result.dependencies["@getpaseo/protocol"],
    "npm:@yinaoxiong/paseo-protocol@0.11.0-personal.1",
  );
  assert.deepEqual(result.peerDependencies, { react: "~19.1.0" });
  assert.equal(result.dependencies["@getpaseo/relay"], "0.11.0");
  assert.equal(result.dependencies["@getpaseo/highlight"], "0.11.0");
  assert.equal(result.scripts, undefined);
  assert.equal(result.os, undefined);
  assert.equal(result.cpu, undefined);
});
test("npm executable identity changes do not rewrite canonical plugin imports", () => {
  const input =
    'import { start } from "@getpaseo/server/daemon-control"; if (packageJson.name !== "@getpaseo/server") return null;';
  const result = rebrandExecutable("cli", "dist/commands/daemon/local-daemon.js", input);
  assert.match(result, /from "@getpaseo\/server\/daemon-control"/);
  assert.match(result, /packageJson.name !== "@yinaoxiong\/paseo-server"/);
  assert.equal(
    rebrandExecutable(
      "server",
      "dist/server/server/plugins/plugin-sdk-specifiers.js",
      '"@getpaseo/plugin/server"',
    ),
    '"@getpaseo/plugin/server"',
  );
  assert.throws(
    () => rebrandExecutable("cli", "dist/commands/daemon/local-daemon.js", "unexpected"),
    /Missing expected/,
  );
  const manifest = {
    dependencies: {
      zod: "^4.0.0",
      "@getpaseo/client": "npm:@yinaoxiong/paseo-client@0.11.0-personal.1",
    },
  };
  pinDirectDependencies(manifest, "cli", {
    packages: { "node_modules/zod": { version: "4.4.3" } },
  });
  assert.equal(manifest.dependencies.zod, "4.4.3");
  assert.throws(
    () => assertPackageFiles([{ path: "node_modules/node-pty/build/pty.node" }]),
    /Unexpected bundled/,
  );
  assert.doesNotThrow(() =>
    assertPackageFiles([{ path: "node_modules/@opencode-ai/sdk/dist/index.js" }]),
  );
  assert.doesNotThrow(() =>
    assertPackageFiles([{ path: "dist/server/web-ui/assets/__node_modules/react/icon.png" }]),
  );
});
test("Mac scratch admits local disk filesystems and rejects remote or unknown storage", () => {
  assert.doesNotThrow(() => assertMacScratchInfo("/dev/disk3s1s1", "apfs"));
  assert.doesNotThrow(() => assertMacScratchInfo("/dev/disk2s1", "hfs"));
  assert.throws(() => assertMacScratchInfo("server:/share", "apfs"), /local APFS/);
  assert.throws(() => assertMacScratchInfo("/dev/disk2s1", "nfs"), /local APFS/);
  assert.throws(() => assertMacScratchInfo("/dev/disk2s1", "Directory"), /local APFS/);
});
test("standalone CLI targets reject unsupported architectures and map actual npm prefixes", () => {
  assert.equal(tarToolPath("win32", "C:\\Windows"), "C:\\Windows\\System32\\tar.exe");
  assert.equal(tarToolPath("linux"), "tar");
  assert.throws(() => tarToolPath("win32", "relative"), /system directory/);
  assert.equal(cliTarget("linux", "x64"), "linux-x64");
  assert.equal(cliTarget("darwin", "arm64"), "macos-arm64");
  assert.equal(cliTarget("win32", "x64"), "windows-x64");
  assert.throws(() => cliTarget("linux", "arm64"), /Unsupported/);
  assert.deepEqual(installedCliPaths("C:\\Temp\\space prefix", "win32"), {
    executable: "C:\\Temp\\space prefix\\paseo.cmd",
    package: "C:\\Temp\\space prefix\\node_modules\\@getpaseo\\cli",
  });
  assert.equal(
    installedCliPaths("/tmp/space prefix", "darwin").package,
    "/tmp/space prefix/lib/node_modules/@getpaseo/cli",
  );
});
test("standalone Terminal proof requires output plus a nonce, host and cwd receipt", () => {
  const expected = { nonce: "paseo-cli-test-123", hostname: "machine", cwd: "/tmp/space path" };
  assert.equal(terminalProofMatches(expected, expected, expected.nonce), true);
  assert.equal(terminalProofMatches(undefined, expected, expected.nonce), false);
  assert.equal(
    terminalProofMatches({ ...expected, hostname: "other" }, expected, expected.nonce),
    false,
  );
  assert.equal(
    terminalProofMatches({ ...expected, cwd: "/wrong" }, expected, expected.nonce),
    false,
  );
  assert.equal(
    terminalProofMatches({ ...expected, nonce: "stale" }, expected, expected.nonce),
    false,
  );
  assert.equal(terminalProofMatches(expected, expected, `prompt> ${expected.nonce}`), false);
  assert.equal(terminalProofMatches(expected, expected, expected.nonce + "-suffix"), false);
  const command = terminalProofCommand("/node with spaces/node", "/tmp/proof's file.cjs", "linux");
  assert.equal(command.includes(expected.nonce), false);
  const win = terminalProofCommand("C:\\Node Tools\\node.exe", "C:\\Temp\\proof file.cjs", "win32");
  assert.match(win, /-EncodedCommand [A-Za-z0-9+/=]+$/);
  assert.equal(win.includes(expected.nonce), false);
  assert.throws(() => windowsShimCommand("paseo.cmd", ["a\nsecond"]), /Unsafe/);
  assert.throws(() => windowsShimCommand("paseo.cmd", ["%PATH%"]), /Unsafe/);
});
test("packaged Terminal proof rejects command echo and failed hooks, accepts real output", () => {
  const require = createRequire(import.meta.url);
  const {
    getTerminalHookSmokeCommand,
    hasTerminalCompletionLine,
  } = require("../packages/desktop/e2e/terminal-smoke-proof.cjs");
  const marker = "paseo-packaged-terminal-smoke-123456";
  const command = getTerminalHookSmokeCommand(marker, "darwin");
  assert.equal(command.includes(marker), false);
  assert.equal(hasTerminalCompletionLine([command], marker), false);
  assert.equal(hasTerminalCompletionLine([`prompt> echo ${marker}`], marker), false);
  assert.equal(hasTerminalCompletionLine([marker.slice(0, 15), marker.slice(15)], marker), false);
  assert.equal(hasTerminalCompletionLine([`${marker}-extra`], marker), false);
  assert.equal(getTerminalHookSmokeCommand(marker, "win32").includes(marker), false);
  if (process.platform !== "win32") {
    const failed = spawnSync("/bin/sh", ["-c", command], {
      env: { ...process.env, PASEO_HOOK_CLI: "/usr/bin/false" },
      encoding: "utf8",
    });
    assert.notEqual(failed.status, 0);
    assert.equal(hasTerminalCompletionLine([command, ...failed.stdout.split("\n")], marker), false);
    const passed = spawnSync("/bin/sh", ["-c", command], {
      env: { ...process.env, PASEO_HOOK_CLI: "/usr/bin/true" },
      encoding: "utf8",
    });
    assert.equal(passed.status, 0);
    assert.equal(hasTerminalCompletionLine(passed.stdout.split("\n"), marker), true);
  }
});
test("Windows installer forces per-user mode and keeps NSIS directory last and unquoted", () => {
  assert.deepEqual(windowsInstallerArgs("C:\\Temp\\Personal App"), [
    "/S",
    "/currentuser",
    "/D=C:\\Temp\\Personal App",
  ]);
  for (const directory of ["relative", 'C:\\bad"path', "C:\\bad\npath"]) {
    assert.throws(() => windowsInstallerArgs(directory), /safe absolute Windows directory/);
  }
});
test(
  "CI root container trusts only its mounted checkout with foreign ownership",
  { skip: process.platform !== "linux" || process.getuid?.() !== 0 },
  () => {
    const temp = mkdtempSync(joinPath(os.tmpdir(), "paseo-ci-ownership-"));
    const repo = joinPath(temp, "repo");
    const home = joinPath(temp, "home");
    mkdirSync(repo);
    mkdirSync(home);
    const env = { ...process.env, HOME: home, GITHUB_ACTIONS: "true", RUNNER_TEMP: temp };
    delete env.SUDO_UID;
    try {
      execFileSync("git", ["init", repo], { env, stdio: "pipe" });
      execFileSync("chown", ["12345", repo, joinPath(repo, ".git")]);
      const refused = spawnSync("git", ["status", "--porcelain"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      assert.equal(refused.status, 128);
      assert.match(refused.stderr, /dubious ownership/);
      execFileSync(
        process.execPath,
        [new URL("scripts/personal/prepare-ci-container.mjs", repoRoot).pathname],
        { env },
      );
      const config = JSON.parse(
        readFileSync(joinPath(temp, "paseo-personal-ci-devcontainer.json"), "utf8"),
      );
      const trust = config.onCreateCommand.split(" && ")[0];
      assert.doesNotMatch(trust, /\*/);
      execFileSync("sh", ["-c", trust], { cwd: repo, env });
      assert.equal(
        execFileSync("git", ["status", "--porcelain"], { cwd: repo, env, encoding: "utf8" }),
        "",
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
test("personal desktop packages use manual fork releases and never official publishing", () => {
  const require = createRequire(import.meta.url);
  const config = require("../packages/desktop/electron-builder.personal.cjs");
  assert.deepEqual(config.publish, [
    { provider: "github", owner: "yinaoxiong", repo: "paseo", publishAutoUpdate: false },
  ]);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(isAbsolutePath(config.afterPack), true);
  assert.equal(isAbsolutePath(config.afterSign), true);
  assert.match(readFileSync(config.afterPack, "utf8"), /pruneNativeModules/);
  assert.match(readFileSync(config.afterSign, "utf8"), /smokePackagedDesktopApp/);
});

test("personal CI builds are manual, source pinned and least privileged", () => {
  const build = loadYaml(
    readFileSync(new URL(".github/workflows/personal-build.yml", repoRoot), "utf8"),
  );
  assert.deepEqual(Object.keys(build.on), ["workflow_dispatch"]);
  assert.deepEqual(build.permissions, { contents: "read" });
  const resolveIf = build.jobs.resolve.if;
  assert.match(resolveIf, /github.repository == 'yinaoxiong\/paseo'/);
  const context = {
    repository: "yinaoxiong/paseo",
    event_name: "workflow_dispatch",
    ref: "refs/heads/personal/stable",
  };
  assert.equal(
    runInNewContext(resolveIf, { github: context, inputs: { build_scope: "all" } }),
    true,
  );
  context.ref = "refs/heads/integration/android-latex";
  assert.equal(
    runInNewContext(resolveIf, { github: context, inputs: { build_scope: "all" } }),
    false,
  );
  assert.equal(
    runInNewContext(resolveIf, { github: context, inputs: { build_scope: "android-only" } }),
    true,
  );
  context.event_name = "pull_request";
  assert.equal(
    runInNewContext(resolveIf, { github: context, inputs: { build_scope: "android-only" } }),
    false,
  );
  for (const key of ["cli", "desktop", "android"]) {
    assert.deepEqual(
      build.jobs[key].needs,
      key === "android" ? ["resolve", "android-qa"] : "resolve",
    );
    assert.equal(build.jobs[key].steps[0].with.ref, "${{ needs.resolve.outputs.sha }}");
    assert.equal(build.jobs[key].steps[0].with["persist-credentials"], false);
  }
  assert.deepEqual(build.jobs.desktop.strategy.matrix.include, [
    { runner: "macos-14", target: "macos-arm64" },
    { runner: "windows-2025", target: "windows-x64" },
  ]);
  assert.equal(
    build.jobs.cli.if,
    "inputs.mac_archive_run_id == '' && inputs.npm_candidate_run_id == '' && inputs.build_scope != 'android-only' && inputs.build_scope != 'android-qa-verify' && inputs.build_scope != 'android-delivery-only'",
  );
  assert.match(build.jobs["npm-install"].if, /!cancelled\(\).*needs\.cli\.result/);
  assert.deepEqual(build.jobs["npm-install"].permissions, { contents: "read", actions: "read" });
  assert.equal(
    build.jobs.desktop.if,
    "inputs.mac_archive_run_id == '' && inputs.build_scope == 'all'",
  );
  assert.match(build.jobs.android.if, /needs\.resolve\.result == 'success'/);
  assert.match(build.jobs.android.if, /needs\['android-qa'\]\.result == 'success'/);
  assert.match(build.jobs.android.if, /delivery_binding_sha != ''/);
  assert.deepEqual(build.on.workflow_dispatch.inputs.build_scope.options, [
    "all",
    "online-verify",
    "android-only",
    "android-qa-verify",
    "android-delivery-only",
  ]);
  assert.equal(build.on.workflow_dispatch.inputs.build_scope.default, "all");
  assert.deepEqual(build.jobs["npm-install"].needs, ["resolve", "cli"]);
  assert.deepEqual(build.jobs["npm-install"].strategy.matrix.include, [
    { runner: "ubuntu-24.04", target: "linux-x64" },
    { runner: "macos-14", target: "macos-arm64" },
    { runner: "windows-2025", target: "windows-x64" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(build.jobs["npm-install"]),
    /secrets\.|build:server|personal:desktop/,
  );
  assert.match(JSON.stringify(build.jobs["npm-install"]), /personal-npm-candidates/);
  const verification = build.jobs["mac-archive-verification"];
  assert.equal(
    verification.if,
    "inputs.mac_archive_run_id != '' && inputs.build_scope != 'android-only'",
  );
  assert.equal(verification.needs, "resolve");
  assert.deepEqual(verification.permissions, { contents: "read", actions: "read" });
  assert.equal(verification.steps[0].with.ref, "${{ needs.resolve.outputs.sha }}");
  assert.doesNotMatch(JSON.stringify(verification), /secrets\./);
  assert.match(JSON.stringify(verification), /verify-mac-archive\.mjs/);
  const checks = loadYaml(
    readFileSync(new URL(".github/workflows/personal-checks.yml", repoRoot), "utf8"),
  );
  assert.deepEqual(checks.permissions, { contents: "read" });
  assert.deepEqual(checks.on.pull_request.branches, ["personal/stable"]);
  assert.ok(checks.on.push.branches.includes("integration/android-latex"));
  assert.doesNotMatch(JSON.stringify(checks), /secrets\./);
});
const ciWorkflowPath = new URL(".github/workflows/ci.yml", repoRoot);
test("personal build scope routes only the selected platform jobs", () => {
  const build = loadYaml(
    readFileSync(new URL(".github/workflows/personal-build.yml", repoRoot), "utf8"),
  );
  const scenarios = [
    {
      scope: "all",
      expected: ["cli", "npm-install", "desktop", "android-qa-build", "android-qa", "android"],
    },
    { scope: "online-verify", expected: ["cli", "npm-install"] },
    { scope: "android-only", expected: ["android-qa-build", "android-qa", "android"] },
    { scope: "android-qa-verify", expected: ["android-qa"] },
    { scope: "android-delivery-only", expected: ["android"] },
    { scope: "all", mac: "123", expected: ["mac-archive-verification"] },
    { scope: "online-verify", candidate: "123", expected: ["npm-install"] },
    { scope: "android-only", mac: "123", expected: [] },
  ];
  for (const { scope, mac = "", candidate = "", expected } of scenarios) {
    const selected = Object.entries(build.jobs)
      .filter(([id]) => id !== "resolve")
      .filter(([, job]) => {
        // These job guards use only the JS-compatible subset of GitHub expressions.
        const expression = job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
        return runInNewContext(
          expression,
          {
            inputs: {
              build_scope: scope,
              mac_archive_run_id: mac,
              npm_candidate_run_id: candidate,
            },
            needs: {
              resolve: {
                result: "success",
                outputs: {
                  delivery_binding_sha: scope === "android-delivery-only" ? "a".repeat(64) : "",
                },
              },
              "android-qa": { result: scope === "android-delivery-only" ? "skipped" : "success" },
              cli: { result: "success" },
              "android-qa-build": {
                result: ["android-qa-verify", "android-delivery-only"].includes(scope)
                  ? "skipped"
                  : "success",
              },
            },
            cancelled: () => false,
          },
          { timeout: 100 },
        );
      })
      .map(([id]) => id);
    assert.deepEqual(selected, expected, `scope=${scope}, mac=${mac}, candidate=${candidate}`);
  }
});
const dockerWorkflowPath = new URL(".github/workflows/docker.yml", repoRoot);
const nixWorkflowPath = new URL(".github/workflows/nix.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);
const serverTsconfigPath = new URL("packages/server/tsconfig.server.json", repoRoot);
const desktopPackagePath = new URL("packages/desktop/package.json", repoRoot);

const gatedCiJobs = new Map([
  ["format", { name: "format", contract: "format" }],
  ["lint", { name: "lint", contract: "quality" }],
  ["typecheck", { name: "typecheck", contract: "quality" }],
  ["server-tests-ubuntu", { name: "server-tests (ubuntu-latest)", contracts: ["server", "hub"] }],
  ["server-tests-windows", { name: "server-tests (windows-latest)", contracts: ["server", "hub"] }],
  ["server-tests-macos", { name: "server-tests (macos-14, file observation)", contract: "server" }],
  ["desktop-tests-ubuntu", { name: "desktop-tests (ubuntu-latest)", contract: "desktop" }],
  ["desktop-tests-windows", { name: "desktop-tests (windows-latest)", contract: "desktop" }],
  ["app-tests", { name: "app-tests", contract: "app" }],
  ["sdk-tests", { name: "sdk-tests", contract: "sdk" }],
  ["playwright-1", { name: "playwright (shard 1/4)", contract: "browser" }],
  ["playwright-2", { name: "playwright (shard 2/4)", contract: "browser" }],
  ["playwright-3", { name: "playwright (shard 3/4)", contract: "browser" }],
  ["playwright-4", { name: "playwright (shard 4/4)", contract: "browser" }],
  ["relay-tests", { name: "relay-tests", contract: "relay" }],
  ["cli-tests-1", { name: "cli-tests (shard 1/3)", contract: "cli" }],
  ["cli-tests-2", { name: "cli-tests (shard 2/3)", contract: "cli" }],
  ["cli-tests-3", { name: "cli-tests (shard 3/3)", contract: "cli" }],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(fileURLToPath(directory), entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

test("gated checks are statically named jobs with real job-level gating", () => {
  const workflowSource = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(workflowSource);
  const trigger = workflowSource.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(workflowSource, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(workflowSource, /RUN_TESTS|Skip unaffected|No .* changes detected/);

  for (const [jobId, expected] of gatedCiJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${expected.name.replace(/[()]/g, "\\$&")}$`, "m"));
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    for (const contract of expected.contracts ?? [expected.contract]) {
      assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
    }
  }
});

test("change gating allows superseded workflow runs to cancel", () => {
  for (const workflowPath of [ciWorkflowPath, dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    assert.doesNotMatch(
      source,
      /\$\{\{\s*always\(\)/,
      "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
    );
  }
});

test("focused contracts stay inside existing required checks", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const changes = jobs.get("changes")?.join("\n") ?? "";
  const server = jobs.get("server-tests-ubuntu")?.join("\n") ?? "";
  const desktop = jobs.get("desktop-tests-ubuntu")?.join("\n") ?? "";

  assert.match(changes, /scripts\/daemon-launch-contract\.test\.mjs/);
  assert.doesNotMatch(changes, /Install dependencies|npm run build/);

  assert.match(server, /test:hub-cli-contract/);
  assert.match(server, /npm run test --workspace=@getpaseo\/server/);
  assert.ok(!jobs.has("hub-cli-contract"));

  assert.match(desktop, /test:e2e:renderer/);
  assert.match(desktop, /test:e2e:browser-tabs/);
  assert.match(desktop, /npm run test --workspace=@getpaseo\/desktop/);
  assert.ok(!jobs.has("desktop-browser-bridge"));
  assert.ok(!jobs.has("playwright-desktop"));
});

test("server builds exclude test utilities at every domain depth", () => {
  const tsconfig = JSON.parse(readFileSync(serverTsconfigPath, "utf8"));
  assert.ok(tsconfig.exclude.includes("src/server/**/test-utils/**"));
  assert.ok(!tsconfig.exclude.includes("src/server/test-utils/**"));
});

test("PR routing declares stable behavior ownership", () => {
  const filters = loadFilters(filtersPath);
  assert.deepEqual(filters, {
    routing: [".github/ci-paths.yml"],
    workspace: [
      ".mise.toml",
      ".tool-versions",
      "package.json",
      "package-lock.json",
      "patches/**",
      "scripts/**",
      "tsconfig.json",
      "tsconfig.base.json",
      "vitest.config.ts",
    ],
    ci: [".github/actions/**", ".github/workflows/ci.yml"],
    format: [
      ".agents/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      ".github/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "packages/expo-two-way-audio/**",
    ],
    quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}", "packages/expo-two-way-audio/**"],
    hub: ["packages/cli/src/commands/hub/**", "packages/server/src/server/hub/**"],
    server: ["plugins/**", "packages/server/**", "packages/app/e2e/support/fixtures/recording.*"],
    desktop: [
      "packages/desktop/**",
      "packages/app/src/desktop/**",
      "packages/server/src/server/browser-tools/**",
      "packages/app/e2e/support/**",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    app: ["packages/app/**", "packages/expo-two-way-audio/**"],
    sdk: [
      "packages/plugin/**",
      "plugin-examples/**",
      "public-docs/plugins/**",
      "packages/client/**",
      "packages/highlight/**",
      "packages/protocol/**",
    ],
    browser: [
      "packages/server/src/server/agent/provider-snapshot-manager.ts",
      "packages/server/src/server/session/provider/provider-catalog-session.ts",
      "packages/client/src/compat/normalize-provider-models.ts",
      "packages/protocol/src/client-capabilities.ts",
      "packages/server/src/server/agent/provider-registry.ts",
      "packages/server/src/server/agent/agent-sdk-types.ts",
      "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
      "packages/server/src/server/agent/providers/claude/agent.ts",
      "packages/server/src/server/agent/plugin-provider.ts",
      "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
      "packages/server/src/executable-resolution/**",
      "packages/plugin/src/server/provider.ts",
      "packages/app/src/!(desktop)/**",
      "packages/app/e2e/browser/**",
      "packages/app/e2e/support/**",
      "packages/app/assets/**",
      "packages/app/public/**",
      "packages/app/index.ts",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    relay: ["packages/relay/**"],
    cli: ["packages/cli/**"],
  });
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
      path,
    );
  }

  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("browser and desktop tests have exclusive, directory-owned suites", () => {
  const filters = loadFilters(filtersPath);
  const browserSpecs = filesUnder("packages/app/e2e", (path) => path.endsWith(".spec.ts"));
  const desktopSpecs = filesUnder("packages/desktop/e2e", (path) => path.endsWith(".spec.ts"));
  const electronModules = filesUnder("packages/app/src", (path) => /\.electron\.tsx?$/.test(path));

  assert.ok(browserSpecs.length > 0);
  assert.ok(desktopSpecs.length > 0);
  assert.ok(browserSpecs.every((path) => path.startsWith("packages/app/e2e/browser/")));
  assert.ok(desktopSpecs.every((path) => path.startsWith("packages/desktop/e2e/")));
  assert.ok(electronModules.every((path) => path.startsWith("packages/app/src/desktop/")));

  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  assert.match(desktopPackage.scripts.test, /--exclude ["']e2e\/\*\*["']/);

  for (const path of browserSpecs) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /paseoDesktop|injectDesktopBridge/,
    );
  }
  for (const path of desktopSpecs) {
    assert.ok(path.startsWith("packages/desktop/e2e/"));
  }

  const routingSource = readFileSync(filtersPath, "utf8");
  assert.doesNotMatch(routingSource, /desktop_bridge|playwright_desktop|browser-\*|browser-\*\//);
  assert.deepEqual(filters.desktop, [
    "packages/desktop/**",
    "packages/app/src/desktop/**",
    "packages/server/src/server/browser-tools/**",
    "packages/app/e2e/support/**",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
  assert.deepEqual(filters.browser, [
    "packages/server/src/server/agent/provider-snapshot-manager.ts",
    "packages/server/src/server/session/provider/provider-catalog-session.ts",
    "packages/client/src/compat/normalize-provider-models.ts",
    "packages/protocol/src/client-capabilities.ts",
    "packages/server/src/server/agent/provider-registry.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
    "packages/server/src/server/agent/providers/claude/agent.ts",
    "packages/server/src/server/agent/plugin-provider.ts",
    "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
    "packages/server/src/executable-resolution/**",
    "packages/plugin/src/server/provider.ts",
    "packages/app/src/!(desktop)/**",
    "packages/app/e2e/browser/**",
    "packages/app/e2e/support/**",
    "packages/app/assets/**",
    "packages/app/public/**",
    "packages/app/index.ts",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
});

test("packaging runs on main without allocating pull-request runners", () => {
  for (const workflowPath of [dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    const trigger = source.split("jobs:", 1)[0];
    assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
    assert.doesNotMatch(trigger, /pull_request/);
    assert.doesNotMatch(source, /dorny\/paths-filter/);
  }
});

test("desktop packaging smokes main pushes and only the pull requests that touch packaging", () => {
  const source = readFileSync(new URL(".github/workflows/desktop-packages.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
  assert.match(trigger, /pull_request:\s*\n\s+branches: \[main\]\s*\n\s+paths:/);
  assert.match(trigger, /- "packages\/desktop\/\*\*"/);
  assert.doesNotMatch(source, /dorny\/paths-filter/);
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    assert.match(source, new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  }
});

test("Android horizontal input stays inside the viewport rather than the system Back edges", () => {
  const viewport = [0, 0, 1080, 2400];
  const formula = [52, 1189, 1027, 1373];
  const left = androidInteriorHorizontalSwipe(formula, viewport, "left");
  assert.deepEqual(left, [799, 1281, 281, 1281]);
  assert.deepEqual(
    androidInteriorHorizontalSwipe(formula, viewport, "right"),
    [281, 1281, 799, 1281],
  );
  assert.deepEqual(
    androidInteriorHorizontalSwipe([-50, -20, 1130, 100], viewport, "left"),
    [799, 50, 281, 50],
  );
  for (const rect of [
    [990, 10, 1080, 50],
    [0, 2500, 1080, 2600],
    [0, 0, 0, 100],
    [0, 0, NaN, 100],
  ])
    assert.throws(() => androidInteriorHorizontalSwipe(rect, viewport, "left"), /swipe/);
  assert.throws(() => androidInteriorHorizontalSwipe(formula, viewport, "up"), /swipe/);
});
test("Horizontal formula QA selects the visible summation host instead of later short inline math", () => {
  const xml =
    '<hierarchy><node bounds="[0,0][1080,2400]"><node resource-id="android-math-webview" bounds="[52,1189][1027,1373]"><node text="∑" bounds="[57,1210][88,1252]" /></node><node resource-id="android-math-webview" bounds="[52,1066][1027,1126]" /></node></hierarchy>';
  const nodes = androidUiNodes(xml);
  const expected = [52, 1189, 1027, 1373];
  assert.deepEqual(androidQaLongFormulaRect(nodes), expected);
  assert.deepEqual(androidQaFormulaSwipeRect(nodes, expected), [52, 1210, 1027, 1252]);
  assert.deepEqual(
    androidInteriorHorizontalSwipe(
      androidQaFormulaSwipeRect(nodes, expected),
      nodes[0].rect,
      "left",
    ),
    [799, 1231, 281, 1231],
  );
  const after = androidUiNodes(xml.replace('text="∑"', 'text=""'));
  assert.deepEqual(androidQaLongFormulaRect(after, expected), expected);
  assert.throws(() => androidQaLongFormulaRect(after), /formula/);
  assert.throws(
    () =>
      androidQaLongFormulaRect(
        androidUiNodes('<hierarchy><node bounds="[0,0][1080,2400]" /></hierarchy>'),
        expected,
      ),
    /formula/,
  );
});

test("Theme admission waits for actual appearance despite a healthy unchanged UI id", () => {
  for (const value of [255, 230, 128])
    assert.throws(() => assertAndroidThemeSample(value, "dark"), /theme/);
  assert.doesNotThrow(() => assertAndroidThemeSample(26, "dark"));
  for (const value of [26, 100, 128])
    assert.throws(() => assertAndroidThemeSample(value, "light"), /theme/);
  assert.doesNotThrow(() => assertAndroidThemeSample(255, "light"));
  for (const value of [NaN, -1, 256])
    assert.throws(() => assertAndroidThemeSample(value, "dark"), /theme/);
});
test("Math QA fixture keeps plain replies and supplies an unbreakable wide numerator", () => {
  const source = readFileSync(
    new URL("../packages/app/e2e/fixtures/catalog-codex.mjs", import.meta.url),
    "utf8",
  );
  const functionSource = source.slice(
    source.indexOf("function fixtureReply("),
    source.indexOf("function respond("),
  );
  const reply = (input) =>
    runInNewContext(functionSource + "\nfixtureReply({ input: " + JSON.stringify(input) + " })", {
      process: { env: { PASEO_ANDROID_MATH_QA: "1" } },
    });
  assert.equal(reply("plain"), "Plain QA ready. No formula in this reply.");
  const math = reply("math");
  assert.match(math, /a_\{24\}/);
  assert.ok(math.includes("Short formula $x^2$ inside prose."));
  assert.match(math, /Math QA marker/);
});

test("ARM64-only delivery rejects mixed scopes and admits an exact successful native QA Run", () => {
  const input = { scope: "android-delivery-only", runId: "42", reportHash: "a".repeat(64) };
  assert.deepEqual(androidDeliveryRequest(input), { runId: "42", reportHash: "a".repeat(64) });
  for (const patch of [
    { scope: "all" },
    { runId: "" },
    { reportHash: "" },
    { qaRunId: "9" },
    { npmRunId: "7" },
    { macRunId: "8" },
  ])
    assert.throws(() => androidDeliveryRequest({ ...input, ...patch }), /exclusive/);
  const run = {
    id: 42,
    run_attempt: 1,
    repository: { full_name: "yinaoxiong/paseo" },
    workflow_id: 377643758,
    path: ".github/workflows/personal-build.yml",
    event: "workflow_dispatch",
    head_branch: "integration/android-latex",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
  };
  const job = {
    name: "android-qa",
    run_id: 42,
    head_sha: run.head_sha,
    status: "completed",
    conclusion: "success",
  };
  const artifact = {
    id: 99,
    name: "personal-android-native-qa",
    expired: false,
    digest: "sha256:" + "b".repeat(64),
    workflow_run: { id: 42, head_sha: run.head_sha, head_branch: run.head_branch },
  };
  assert.equal(admitAndroidVerifiedQaRun(run, [job], [artifact]).artifactId, "99");
  for (const patch of [
    { conclusion: "failure" },
    { run_attempt: 2 },
    { event: "pull_request" },
    { head_branch: "pr/foreign" },
  ])
    assert.throws(() => admitAndroidVerifiedQaRun({ ...run, ...patch }, [job], [artifact]));
  assert.throws(
    () => admitAndroidVerifiedQaRun(run, [{ ...job, conclusion: "skipped" }], [artifact]),
    /job/,
  );
  assert.throws(() => admitAndroidVerifiedQaRun(run, [job], [artifact, artifact]), /ambiguous/);
});
test("Accepted native QA proof pins application, version, cleanup and signed delivery provenance", () => {
  const cwd = mkdtempSync(joinPath(os.tmpdir(), "paseo-delivery-proof-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (name, body) => {
    mkdirSync(joinPath(cwd, name, ".."), { recursive: true });
    writeFileSync(joinPath(cwd, name), body);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=QA",
      "-c",
      "user.email=qa@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    put("package.json", '{"version":"0.11.2"}');
    put("package-lock.json", "{}");
    put("packages/app/src/native.ts", "tested");
    const payload = commit();
    put("scripts/personal/smoke-android-release.mjs", "verified");
    const verifier = commit();
    put("scripts/personal/trusted-source.mjs", "delivery");
    const target = commit();
    const names = [
      "connected",
      "sidebar-directory-ready",
      "workspace-selected",
      "math-open",
      "plain-chat",
      "math-return",
      "foreground-return",
      "dark-theme",
      "light-theme",
      "observed-theme-change",
      "formula-swipe-left",
      "formula-content-moved",
      "formula-swipe-right",
      "formula-left-edge-0",
      "formula-left-edge-1",
      "formula-left-edge-2",
      "chat-vertical-scroll",
      "chat-content-moved",
      "left-panel-open",
      "left-panel-return",
      "right-panel-open",
      "right-panel-return",
    ];
    const report = {
      schemaVersion: 1,
      mode: "exact-apk-reverification",
      verificationRunId: "42",
      verifierSourceSha: verifier,
      payloadSourceSha: payload,
      sourceSha: payload,
      producerRunId: "11",
      producerRunAttempt: "1",
      runtimeOutcome: "passed",
      error: null,
      qaAbi: "x86_64",
      installedVersionCode: 11002004,
      deliveryArm64RuntimeTest: false,
      apkSha256: "c".repeat(64),
      qaApkSha256: "c".repeat(64),
      manifestSha256: "d".repeat(64),
      runtimeInputSha256: androidRuntimeTreeHash(payload, cwd),
      buildContractSha256: "b".repeat(64),
      assertions: names.map((name) => ({ name, passed: true })),
      cleanup: ["logcat", "app-stop", "reverse-remove"].map((name) => ({ name, passed: true })),
      horizontalInputs: Array.from({ length: 7 }, () => ({ points: [799, 100, 281, 100] })),
    };
    const bytes = Buffer.from(JSON.stringify(report));
    const context = {
      cwd,
      targetSha: target,
      verifierSha: verifier,
      revision: 4,
      runId: "42",
      deliveryRunId: "77",
      artifactId: "99",
      artifactDigest: "sha256:" + "e".repeat(64),
      reportHash: hashQaBytes(bytes),
      fixtureCleaned: { isolatedDaemonClosed: true, projectsRemoved: true },
      buildContract: () => "b".repeat(64),
    };
    const binding = verifyAndroidDeliveryReport(bytes, context);
    assert.equal(binding.sourceSha, target);
    assert.equal(binding.qaPayloadSha, payload);
    assert.throws(
      () => verifyAndroidDeliveryReport(bytes, { ...context, revision: 3 }),
      /identity/,
    );
    assert.throws(
      () => verifyAndroidDeliveryReport(bytes, { ...context, reportHash: "f".repeat(64) }),
      /hash/,
    );
    assert.throws(
      () => verifyAndroidDeliveryReport(bytes, { ...context, fixtureCleaned: {} }),
      /cleanup/,
    );
    assert.throws(
      () => verifyAndroidDeliveryReport(bytes, { ...context, buildContract: () => "f".repeat(64) }),
      /build inputs/,
    );
    for (const patch of [
      { runtimeOutcome: "failed" },
      { cleanup: [] },
      { assertions: report.assertions.filter((x) => x.name !== "formula-content-moved") },
      { horizontalInputs: [] },
    ]) {
      const bad = Buffer.from(JSON.stringify({ ...report, ...patch }));
      assert.throws(() =>
        verifyAndroidDeliveryReport(bad, { ...context, reportHash: hashQaBytes(bad) }),
      );
    }
    const bindingBytes = Buffer.from(JSON.stringify(binding, null, 2) + "\n");
    const signing = {
      cwd,
      targetSha: target,
      revision: 4,
      deliveryRunId: "77",
      bindingHash: hashQaBytes(bindingBytes),
    };
    assert.equal(assertAndroidDeliveryBinding(bindingBytes, signing).androidVersionCode, 11002004);
    assert.throws(
      () => assertAndroidDeliveryBinding(bindingBytes, { ...signing, deliveryRunId: "78" }),
      /mismatch/,
    );
    const pin = JSON.parse(
      readFileSync(new URL("./personal/android-signing.json", import.meta.url), "utf8"),
    ).certificateSha256;
    const manifest = {
      target: "android-arm64",
      sourceSha: target,
      githubRunId: "77",
      version: binding.version,
      signerSha256: pin,
      validation: {
        signatureVerified: true,
        packageId: "sh.paseo.personal",
        abi: "arm64-v8a",
        androidVersionCode: 11002004,
      },
      assets: [
        {
          name: `paseo-personal-${binding.version}-android-arm64.apk`,
          sha256: "c".repeat(64),
          bytes: 123,
        },
      ],
    };
    assert.equal(
      androidDeliveryProvenance(bindingBytes, manifest, signing).delivery.signerSha256,
      pin,
    );
    assert.throws(
      () =>
        androidDeliveryProvenance(
          bindingBytes,
          { ...manifest, signerSha256: "f".repeat(64) },
          signing,
        ),
      /Signed/,
    );
    put("packages/app/src/native.ts", "changed");
    const changed = commit();
    assert.throws(
      () => verifyAndroidDeliveryReport(bytes, { ...context, targetSha: changed }),
      /native inputs/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("Delivery-only workflow routes accepted proof admission before signer-bearing ARM64", () => {
  const w = loadYaml(
    readFileSync(new URL("../.github/workflows/personal-build.yml", import.meta.url), "utf8"),
  );
  assert.ok(w.on.workflow_dispatch.inputs.build_scope.options.includes("android-delivery-only"));
  const admission = w.jobs.resolve.steps.find((x) => x.id === "accepted_native_qa");
  assert.ok(admission);
  assert.doesNotMatch(JSON.stringify(w.jobs.resolve), /secrets\./);
  assert.ok(w.jobs.android.steps.find((x) => x.name === "Validate accepted native QA binding"));
  const evaluate = (scope, qa, approved) =>
    runInNewContext(w.jobs.android.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
      cancelled: () => false,
      inputs: { build_scope: scope, mac_archive_run_id: "" },
      needs: {
        resolve: {
          result: "success",
          outputs: { delivery_binding_sha: approved ? "a".repeat(64) : "" },
        },
        "android-qa": { result: qa },
      },
    });
  for (const [scope, qa, approved, result] of [
    ["all", "success", false, true],
    ["all", "failure", true, false],
    ["android-delivery-only", "skipped", true, true],
    ["android-delivery-only", "skipped", false, false],
    ["android-delivery-only", "failure", true, false],
    ["android-qa-verify", "success", true, false],
  ])
    assert.equal(Boolean(evaluate(scope, qa, approved)), result);
});
