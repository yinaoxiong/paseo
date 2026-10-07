#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageName = process.env.PASEO_ANDROID_BUILDER_IMAGE || "paseo-android-builder:local";
const dockerfileDir = resolve(repoRoot, "docker/android-builder");

const args = ["build", "-t", imageName, dockerfileDir];
if (process.env.PASEO_ANDROID_BUILDER_PULL === "1") {
  args.splice(1, 0, "--pull");
}

const result = spawnSync("docker", args, {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
