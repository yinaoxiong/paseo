import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { repoRoot } from "./build-info.mjs";
import {
  androidQaVerifyScope,
  androidRuntimeTreeHash,
  androidBuildContractHash,
  verifyAndroidQaArtifact,
} from "./android-qa-reverification.mjs";
import { assertTrustedPersonalSource } from "./trusted-source.mjs";

const [directory, output] = process.argv.slice(2).map((p) => path.resolve(p));
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const verifierSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain=v1", "--untracked-files=all"))
  throw new Error("Commit verifier changes before exact APK reverification");
const reuse = process.env.PASEO_BUILD_SCOPE === androidQaVerifyScope;
const payloadSha = reuse ? process.env.PASEO_ANDROID_QA_PAYLOAD_SHA : verifierSha;
assertTrustedPersonalSource(payloadSha);
git("merge-base", "--is-ancestor", payloadSha, verifierSha);
const artifact = verifyAndroidQaArtifact(directory, {
  payloadSha,
  revision: process.env.PASEO_PERSONAL_REVISION,
  manifestHash: reuse ? process.env.PASEO_ANDROID_QA_MANIFEST_SHA256 : undefined,
  runId: reuse ? process.env.PASEO_ANDROID_QA_RUN_ID : process.env.GITHUB_RUN_ID,
  runAttempt: reuse ? process.env.PASEO_ANDROID_QA_RUN_ATTEMPT : process.env.GITHUB_RUN_ATTEMPT,
});
const runtimeHash = androidRuntimeTreeHash(payloadSha);
if (runtimeHash !== androidRuntimeTreeHash(verifierSha))
  throw new Error("App/native/build inputs changed; build a new QA APK");
const contract = (sha) =>
  androidBuildContractHash(loadYaml(git("show", `${sha}:.github/workflows/personal-build.yml`)));
const buildHash = contract(payloadSha);
if (buildHash !== contract(verifierSha))
  throw new Error("QA build configuration changed; build a new QA APK");
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      mode: reuse ? "exact-apk-reverification" : "current-build-verification",
      payloadSourceSha: payloadSha,
      verifierSourceSha: verifierSha,
      manifestSha256: artifact.manifestHash,
      apkSha256: artifact.manifest.apkSha256,
      producerRunId: artifact.manifest.githubRunId,
      producerRunAttempt: artifact.manifest.githubRunAttempt,
      verificationRunId: process.env.GITHUB_RUN_ID ?? null,
      runtimeInputSha256: runtimeHash,
      buildContractSha256: buildHash,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Verified exact APK ${artifact.manifest.apkSha256}; payload ${payloadSha}; verifier ${verifierSha}`,
);
