import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./build-info.mjs";
import {
  androidQaVerifyScope,
  verifyAndroidQaArtifact,
  assertAndroidQaBinding,
} from "./android-qa-reverification.mjs";
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
  androidInteriorHorizontalSwipe,
  assertAndroidThemeSample,
  androidThemePickerRect,
  androidThemeOptionRect,
  assertAndroidThemeSelected,
  androidQaLongFormulaRect,
  androidQaFormulaSwipeRect,
  androidQaWorkspaceRowId,
  assertAndroidWorkspaceSelected,
} from "./android-ui-proof.mjs";

const [apkDir, stateDir, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
mkdirSync(outDir, { recursive: true });
const binding = JSON.parse(readFileSync(path.join(apkDir, "qa-verification-input.json"), "utf8"));
const fixture = JSON.parse(readFileSync(path.join(stateDir, "fixture-ready.json"), "utf8"));
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (
  execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim()
)
  throw new Error("Verifier working tree changed after input admission");
const reuse = process.env.PASEO_BUILD_SCOPE === androidQaVerifyScope;
if (
  binding.mode !== (reuse ? "exact-apk-reverification" : "current-build-verification") ||
  binding.verificationRunId !== (process.env.GITHUB_RUN_ID ?? null) ||
  (reuse &&
    (binding.producerRunId !== process.env.PASEO_ANDROID_QA_RUN_ID ||
      binding.manifestSha256 !== process.env.PASEO_ANDROID_QA_MANIFEST_SHA256)) ||
  (!reuse && binding.payloadSourceSha !== sha)
)
  throw new Error("Unexpected QA input mode/Run binding");
const artifact = verifyAndroidQaArtifact(apkDir, {
  payloadSha: binding.payloadSourceSha,
  manifestHash: binding.manifestSha256,
  runId: binding.producerRunId,
  runAttempt: binding.producerRunAttempt,
});
assertAndroidQaBinding(binding, artifact, sha);
const manifest = artifact.manifest;
const apk = path.join(apkDir, manifest.apk);
if (!Number.isInteger(fixture.port) || fixture.port < 1024 || [6767, 6768].includes(fixture.port))
  throw new Error("Refusing non-isolated daemon port");
const adb = (...args) =>
  execFileSync("adb", args, { ...androidCaptureOptions, encoding: "utf8", timeout: 30000 });
const assertions = [];
const horizontalInputs = [];
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
      if (options.themePicker) androidThemePickerRect(nodes);
      if (options.themeOption) androidThemeOptionRect(nodes, options.themeOption);
      if (options.selectedTheme) assertAndroidThemeSelected(nodes, options.selectedTheme);
      const observed = { name, expectedId: id, passed: true };
      if (options.selectedTheme) observed.selectedTheme = options.selectedTheme;
      if (options.theme) {
        observed.brightness = androidFrameBrightness(
          rawScreen(),
          visibleAndroidRect(nodes, "composer-viewport"),
        );
        assertAndroidThemeSample(observed.brightness, options.theme);
        observed.theme = options.theme;
        observed.method = "app-preference";
      }
      assertions.push(observed);
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
  assertAndroidFormulaFrameStable(frame, androidQaLongFormulaRect(nodes, frame));
}
function horizontalSwipe(name, rect, nodes, direction) {
  const points = androidInteriorHorizontalSwipe(rect, nodes[0]?.rect, direction);
  horizontalInputs.push({ name, contentBounds: rect, viewport: nodes[0].rect, direction, points });
  swipe(...points);
}
let smokeError;
let installedVersionCode = null;
try {
  adb("logcat", "-c");
  adb("install", "-r", apk);
  const installed = adb("shell", "dumpsys", "package", "sh.paseo.personal");
  if (!installed.includes(`versionCode=${manifest.androidVersionCode}`))
    throw new Error("Installed QA version mismatch");
  installedVersionCode = manifest.androidVersionCode;
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
  const selectTheme = async (theme) => {
    open("paseo-personal://settings/appearance");
    let appearance = await expectUi(`appearance-${theme}-open`, "android:id/content", {
      themePicker: true,
      noMath: true,
    });
    tapRect(androidThemePickerRect(appearance));
    appearance = await expectUi(`appearance-${theme}-options`, "android:id/content", {
      themeOption: theme,
      noMath: true,
    });
    tapRect(androidThemeOptionRect(appearance, theme));
    await expectUi(`appearance-${theme}-selected`, "android:id/content", {
      selectedTheme: theme,
      noMath: true,
    });
    open(fixture.routes.math);
    return expectUi(`${theme}-theme`, "android-math-webview", {
      text: "Math QA marker.",
      theme,
    });
  };
  nodes = await selectTheme("dark");
  const darkBrightness = assertions.at(-1).brightness;
  nodes = await selectTheme("light");
  const lightBrightness = assertions.at(-1).brightness;
  if (darkBrightness >= 128 || lightBrightness <= 128 || lightBrightness - darkBrightness < 60)
    throw new Error("App did not visibly change between dark and light themes");
  assertions.push({ name: "observed-theme-change", darkBrightness, lightBrightness, passed: true });
  const [left, top, right, bottom] = androidQaLongFormulaRect(nodes);
  const formulaSwipeRect = androidQaFormulaSwipeRect(nodes, [left, top, right, bottom]);
  const before = rawScreen();
  horizontalSwipe("formula-swipe-left", formulaSwipeRect, nodes, "left");
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
  horizontalSwipe("formula-swipe-right", formulaSwipeRect, nodes, "right");
  assertPanelsClosed(await expectUi("formula-swipe-right", "android-math-webview"), [
    left,
    top,
    right,
    bottom,
  ]);
  // Continuing at the right/left limits must not hand this touch sequence to a panel.
  for (let edge = 0; edge < 3; edge++) {
    horizontalSwipe(`formula-left-edge-${edge}`, formulaSwipeRect, nodes, "right");
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
  horizontalSwipe("left-panel-open", [cl, py - 1, cr, py + 1], nodes, "right");
  nodes = await expectUi("left-panel-open", "sidebar-close");
  tapRect(visibleAndroidRect(nodes, "sidebar-close"));
  nodes = await expectUi("left-panel-return", "message-input-root");
  horizontalSwipe("right-panel-open", [cl, py - 1, cr, py + 1], nodes, "left");
  nodes = await expectUi("right-panel-open", "explorer-tab-files");
  tapRect(visibleAndroidRect(nodes, "explorer-close"));
  await expectUi("right-panel-return", "message-input-root");
} catch (error) {
  smokeError = error;
} finally {
  const cleanup = [];
  for (const [name, action] of [
    [
      "logcat",
      () => writeFileSync(path.join(outDir, "logcat.txt"), adb("logcat", "-d", "-v", "threadtime")),
    ],
    ["app-stop", () => adb("shell", "am", "force-stop", "sh.paseo.personal")],
    ["reverse-remove", () => adb("reverse", "--remove", `tcp:${fixture.port}`)],
  ]) {
    try {
      action();
      cleanup.push({ name, passed: true });
    } catch (error) {
      cleanup.push({ name, passed: false, error: error.message });
      smokeError ??= error;
    }
  }
  writeFileSync(
    path.join(outDir, "qa-runtime.json"),
    JSON.stringify(
      {
        ...binding,
        sourceSha: manifest.sourceSha,
        verifierSourceSha: sha,
        qaApkSha256: manifest.apkSha256,
        qaAbi: "x86_64",
        deliveryArm64RuntimeTest: false,
        runtimeOutcome: smokeError ? "failed" : "passed",
        error: smokeError
          ? { name: smokeError.name, message: smokeError.message.slice(0, 1000) }
          : null,
        assertions,
        horizontalInputs,
        cleanup,
        installedVersionCode,
        fixturePort: fixture.port,
        appearanceCoverage: {
          method: "app-preference",
          automaticSystemFollowing: "not established",
        },
      },
      null,
      2,
    ) + "\n",
  );
}
if (smokeError) throw smokeError;
