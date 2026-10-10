import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statfsSync,
  copyFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, repoRoot } from "./build-info.mjs";
import { writeArtifactManifest } from "./manifest.mjs";
import { androidBuildScript } from "./android-build-script.mjs";

const info = createBuildInfo(Number(process.argv[2] ?? "1"));
const output = path.resolve(process.argv[3] ?? path.join(repoRoot, ".local-build"));
const image = process.env.PASEO_ANDROID_BUILDER_IMAGE ?? "paseo-android-builder:local";
const keystore = process.env.PASEO_ANDROID_KEYSTORE;
const cert = JSON.parse(
  readFileSync(new URL("./android-signing.json", import.meta.url)),
).certificateSha256;
if (
  !keystore ||
  !existsSync(keystore) ||
  !process.env.PASEO_ANDROID_KEYSTORE_PASSWORD ||
  !/^[0-9a-f]{64}$/.test(cert ?? "")
) {
  throw new Error(
    "Set signing keystore path, password and expected certificate SHA-256 before building",
  );
}
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Android builder requires Linux x64");
const localTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630, 0x858458f6]);
if (!localTypes.has(statfsSync(os.tmpdir()).type >>> 0))
  throw new Error("Android scratch must use local disk");
const scratch = mkdtempSync(path.join(os.tmpdir(), "paseo-personal-android-"));
const work = path.join(scratch, "source");
const stagedApk = path.join(scratch, "paseo-personal.apk");
const name = `paseo-personal-${info.version}-android-arm64.apk`;
const final = path.join(output, name);
if (existsSync(final)) throw new Error("Refusing to overwrite APK");
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
const capture = (command, args) =>
  run(command, args, { stdio: ["ignore", "pipe", "inherit"] }).trim();
let buildError;
let imagePresent = false;
try {
  info.androidBuilderImage = image;
  info.androidBuilderId = capture("docker", ["image", "inspect", "--format", "{{.Id}}", image]);
  imagePresent = true;
  const archive = path.join(scratch, "source.tar");
  run("git", ["archive", "--format=tar", `--output=${archive}`, info.sourceSha]);
  mkdirSync(work);
  run("tar", ["-xf", archive, "-C", work]);
  const root = JSON.parse(readFileSync(path.join(work, "package.json")));
  const prefix = `paseo-android-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 12)}`;
  const mounts = ["", ...root.workspaces].flatMap((relative) => [
    "-v",
    `${prefix}-${relative.replaceAll("/", "-") || "root"}:/workspaces/paseo/${relative ? `${relative}/` : ""}node_modules`,
  ]);
  const script = androidBuildScript("arm64-v8a");
  // Build container gets no signing key, password or official Expo/EAS credential.
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${work}:/workspaces/paseo`,
    ...mounts,
    "-v",
    `${process.env.PASEO_ANDROID_NPM_CACHE ?? "paseo-android-npm-cache"}:/root/.npm`,
    "-v",
    `${process.env.PASEO_ANDROID_GRADLE_CACHE ?? "paseo-android-gradle-cache"}:/root/.gradle`,
    "-w",
    "/workspaces/paseo",
    "-e",
    "CI=1",
    "-e",
    "APP_VARIANT=personal",
    "-e",
    `PASEO_PERSONAL_REVISION=${info.revision}`,
    "-e",
    "NODE_OPTIONS=--max-old-space-size=4096",
    "-e",
    `npm_config_registry=${process.env.npm_config_registry ?? "https://registry.npmjs.org/"}`,
    image,
    "bash",
    "-lc",
    script,
  ]);
  const unsigned = path.join(
    work,
    "packages/app/android/app/build/outputs/apk/release/app-release.apk",
  );
  if (!existsSync(unsigned)) throw new Error("Android release APK missing");
  const signerArgs = [
    "run",
    "--rm",
    "-v",
    `${keystore}:/signing/key.p12:ro`,
    "-v",
    `${unsigned}:/signing/input.apk:ro`,
    "-v",
    `${scratch}:/output`,
    "-e",
    "PASEO_ANDROID_KEYSTORE_PASSWORD",
    image,
    "bash",
    "-lc",
    "set -euo pipefail; apksigner sign --ks /signing/key.p12 --ks-key-alias paseo-personal --ks-pass env:PASEO_ANDROID_KEYSTORE_PASSWORD --key-pass env:PASEO_ANDROID_KEYSTORE_PASSWORD --out /output/paseo-personal.apk /signing/input.apk; apksigner verify --verbose --print-certs /output/paseo-personal.apk",
  ];
  const signer = capture("docker", signerArgs);
  const actualCert = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(signer)?.[1].toLowerCase();
  if (actualCert !== cert)
    throw new Error("APK signing certificate does not match stable identity");
  const listing = capture("unzip", ["-Z1", stagedApk]);
  const abis = new Set([...listing.matchAll(/^lib\/([^/]+)\//gm)].map((match) => match[1]));
  if (abis.size !== 1 || !abis.has("arm64-v8a")) throw new Error("APK ABI must be arm64-v8a only");
  const badging = capture("docker", [
    "run",
    "--rm",
    "-v",
    `${stagedApk}:/tmp/app.apk:ro`,
    image,
    "bash",
    "-lc",
    "set -euo pipefail; aapt dump badging /tmp/app.apk",
  ]);
  if (
    !badging.includes("name='sh.paseo.personal'") ||
    !badging.includes(`versionCode='${info.androidVersionCode}'`) ||
    !badging.includes("application-label:'Paseo Personal'")
  )
    throw new Error("APK identity or version mismatch");
  info.signature = "personal certificate";
  info.signerSha256 = cert;
  info.androidToolchain = JSON.parse(readFileSync(path.join(work, "android-toolchain.json")));
  mkdirSync(output, { recursive: true });
  copyFileSync(stagedApk, final, constants.COPYFILE_EXCL);
  await writeArtifactManifest(output, "android-arm64", info, [final], {
    signatureVerified: true,
    packageId: "sh.paseo.personal",
    androidVersionCode: info.androidVersionCode,
    abi: "arm64-v8a",
    runtimeDeviceTest: "not performed",
  });
} catch (error) {
  buildError = error;
} finally {
  try {
    if (imagePresent)
      run("docker", [
        "run",
        "--rm",
        "-v",
        `${scratch}:/cleanup`,
        "-v",
        `${process.env.PASEO_ANDROID_NPM_CACHE ?? "paseo-android-npm-cache"}:/root/.npm`,
        "-v",
        `${process.env.PASEO_ANDROID_GRADLE_CACHE ?? "paseo-android-gradle-cache"}:/root/.gradle`,
        image,
        "bash",
        "-lc",
        `set -euo pipefail; rm -rf /cleanup/source /cleanup/source.tar /cleanup/paseo-personal.apk /cleanup/paseo-personal.apk.idsig; chown -R ${process.getuid()}:${process.getgid()} /root/.npm /root/.gradle`,
      ]);
    rmSync(scratch, { recursive: true, force: true });
  } catch (cleanupError) {
    console.error("Android scratch cleanup failed:", cleanupError);
    buildError ??= cleanupError;
  }
}
if (buildError) {
  console.error(buildError);
  process.exitCode = 1;
}
