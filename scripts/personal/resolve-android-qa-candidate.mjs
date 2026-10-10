import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { repoRoot } from "./build-info.mjs";
import {
  androidQaRequest,
  admitAndroidQaRun,
  androidDeliveryRequest,
  admitAndroidVerifiedQaRun,
} from "./android-qa-reverification.mjs";
import { assertTrustedPersonalSource } from "./trusted-source.mjs";

const delivery = androidDeliveryRequest({
  scope: process.env.PASEO_BUILD_SCOPE,
  runId: process.env.PASEO_ANDROID_DELIVERY_QA_RUN_ID,
  reportHash: process.env.PASEO_ANDROID_DELIVERY_QA_REPORT_SHA256,
  qaRunId: process.env.PASEO_ANDROID_QA_RUN_ID,
  qaManifestHash: process.env.PASEO_ANDROID_QA_MANIFEST_SHA256,
  npmRunId: process.env.PASEO_NPM_CANDIDATE_RUN_ID,
  npmManifestHash: process.env.PASEO_NPM_CANDIDATE_MANIFEST_SHA256,
  macRunId: process.env.PASEO_MAC_ARCHIVE_RUN_ID,
  macArchiveHash: process.env.PASEO_MAC_ARCHIVE_SHA256,
});
const request =
  delivery ??
  androidQaRequest({
    scope: process.env.PASEO_BUILD_SCOPE,
    runId: process.env.PASEO_ANDROID_QA_RUN_ID,
    manifestHash: process.env.PASEO_ANDROID_QA_MANIFEST_SHA256,
    npmRunId: process.env.PASEO_NPM_CANDIDATE_RUN_ID,
    macRunId: process.env.PASEO_MAC_ARCHIVE_RUN_ID,
    npmManifestHash: process.env.PASEO_NPM_CANDIDATE_MANIFEST_SHA256,
    macArchiveHash: process.env.PASEO_MAC_ARCHIVE_SHA256,
  });
if (!request) process.exit(0);
const api = (route) =>
  JSON.parse(execFileSync("gh", ["api", `repos/yinaoxiong/paseo/${route}`], { encoding: "utf8" }));
const run = api(`actions/runs/${request.runId}`);
if (String(run.id) !== request.runId || !Number.isInteger(run.run_attempt) || run.run_attempt < 1)
  throw new Error("QA producer request/Run identity mismatch");
const jobs = api(
  `actions/runs/${request.runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
).jobs;
const artifacts = api(
  `actions/runs/${request.runId}/artifacts?name=${delivery ? "personal-android-native-qa" : "personal-android-qa-x86_64"}&per_page=100`,
).artifacts;
const accepted = delivery
  ? admitAndroidVerifiedQaRun(run, jobs, artifacts)
  : admitAndroidQaRun(run, jobs, artifacts);
execFileSync("git", ["fetch", "--no-tags", "origin", accepted.sourceSha], {
  cwd: repoRoot,
  stdio: "pipe",
});
assertTrustedPersonalSource(accepted.sourceSha);
execFileSync(
  "git",
  [
    "merge-base",
    "--is-ancestor",
    accepted.sourceSha,
    process.env.PASEO_SOURCE_SHA || process.env.GITHUB_SHA,
  ],
  { cwd: repoRoot, stdio: "pipe" },
);
appendFileSync(
  process.env.GITHUB_OUTPUT,
  delivery
    ? `qa_verified_source_sha=${accepted.sourceSha}\nqa_verified_artifact_id=${accepted.artifactId}\nqa_verified_artifact_digest=${accepted.artifactDigest}\n`
    : `qa_payload_sha=${accepted.sourceSha}\nqa_run_attempt=${accepted.runAttempt}\nqa_artifact_id=${accepted.artifactId}\nqa_artifact_digest=${accepted.artifactDigest}\n`,
);
console.log(
  `Reverify exact QA Run ${accepted.runId}, source ${accepted.sourceSha}, artifact ${accepted.artifactId}`,
);
