const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;
const stableIosBuildSlot = 999;
const FDROID_ABI_VERSION_CODE_SUFFIXES = {
  "armeabi-v7a": 1,
  "arm64-v8a": 2,
  x86: 3,
  x86_64: 4,
};

function getNativeReleaseVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(`Cannot derive native release version from unsupported version: ${version}`);
  }

  const [, majorText, minorText, patchText, betaText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  const betaNumber = betaText === undefined ? null : Number(betaText);

  if (minor > 999 || patch > 999) {
    throw new Error(`Cannot derive collision-free native version from: ${version}`);
  }
  if (betaNumber !== null && (betaNumber < 1 || betaNumber >= stableIosBuildSlot)) {
    throw new Error(`iOS beta number must be between 1 and 998: ${version}`);
  }

  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode * 10 + 9 > 2_100_000_000
  ) {
    throw new Error(`Derived Android versionCode is out of range: ${versionCode}`);
  }

  const iosBuildSlot = betaNumber ?? stableIosBuildSlot;
  const iosBuildNumber = versionCode * 1_000 + iosBuildSlot;
  if (!Number.isSafeInteger(iosBuildNumber)) {
    throw new Error(`Derived iOS buildNumber is out of range: ${iosBuildNumber}`);
  }

  return {
    appVersion: `${major}.${minor}.${patch}`,
    androidVersionCode: versionCode,
    iosBuildNumber: String(iosBuildNumber),
  };
}

function getFdroidVersionCodes(version) {
  const { androidVersionCode } = getNativeReleaseVersion(version);
  return Object.entries(FDROID_ABI_VERSION_CODE_SUFFIXES).map(([abi, suffix]) => ({
    abi,
    versionCode: androidVersionCode * 10 + suffix,
  }));
}

function getPersonalNativeReleaseVersion(version, revision) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Personal builds require an upstream stable version");
  }
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999) {
    throw new Error("Personal revision must be between 1 and 999");
  }
  const native = getNativeReleaseVersion(version);
  // Separate personal package ID: 999 revisions fit below the next upstream patch.
  const androidVersionCode = native.androidVersionCode * 1000 + revision;
  if (androidVersionCode > 2100000000) {
    throw new Error("Personal Android versionCode is out of range");
  }
  return { ...native, androidVersionCode };
}

module.exports = {
  FDROID_ABI_VERSION_CODE_SUFFIXES,
  getFdroidVersionCodes,
  getNativeReleaseVersion,
  getPersonalNativeReleaseVersion,
};
