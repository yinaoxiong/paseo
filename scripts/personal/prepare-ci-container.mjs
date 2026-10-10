import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./build-info.mjs";

const temp = process.env.RUNNER_TEMP;
if (process.env.GITHUB_ACTIONS !== "true" || !temp) throw new Error("GitHub runner only");
const config = JSON.parse(
  readFileSync(path.join(repoRoot, ".devcontainer/devcontainer.json"), "utf8").replace(
    /^\s*\/\/.*$/gm,
    "",
  ),
);
const cache = path.join(temp, "paseo-npm-cache");
mkdirSync(cache, { recursive: true });
config.mounts = config.mounts.map((mount) =>
  mount.includes("target=/root/.npm,") ? `source=${cache},target=/root/.npm,type=bind` : mount,
);
config.onCreateCommand =
  'git config --global --add safe.directory "$(pwd)" && npm config set registry https://registry.npmjs.org/ && npm install -g npm@11.19.0 --ignore-scripts --no-audit --no-fund';
const dockerfile = path.join(temp, "paseo-personal-ci.Dockerfile");
const original = readFileSync(path.join(repoRoot, ".devcontainer/Dockerfile"), "utf8");
if (!original.startsWith("FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie\n"))
  throw new Error("Update the personal CI image pin when changing the development base image");
writeFileSync(
  dockerfile,
  original.replace(
    "mcr.microsoft.com/devcontainers/javascript-node:24-trixie",
    "mcr.microsoft.com/devcontainers/javascript-node:24-trixie@sha256:7a81958053c4e3b5b20fa122f7a422d32dd0eebe87a6726f7b14483585ea60fd",
  ),
);
config.build = { ...config.build, dockerfile, context: path.join(repoRoot, ".devcontainer") };
if (process.env.PASEO_NPM_VERIFY_ONLY === "true") {
  // This job only uses builtin Node helpers and the downloaded npm candidates.
  config.postCreateCommand = "true";
  config.postStartCommand = "true";
}
config.containerEnv = {
  ...config.containerEnv,
  GITHUB_ACTIONS: "true",
  GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
  GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
  PASEO_NPM_CANDIDATE_RUN_ID: process.env.PASEO_NPM_CANDIDATE_RUN_ID ?? "",
  PASEO_NPM_CANDIDATE_MANIFEST_SHA256: process.env.PASEO_NPM_CANDIDATE_MANIFEST_SHA256 ?? "",
  PASEO_BUILD_MARKER: process.env.PASEO_BUILD_MARKER ?? "checks",
};
if (process.env.PASEO_ANDROID_QA === "true") {
  // Linux CI only: adb reverse reaches the loopback-only isolated fixture, never production.
  const state = path.join(temp, "paseo-qa-state");
  mkdirSync(state, { recursive: true });
  config.runArgs = [...(config.runArgs ?? []), "--network=host"];
  config.mounts.push(`source=${state},target=/tmp/paseo-qa-state,type=bind`);
  config.containerEnv.PASEO_ANDROID_QA_STATE = "/tmp/paseo-qa-state";
}
writeFileSync(
  path.join(temp, "paseo-personal-ci-devcontainer.json"),
  JSON.stringify(config, null, 2) + "\n",
);
