# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Reuse a checkout's dependency volumes only after a complete installation."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


CI_ARGS = ["ci", "--ignore-scripts", "--prefer-offline", "--include=dev", "--include=optional"]
MARKER = ".paseo-deps.json"
INSTALL_SETTINGS = (
    "install_strategy", "legacy_peer_deps", "install_links", "cpu", "os", "libc",
)


def workspace_paths(root):
    manifest = json.loads((root / "package.json").read_text())
    workspaces = manifest.get("workspaces", [])
    if not isinstance(workspaces, list):
        raise ValueError("Private container workspaces must be an explicit list")
    paths = []
    for name in workspaces:
        path = root / name
        if any(character in name for character in "*?[{"):
            raise ValueError(f"Use explicit workspace paths and dependency volumes: {name}")
        path.resolve().relative_to(root.resolve())
        if not (path / "package.json").is_file():
            raise ValueError(f"Missing workspace manifest: {path / 'package.json'}")
        paths.append(path)
    return paths


def dependency_paths(root):
    return [root / "node_modules", *(path / "node_modules" for path in workspace_paths(root))]


def runtime_info():
    expression = """JSON.stringify({node:process.version,abi:process.versions.modules,
        platform:process.platform,arch:process.arch,
        libc:process.report.getReport().header.glibcVersionRuntime})"""
    runtime = json.loads(subprocess.check_output(["node", "-p", expression], text=True))
    runtime["npm"] = subprocess.check_output(["npm", "--version"], text=True).strip()
    runtime["os_release"] = Path("/etc/os-release").read_text()
    return runtime


def fingerprint(root, runtime):
    files = {
        "package.json": root / "package.json",
        "package-lock.json": root / "package-lock.json",
        ".npmrc": root / ".npmrc",
        "postinstall": root / "scripts/postinstall-patches.mjs",
        "bootstrap": Path(__file__),
        "user_npmrc": Path.home() / ".npmrc",
    }
    for workspace in workspace_paths(root):
        manifest = workspace / "package.json"
        files[str(manifest.relative_to(root))] = manifest
    for patch in sorted((root / "patches").glob("*.patch")):
        files[str(patch.relative_to(root))] = patch
    hashes = {
        name: hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        for name, path in sorted(files.items())
    }
    settings = {
        key: os.environ.get(f"npm_config_{key}", os.environ.get(f"NPM_CONFIG_{key.upper()}"))
        for key in INSTALL_SETTINGS
    }
    payload = {"files": hashes, "runtime": runtime, "ci": CI_ARGS, "settings": settings}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def read_record(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def directory_identity(path):
    metadata = path.stat()
    return [metadata.st_dev, metadata.st_ino]


def dependencies_current(root, state, expected):
    if read_record(state / "success.json") != {"fingerprint": expected}:
        return False
    for directory in dependency_paths(root):
        if not directory.is_dir() or directory.is_symlink():
            return False
        record = {"fingerprint": expected, "directory": directory_identity(directory)}
        if read_record(directory / MARKER) != record:
            return False
    # Check a few entry points without recursively scanning installed packages.
    manifest = json.loads((root / "package.json").read_text())
    if "oxlint" in manifest.get("devDependencies", {}):
        if not (root / "node_modules/.bin/oxlint").is_file():
            return False
    lock = json.loads((root / "package-lock.json").read_text())
    for package in ("node_modules/typescript", "packages/server/node_modules/@opencode-ai/sdk"):
        if package in lock.get("packages", {}) and not (root / package / "package.json").is_file():
            return False
    return True


def atomic_record(path, record):
    descriptor, name = tempfile.mkstemp(prefix=".paseo-deps-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(record, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def ensure_dependencies(root, state, *, force=False, check=False):
    state.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with (state / "install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        runtime = runtime_info()
        expected = fingerprint(root, runtime)
        if not force and dependencies_current(root, state, expected):
            return {"action": "reused", "seconds": round(time.monotonic() - started, 3)}
        if check:
            return {"action": "needs-install"}
        directories = dependency_paths(root)
        # Invalidate before npm ci: failed or interrupted installs must never
        # retain a success record, including when --force uses the same inputs.
        (state / "success.json").unlink(missing_ok=True)
        for directory in directories:
            (directory / MARKER).unlink(missing_ok=True)
        print("Dependencies changed or incomplete; installing and applying patches.", flush=True)
        subprocess.run(["npm", *CI_ARGS], cwd=root, check=True)
        manifest = json.loads((root / "package.json").read_text())
        if manifest.get("scripts", {}).get("postinstall"):
            subprocess.run(["npm", "run", "postinstall"], cwd=root, check=True)
        if fingerprint(root, runtime_info()) != expected:
            raise RuntimeError("Dependency inputs changed during installation; rerun the initializer")
        for directory in directories:
            directory.mkdir(exist_ok=True)
            atomic_record(directory / MARKER, {
                "fingerprint": expected, "directory": directory_identity(directory),
            })
        atomic_record(state / "success.json", {"fingerprint": expected})
        return {"action": "installed", "seconds": round(time.monotonic() - started, 3)}


def require_local_mounts(root, state):
    mounts = {}
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields, filesystem = line.split(" - ", 1)
        mountpoint = fields.split()[4].replace("\\040", " ").replace("\\134", "\\")
        mounts[mountpoint] = filesystem.split()[0]
    for directory in [state, *dependency_paths(root)]:
        filesystem = mounts.get(str(directory))
        if not filesystem or filesystem.startswith(("fuse", "nfs", "ceph", "cifs")):
            raise RuntimeError(f"Run inside the configured DevContainer with local volumes: {directory}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Reinstall even when dependencies match")
    parser.add_argument("--check", action="store_true", help="Check only; exit 1 when installation is needed")
    args = parser.parse_args()
    if args.force and args.check:
        parser.error("--force and --check are mutually exclusive")
    root = Path.cwd().resolve()
    state = Path("/var/lib/paseo-deps")
    require_local_mounts(root, state)
    result = ensure_dependencies(root, state, force=args.force, check=args.check)
    print(json.dumps(result), flush=True)
    return 1 if result["action"] == "needs-install" else 0


if __name__ == "__main__":
    raise SystemExit(main())
