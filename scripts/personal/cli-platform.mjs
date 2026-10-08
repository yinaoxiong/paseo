import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { realpath, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function cliTarget(platform = process.platform, arch = process.arch) {
  const targets = {
    "linux/x64": "linux-x64",
    "darwin/arm64": "macos-arm64",
    "win32/x64": "windows-x64",
  };
  const target = targets[`${platform}/${arch}`];
  if (!target) throw new Error(`Unsupported standalone CLI target: ${platform}/${arch}`);
  return target;
}

export function installedCliPaths(
  prefix,
  platform = process.platform,
  packageName = "@getpaseo/cli",
) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  return {
    executable: paths.join(prefix, platform === "win32" ? "paseo.cmd" : "bin/paseo"),
    package: paths.join(
      prefix,
      platform === "win32" ? `node_modules/${packageName}` : `lib/node_modules/${packageName}`,
    ),
  };
}

export function windowsShimCommand(executable, args) {
  // npm's batch shim forwards %*, so arguments undergo two cmd.exe parses.
  const meta = (text) => text.replace(/([()%!^"`<>&|;, *?])/g, "^$1");
  const arg = (text) => {
    if (/[\r\n%]/.test(text)) throw new Error("Unsafe batch shim argument");
    let escaped = text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
    return meta(meta(`"${escaped}"`));
  };
  if (/[\r\n%]/.test(executable)) throw new Error("Unsafe batch shim executable");
  return `"${[meta(executable), ...args.map(arg)].join(" ")}"`;
}

export function runCliTool(command, args, options = {}) {
  if (command === "tar") command = tarToolPath();
  if (command === "npm") {
    const candidates = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
      path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ];
    const npm = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!npm)
      throw new Error("Cannot locate the pinned npm CLI beside Node; invoke through npm run");
    return execFileSync(process.execPath, [npm, ...args], options);
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return execFileSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", windowsShimCommand(command, args)],
      {
        ...options,
        windowsVerbatimArguments: true,
      },
    );
  }
  return execFileSync(command, args, options);
}

export function tarToolPath(platform = process.platform, systemRoot = process.env.SystemRoot) {
  if (platform !== "win32") return "tar";
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error("Missing Windows system directory");
  // Git's GNU tar treats C: paths as remote hosts; Windows' BSD tar accepts them.
  return path.win32.join(systemRoot, "System32", "tar.exe");
}

export function terminalProofCommand(executable, script, platform = process.platform) {
  const quote = (value) => `'${value.replace(/'/g, platform === "win32" ? "''" : "'\\''")}'`;
  if (platform === "win32") {
    const command = `& ${quote(executable)} ${quote(script)}; exit $LASTEXITCODE`;
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(command, "utf16le").toString("base64")}`;
  }
  return `${quote(executable)} ${quote(script)}`;
}

export function terminalProofMatches(receipt, expected, output) {
  return (
    receipt?.nonce === expected.nonce &&
    receipt?.hostname === expected.hostname &&
    receipt?.cwd === expected.cwd &&
    output.split(/\r?\n/).some((line) => line.trim() === expected.nonce)
  );
}

export function assertMacScratchInfo(device, filesystemType) {
  if (!/^\/dev\/disk\d+(s\d+)*$/.test(device) || !["apfs", "hfs"].includes(filesystemType))
    throw new Error("Scratch must use local APFS/HFS disk storage");
}

export async function localCliScratch(directory = os.tmpdir()) {
  const resolved = await realpath(directory);
  if (process.platform === "linux") {
    const { type } = await statfs(resolved);
    if (
      !new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630, 0x858458f6]).has(type >>> 0)
    )
      throw new Error(`Scratch must use a known local filesystem: ${resolved}`);
  } else if (process.platform === "darwin") {
    // BSD stat %T is a file type, not the containing filesystem.
    const device = execFileSync("/bin/df", ["-P", resolved], { encoding: "utf8" })
      .trim()
      .split("\n")
      .at(-1)
      .trim()
      .split(/\s+/)[0];
    if (!/^\/dev\/disk\d+(s\d+)*$/.test(device)) throw new Error("Network scratch is forbidden");
    const plist = execFileSync("/usr/sbin/diskutil", ["info", "-plist", device]);
    const info = JSON.parse(
      execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", "-"], {
        input: plist,
        encoding: "utf8",
      }),
    );
    assertMacScratchInfo(device, info.FilesystemType);
  } else if (process.platform === "win32") {
    const root = path.parse(resolved).root;
    if (!/^[A-Za-z]:\\$/.test(root)) throw new Error("UNC/network scratch is forbidden");
    const type = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `([System.IO.DriveInfo]::new('${root}')).DriveType.ToString()`,
      ],
      { encoding: "utf8" },
    ).trim();
    if (type !== "Fixed") throw new Error("Scratch must use a local fixed drive");
  } else throw new Error("Unsupported scratch platform");
  return resolved;
}
