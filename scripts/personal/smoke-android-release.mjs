import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./build-info.mjs";
import {
  assertHealthyAndroidUi,
  visibleAndroidRect,
  androidFrameChanged,
  assertAndroidPanelsClosed,
  assertAndroidFormulaFrameStable,
  androidFrameBrightness,
  assertAndroidDestination,
  androidNodeVisible,
  androidCaptureOptions,
  androidQaWorkspaceRowId,
  assertAndroidWorkspaceSelected,
} from "./android-ui-proof.mjs";

const [apkDir, stateDir, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(apkDir, "qa-build.json"), "utf8"));
const fixture = JSON.parse(readFileSync(path.join(stateDir, "fixture-ready.json"), "utf8"));
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const apk = path.join(apkDir, manifest.apk);
if (
  manifest.sourceSha !== sha ||
  manifest.kind !== "emulator-qa-only" ||
  manifest.abi !== "x86_64" ||
  manifest.buildType !== "release" ||
  !manifest.hermes ||
  manifest.productionSigner !== false ||
  createHash("sha256").update(readFileSync(apk)).digest("hex") !== manifest.apkSha256
)
  throw new Error("QA source/artifact identity mismatch");
if (!Number.isInteger(fixture.port) || fixture.port < 1024 || [6767, 6768].includes(fixture.port))
  throw new Error("Refusing non-isolated daemon port");
const adb = (...args) =>
  execFileSync("adb", args, { ...androidCaptureOptions, encoding: "utf8", timeout: 30000 });
const assertions = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (name) => {
  adb("shell", "uiautomator", "dump", "/sdcard/paseo-qa.xml");
  const xml = adb("shell", "cat", "/sdcard/paseo-qa.xml");
  writeFileSync(path.join(outDir, name + ".xml"), xml);
  writeFileSync(
    path.join(outDir, name + ".png"),
    execFileSync("adb", ["exec-out", "screencap", "-p"], androidCaptureOptions),
  );
  return xml;
};
async function expectUi(name, id, options = {}) {
  let error;
  for (let i = 0; i < 25; i++) {
    try {
      const xml = snapshot(name);
      const nodes = assertHealthyAndroidUi(xml, id);
      assertAndroidDestination(nodes, options);
      if (options.workspace) assertAndroidWorkspaceSelected(nodes, options.workspace);
      assertions.push({ name, expectedId: id, passed: true });
      return nodes;
    } catch (e) {
      error = e;
      if (/root error boundary/.test(e.message)) throw e;
      await pause(1000);
    }
  }
  throw error;
}
const open = (route) =>
  adb(
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    route,
    "sh.paseo.personal",
  );
const swipe = (x1, y1, x2, y2) =>
  adb(
    "shell",
    "input",
    "swipe",
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    "500",
  );
const rawScreen = () => execFileSync("adb", ["exec-out", "screencap"], androidCaptureOptions);
const tapRect = (rect) =>
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round((rect[0] + rect[2]) / 2)),
    String(Math.round((rect[1] + rect[3]) / 2)),
  );
