// Keep Hermes/release compilation identical for delivery and emulator QA.
export function androidBuildScript(abi) {
  if (!["arm64-v8a", "x86_64"].includes(abi)) throw new Error("Unsupported Android ABI");
  return [
    "set -euo pipefail",
    "export PATH=/usr/local/bin:$PATH",
    "node --version",
    "npm --version",
    "free -h",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm run postinstall",
    "npm run build:app-deps",
    `node -e 'const fs=require("node:fs");fs.writeFileSync("/workspaces/paseo/android-toolchain.json",JSON.stringify({node:process.version,npm:require("node:child_process").execFileSync("npm",["--version"],{encoding:"utf8"}).trim()}))'`,
    "cd packages/app",
    "npx expo prebuild --platform android --no-install --clean",
    "cd android",
    "./gradlew :app:createBundleReleaseJsAndAssets --info --no-daemon --max-workers=1 -Dorg.gradle.parallel=false '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m'",
    `./gradlew :app:assembleRelease -PreactNativeArchitectures=${abi} -x lint -x test --no-daemon --max-workers=1 -Dorg.gradle.parallel=false '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m'`,
  ].join("\n");
}
