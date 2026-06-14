#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import rootPackageJson from "../package.json" with { type: "json" };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageName = process.env.PASEO_ANDROID_BUILDER_IMAGE || "paseo-android-builder:local";
const defaultWorkdir = resolve(repoRoot, ".local-build/android-arm64-build");
const defaultOutput = resolve(
  repoRoot,
  `.local-build/paseo-android-arm64-${rootPackageJson.version}.apk`,
);

function parseArgs(argv) {
  const options = {
    output: defaultOutput,
    workdir: defaultWorkdir,
    keepWorkdir: false,
    skipInstall: process.env.PASEO_ANDROID_SKIP_NPM_CI === "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      options.output = resolve(repoRoot, argv[++index]);
      continue;
    }
    if (arg === "--workdir") {
      options.workdir = resolve(repoRoot, argv[++index]);
      continue;
    }
    if (arg === "--keep-workdir") {
      options.keepWorkdir = true;
      continue;
    }
    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: options.encoding,
    stdio: options.stdio ?? "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`,
    );
  }

  return result.stdout;
}

function assertDockerImageExists() {
  const result = spawnSync("docker", ["image", "inspect", imageName], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(
      `Docker image ${imageName} does not exist. Build it first with: npm run android:builder:image`,
    );
  }
}

function listBuildFiles() {
  const output = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer",
    stdio: "pipe",
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith("packages/app/android/"));
}

function copyWorkspace(workdir) {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  for (const relativePath of listBuildFiles()) {
    const source = join(repoRoot, relativePath);
    const destination = join(workdir, relativePath);
    const stat = lstatSync(source);
    mkdirSync(dirname(destination), { recursive: true });

    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), destination);
      continue;
    }

    if (stat.isDirectory()) {
      mkdirSync(destination, { recursive: true });
      continue;
    }

    cpSync(source, destination);
    chmodSync(destination, stat.mode);
  }
}

function dockerRunArgs(workdir, skipInstall) {
  const nodeModulesVolumes = [
    ["paseo-android-nm-root", "/workspaces/paseo/node_modules"],
    [
      "paseo-android-nm-expo-two-way-audio",
      "/workspaces/paseo/packages/expo-two-way-audio/node_modules",
    ],
    ["paseo-android-nm-highlight", "/workspaces/paseo/packages/highlight/node_modules"],
    ["paseo-android-nm-protocol", "/workspaces/paseo/packages/protocol/node_modules"],
    ["paseo-android-nm-client", "/workspaces/paseo/packages/client/node_modules"],
    ["paseo-android-nm-server", "/workspaces/paseo/packages/server/node_modules"],
    ["paseo-android-nm-app", "/workspaces/paseo/packages/app/node_modules"],
    ["paseo-android-nm-relay", "/workspaces/paseo/packages/relay/node_modules"],
    ["paseo-android-nm-website", "/workspaces/paseo/packages/website/node_modules"],
    ["paseo-android-nm-desktop", "/workspaces/paseo/packages/desktop/node_modules"],
    ["paseo-android-nm-cli", "/workspaces/paseo/packages/cli/node_modules"],
  ];

  const shellScript = [
    "set -euo pipefail",
    skipInstall
      ? "echo 'Skipping npm ci because --skip-install was provided'"
      : "npm ci --ignore-scripts",
    "npm run build:app-deps",
    "export APP_VARIANT=production",
    "export NODE_ENV=production",
    "cd packages/app",
    "rm -rf android",
    "npx expo prebuild --platform android --no-install",
    "node -e \"const fs=require('node:fs'); const path='android/gradle.properties'; let text=fs.readFileSync(path,'utf8'); const line='reactNativeArchitectures=arm64-v8a'; if (/^reactNativeArchitectures=.*$/m.test(text)) text=text.replace(/^reactNativeArchitectures=.*$/m,line); else text += (text.endsWith('\\\\n') ? '' : '\\\\n') + line + '\\\\n'; fs.writeFileSync(path,text);\"",
    "cd android",
    "./gradlew :app:assembleRelease -x lint -x test --no-daemon",
  ].join("\n");

  const args = [
    "run",
    "--rm",
    "-v",
    `${workdir}:/workspaces/paseo`,
    "-v",
    "paseo-android-gradle-cache:/root/.gradle",
    "-w",
    "/workspaces/paseo",
    "-e",
    "CI=1",
    "-e",
    "APP_VARIANT=production",
    "-e",
    "npm_config_registry=https://mirrors.tencent.com/npm/",
    "-e",
    "npm_config_replace_registry_host=npmjs",
  ];

  for (const [volume, target] of nodeModulesVolumes) {
    args.push("-v", `${volume}:${target}`);
  }

  args.push(imageName, "bash", "-lc", shellScript);
  return args;
}

function copyApk(workdir, output) {
  const apkPath = join(
    workdir,
    "packages/app/android/app/build/outputs/apk/release/app-release.apk",
  );
  if (!existsSync(apkPath)) {
    throw new Error(`Expected APK was not created: ${apkPath}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  cpSync(apkPath, output);
}

function verifyArm64Only(output) {
  const listing = run("unzip", ["-Z1", output], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const architectures = new Set();
  for (const line of listing.split("\n")) {
    const match = line.match(/^lib\/([^/]+)\//);
    if (match) {
      architectures.add(match[1]);
    }
  }

  const unexpectedArchitectures = [...architectures].filter((abi) => abi !== "arm64-v8a");
  if (!architectures.has("arm64-v8a") || unexpectedArchitectures.length > 0) {
    throw new Error(
      `APK ABI check failed. Found: ${[...architectures].sort().join(", ") || "(none)"}`,
    );
  }
}

function verifySigning(output) {
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${output}:/tmp/app.apk:ro`,
      imageName,
      "bash",
      "-lc",
      "/opt/android/build-tools/36.0.0/apksigner verify --print-certs /tmp/app.apk | sed -n '1,20p'",
    ],
    { cwd: repoRoot },
  );
}

const options = parseArgs(process.argv.slice(2));
if (
  !isAbsolute(options.workdir) ||
  !options.workdir.startsWith(resolve(repoRoot, ".local-build"))
) {
  throw new Error("--workdir must be inside .local-build");
}

try {
  assertDockerImageExists();
  copyWorkspace(options.workdir);
  run("docker", dockerRunArgs(options.workdir, options.skipInstall));
  copyApk(options.workdir, options.output);
  verifyArm64Only(options.output);
  verifySigning(options.output);
  console.log(`Android arm64 APK written to ${options.output}`);
} finally {
  if (!options.keepWorkdir) {
    rmSync(options.workdir, { recursive: true, force: true });
  }
}
