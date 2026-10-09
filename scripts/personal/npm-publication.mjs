import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const publicationKeys = ["protocol", "client", "plugin", "server", "cli"];
export function parseNpmPublishResult(stdout, accepted) {
  // The pinned npm 11.19 publisher emits an object keyed by package name.
  const response = JSON.parse(stdout)[accepted.name];
  if (
    response?.id !== `${accepted.name}@${accepted.version}` ||
    response.name !== accepted.name ||
    response.version !== accepted.version ||
    response.integrity !== accepted.integrity
  )
    throw new Error("Unexpected npm publish response");
  return {
    id: response.id,
    name: response.name,
    version: response.version,
    integrity: response.integrity,
  };
}
export function validateNpmApproval(value) {
  if (
    value.schemaVersion !== 1 ||
    value.repository !== "yinaoxiong/paseo" ||
    value.buildWorkflowId !== 377643758 ||
    !/^[1-9][0-9]*$/.test(value.buildRunId) ||
    !/^[a-f0-9]{40}$/.test(value.payloadSource) ||
    !/^[a-f0-9]{64}$/.test(value.lockSha256) ||
    !/^[a-f0-9]{64}$/.test(value.manifestSha256) ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-personal\.[1-9][0-9]{0,2}$/.test(
      value.version ?? "",
    ) ||
    value.registry !== "https://registry.npmjs.org/" ||
    value.distTag !== "latest" ||
    value.packages?.length !== 5 ||
    value.proofs?.length !== 3
  )
    throw new Error("Invalid accepted npm publication batch");
  for (const [index, key] of publicationKeys.entries())
    validateAcceptedPackage(value.packages[index], key, value.version);
  for (const [index, target] of ["linux-x64", "macos-arm64", "windows-x64"].entries())
    validateAcceptedProof(value.proofs[index], target);
  return value;
}

export function npmPublicationInputs(value, upstreamVersion) {
  const approved = validateNpmApproval(value);
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(upstreamVersion ?? "") ||
    !approved.version.startsWith(`${upstreamVersion}-personal.`)
  )
    throw new Error("Accepted npm batch does not match the publisher's upstream version");
  return {
    version: approved.version,
    buildRunId: approved.buildRunId,
    confirmation: `PUBLISH @yinaoxiong ${approved.version}`,
  };
}

function validateAcceptedPackage(p, key, version) {
  if (
    p.key !== key ||
    p.name !== `@yinaoxiong/paseo-${key}` ||
    p.version !== version ||
    p.file !== `yinaoxiong-paseo-${key}-${version}.tgz` ||
    !Number.isSafeInteger(p.bytes) ||
    p.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(p.sha256) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity)
  )
    throw new Error(`Invalid package ${key}`);
}
function validateAcceptedProof(p, target) {
  if (
    p.target !== target ||
    p.file !== `verification-npm-${target}.json` ||
    !/^[a-f0-9]{64}$/.test(p.sha256)
  )
    throw new Error(`Invalid verification ${target}`);
}

export function assertRegistryVersion(value, accepted) {
  if (
    value?.name !== accepted.name ||
    value.version !== accepted.version ||
    value.dist?.integrity !== accepted.integrity
  )
    throw new Error(`Registry conflict for ${accepted.name}@${accepted.version}`);
}

export async function verifyNpmFiles(directory, approval) {
  const hashed = async (name, expected) => {
    const bytes = await readFile(path.join(directory, name));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`Accepted file digest mismatch ${name}`);
    return bytes;
  };
  const m = JSON.parse(await hashed("manifest-npm.json", approval.manifestSha256));
  if (
    m.sourceSha !== approval.payloadSource ||
    String(m.githubRunId) !== approval.buildRunId ||
    m.version !== approval.version ||
    m.lockSha256 !== approval.lockSha256 ||
    m.assets.length !== 5
  )
    throw new Error("Accepted manifest identity mismatch");
  for (const p of approval.packages) {
    const a = m.assets.find((entry) => entry.name === p.file);
    if (!a || a.sha256 !== p.sha256 || a.bytes !== p.bytes)
      throw new Error(`Manifest conflict ${p.key}`);
    const bytes = await hashed(p.file, p.sha256);
    if (
      bytes.length !== p.bytes ||
      "sha512-" + createHash("sha512").update(bytes).digest("base64") !== p.integrity
    )
      throw new Error(`Accepted package integrity mismatch ${p.key}`);
  }
  for (const proof of approval.proofs) {
    const d = JSON.parse(await hashed(proof.file, proof.sha256));
    validateInstallationProof(d, approval, m.assets, proof.target);
  }
}

function validateInstallationProof(d, approval, assets, target) {
  if (
    d.sourceSha !== approval.payloadSource ||
    String(d.githubRunId) !== approval.buildRunId ||
    d.version !== approval.version ||
    d.lockSha256 !== approval.lockSha256 ||
    JSON.stringify(d.candidateAssets) !== JSON.stringify(assets) ||
    d.validation?.terminal !== "passed" ||
    d.validation?.cleanup !== "passed" ||
    d.registryCleanup !== "passed"
  )
    throw new Error(`Installation proof mismatch ${target}`);
}
