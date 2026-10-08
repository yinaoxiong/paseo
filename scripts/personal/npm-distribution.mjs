import { createHash } from "node:crypto";
import path from "node:path";

export const npmPackages = ["protocol", "client", "plugin", "server", "cli"];
export const npmName = (key) => `@yinaoxiong/paseo-${key}`;
export const npmVersion = (base, revision) => `${base}-personal.${revision}`;

export function npmManifest(original, version, upstream) {
  const manifest = structuredClone(original);
  const key = manifest.name.replace("@getpaseo/", "");
  if (!npmPackages.includes(key)) throw new Error(`Unexpected private package ${key}`);
  manifest.name = npmName(key);
  manifest.version = version;
  // npm provenance requires the public publishing repository, not the upstream fork source.
  manifest.repository = {
    type: "git",
    url: "git+https://github.com/yinaoxiong/paseo.git",
    directory: `packages/${key}`,
  };
  for (const field of [
    "scripts",
    "devDependencies",
    "overrides",
    "workspaces",
    "os",
    "cpu",
    "libc",
    "private",
    "bundledDependencies",
    "bundleDependencies",
  ])
    delete manifest[field];
  manifest.dependencies ??= {};
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      const internal = name.replace("@getpaseo/", "");
      if (name.startsWith("@getpaseo/") && npmPackages.includes(internal)) {
        // Preserve canonical SDK imports. Alias is a dependency spec, not a peer range.
        manifest.dependencies[name] = `npm:${npmName(internal)}@${version}`;
        if (section === "peerDependencies") {
          delete manifest.peerDependencies[name];
          delete manifest.peerDependenciesMeta?.[name];
        } else if (section === "optionalDependencies")
          manifest.optionalDependencies[name] = manifest.dependencies[name];
      } else if (name === "@getpaseo/relay" || name === "@getpaseo/highlight")
        manifest[section][name] = upstream;
      else if (!spec) throw new Error(`Empty dependency ${name}`);
    }
  }
  manifest.engines = { ...manifest.engines, node: ">=24 <25" };
  manifest.publishConfig = {
    registry: "https://registry.npmjs.org/",
    access: "public",
    tag: "latest",
  };
  manifest.files = [...(manifest.files ?? []), "build-info.json"];
  if (key === "server") manifest.bundleDependencies = ["@opencode-ai/sdk"];
  return manifest;
}

export function pinDirectDependencies(manifest, key, sourceLock) {
  for (const section of ["dependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith("@getpaseo/") || spec.startsWith("npm:")) continue;
      const entry =
        sourceLock.packages[`packages/${key}/node_modules/${name}`] ??
        sourceLock.packages[`node_modules/${name}`];
      if (!entry?.version) throw new Error(`Missing source lock entry for ${key}/${name}`);
      manifest[section][name] = entry.version;
    }
  }
  return manifest;
}

const rebrands = {
  "cli/dist/commands/daemon/local-daemon.js": [
    'packageJson.name !== "@getpaseo/server"',
    'packageJson.name !== "@yinaoxiong/paseo-server"',
  ],
  "cli/dist/commands/plugin/scaffold.js": [
    '"@getpaseo/plugin": version',
    '"@getpaseo/plugin": "npm:@yinaoxiong/paseo-plugin@" + version',
  ],
  "server/dist/server/server/daemon-version.js": [
    'SERVER_PACKAGE_NAME = "@getpaseo/server"',
    'SERVER_PACKAGE_NAME = "@yinaoxiong/paseo-server"',
  ],
  "server/dist/server/terminal/terminal.js": [
    'PASEO_CLI_BIN_ENTRY = "@getpaseo/cli/bin/paseo"',
    'PASEO_CLI_BIN_ENTRY = "@yinaoxiong/paseo-cli/bin/paseo"',
  ],
  "server/dist/server/server/session/daemon/npm-global-cli.js": [
    'PASEO_CLI_PACKAGE = "@getpaseo/cli"',
    'PASEO_CLI_PACKAGE = "@yinaoxiong/paseo-cli"',
  ],
};

export function rebrandExecutable(key, relative, content) {
  const rule = rebrands[`${key}/${relative.split(path.sep).join("/")}`];
  if (!rule) return content;
  if (!content.includes(rule[0]))
    throw new Error(`Missing expected executable identity in ${key}/${relative}`);
  return content.replaceAll(rule[0], rule[1]);
}

export function hashBytes(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

export function assertPackageFiles(files) {
  for (const file of files) {
    if (
      file.path
        .split("/")
        .some((part) =>
          [
            ".git",
            ".planning",
            ".devcontainer",
            ".paseo",
            ".secrets",
            ".env",
            "id_rsa",
            "id_ed25519",
          ].includes(part),
        ) ||
      /\.(?:jks|keystore|p12|pfx)$/.test(file.path)
    )
      throw new Error(`Forbidden npm package file ${file.path}`);
    if (
      file.path.split("/").includes("node_modules") &&
      !file.path.includes("node_modules/@opencode-ai/sdk/")
    )
      throw new Error(`Unexpected bundled dependency ${file.path}`);
    if (/\.(?:node|dll|exe|dylib|so)$/.test(file.path))
      throw new Error(`Native binary in universal npm package ${file.path}`);
  }
}