function assertPanelsClosed(nodes, frame) {
  assertAndroidPanelsClosed(nodes);
  assertAndroidFormulaFrameStable(frame, visibleAndroidRect(nodes, "android-math-webview"));
}
try {
  adb("logcat", "-c");
  adb("install", "-r", apk);
  const installed = adb("shell", "dumpsys", "package", "sh.paseo.personal");
  if (!installed.includes(`versionCode=${manifest.androidVersionCode}`))
    throw new Error("Installed QA version mismatch");
  writeFileSync(path.join(outDir, "installed-package.txt"), installed);
  adb("reverse", `tcp:${fixture.port}`, `tcp:${fixture.port}`);
  execFileSync(
    "maestro",
    [
      "test",
      "-e",
      "QA_HOST=127.0.0.1",
      "-e",
      `QA_PORT=${fixture.port}`,
      "--test-output-dir",
      path.join(outDir, "maestro"),
      path.join(repoRoot, "packages/app/maestro/android-release-connect.yaml"),
    ],
    { stdio: "inherit", timeout: 180000 },
  );
  let nodes = await expectUi("connected", "menu-button");
  // Native directory subscriptions follow visible sidebar demand; start through the real user flow.
  tapRect(visibleAndroidRect(nodes, "menu-button"));
  const mathWorkspaceRow = androidQaWorkspaceRowId(fixture);
  nodes = await expectUi("sidebar-directory-ready", mathWorkspaceRow);
  tapRect(visibleAndroidRect(nodes, mathWorkspaceRow));
  await expectUi("workspace-selected", "workspace-header-menu-trigger", { workspace: fixture });
  open(fixture.routes.math);
  nodes = await expectUi("math-open", "android-math-webview", { text: "Math QA marker." });
  // Lifecycle transitions reach the actual native ref detach path.
  open(fixture.routes.plain);
  await expectUi("plain-chat", "message-input-root", { text: "Plain QA ready.", noMath: true });
  open(fixture.routes.math);
  nodes = await expectUi("math-return", "android-math-webview", { text: "Math QA marker." });
  adb("shell", "input", "keyevent", "3");
  await pause(1000);
  const homeFocus = adb("shell", "dumpsys", "window")
    .split("\n")
    .find((line) => line.includes("mCurrentFocus="));
  if (!homeFocus || homeFocus.includes("sh.paseo.personal"))
    throw new Error("Background transition did not leave the app");
  writeFileSync(path.join(outDir, "background-focus.txt"), homeFocus + "\n");
  open(fixture.routes.math);
  nodes = await expectUi("foreground-return", "android-math-webview", { text: "Math QA marker." });
  adb("shell", "cmd", "uimode", "night", "yes");
  await pause(1500);
  nodes = await expectUi("dark-theme", "android-math-webview");
  const darkBrightness = androidFrameBrightness(
    rawScreen(),
    visibleAndroidRect(nodes, "composer-viewport"),
  );
  adb("shell", "cmd", "uimode", "night", "no");
  await pause(1500);
  nodes = await expectUi("light-theme", "android-math-webview");
  const lightBrightness = androidFrameBrightness(
    rawScreen(),
    visibleAndroidRect(nodes, "composer-viewport"),
  );
  if (darkBrightness >= 128 || lightBrightness <= 128 || lightBrightness - darkBrightness < 60)
    throw new Error("App did not visibly change between dark and light themes");
  assertions.push({ name: "observed-theme-change", darkBrightness, lightBrightness, passed: true });
  const [left, top, right, bottom] = visibleAndroidRect(nodes, "android-math-webview");
  const y = (top + bottom) / 2;
  const before = rawScreen();
  swipe(right - 15, y, left + 15, y);
  await pause(500);
  assertPanelsClosed(await expectUi("formula-swipe-left", "android-math-webview"), [
    left,
    top,
    right,
    bottom,
  ]);
  if (!androidFrameChanged(before, rawScreen(), [left, top, right, bottom]))
    throw new Error("Long formula did not actually scroll");
  assertions.push({ name: "formula-content-moved", passed: true });
  swipe(left + 15, y, right - 15, y);
  assertPanelsClosed(await expectUi("formula-swipe-right", "android-math-webview"), [
    left,
    top,
    right,
    bottom,
  ]);
  // Continuing at the right/left limits must not hand this touch sequence to a panel.
  for (let edge = 0; edge < 3; edge++) {
    swipe(left + 15, y, right - 15, y);
    assertPanelsClosed(await expectUi(`formula-left-edge-${edge}`, "android-math-webview"), [
      left,
      top,
      right,
      bottom,
    ]);
  }
  const x = (left + right) / 2;
  const verticalBefore = rawScreen();
  const anchor = nodes.find(
    (n) => /^(Scroll|Earlier) QA line/.test(n.text ?? "") && androidNodeVisible(n, nodes),
  );
  if (!anchor) throw new Error("No visible prose anchor before vertical scroll");
  // Start at the latest reply and move toward the prepared older content.
  swipe(x, top + 10, x, bottom - 10);
  nodes = await expectUi("chat-vertical-scroll", "message-input-root");
  const afterAnchor = nodes.find((n) => n.text === anchor.text && n.rect);
  if (afterAnchor && Math.abs(afterAnchor.rect[1] - anchor.rect[1]) < 5)
    throw new Error("Vertical swipe did not move the chat prose anchor");
  const [cl, ct, cr, cb] = visibleAndroidRect(nodes, "composer-viewport");
  if (!androidFrameChanged(verticalBefore, rawScreen(), [cl, ct, cr, cb]))
    throw new Error("Chat did not actually scroll vertically");
  assertions.push({ name: "chat-content-moved", passed: true });
  // Opening ordinary-content panels still works; assert an actual open control.
  const prose = nodes.find(
    (n) => /^(Scroll|Earlier) QA line/.test(n.text ?? "") && androidNodeVisible(n, nodes),
  );
  if (!prose) throw new Error("No visible ordinary prose for panel swipe");
  const py = (prose.rect[1] + prose.rect[3]) / 2;
  swipe(cl + 35, py, cr - 35, py);
  nodes = await expectUi("left-panel-open", "sidebar-close");
  tapRect(visibleAndroidRect(nodes, "sidebar-close"));
  nodes = await expectUi("left-panel-return", "message-input-root");
  swipe(cr - 35, py, cl + 35, py);
  nodes = await expectUi("right-panel-open", "explorer-tab-files");
  tapRect(visibleAndroidRect(nodes, "explorer-close"));
  await expectUi("right-panel-return", "message-input-root");
  writeFileSync(
    path.join(outDir, "qa-runtime.json"),
    JSON.stringify(
      {
        sourceSha: sha,
        qaApkSha256: manifest.apkSha256,
        qaAbi: "x86_64",
        deliveryArm64RuntimeTest: false,
        assertions,
        installedVersionCode: manifest.androidVersionCode,
        fixturePort: fixture.port,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  writeFileSync(path.join(outDir, "logcat.txt"), adb("logcat", "-d", "-v", "threadtime"));
  adb("shell", "am", "force-stop", "sh.paseo.personal");
  adb("reverse", "--remove", `tcp:${fixture.port}`);
}
