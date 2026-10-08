import { spawnSync } from "node:child_process";
import path from "node:path";

export function windowsInstallerArgs(directory) {
  if (!path.win32.isAbsolute(directory) || /["\r\n]/.test(directory)) {
    throw new Error("NSIS test installation requires a safe absolute Windows directory");
  }
  // NSIS /D must be the final unquoted argument, including for paths with spaces.
  return ["/S", "/currentuser", `/D=${directory}`];
}

export function installWindowsPackage(executable, directory, env) {
  const result = spawnSync(executable, windowsInstallerArgs(directory), {
    env,
    stdio: "inherit",
    shell: false,
    windowsVerbatimArguments: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `NSIS per-user installation failed: status=${result.status}, signal=${result.signal}, error=${result.error?.code ?? "none"}`,
    );
  }
}
