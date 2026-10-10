// A Pixel's raw RGBA frame exceeds Node's default 1 MiB child-output limit.
export const androidCaptureOptions = Object.freeze({ maxBuffer: 64 * 1024 * 1024 });
export function androidQaWorkspaceRowId(fixture) {
  const serverId = fixture.serverId;
  const workspaceId = fixture.workspaceIds?.math;
  if (
    typeof serverId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(serverId) ||
    typeof workspaceId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(workspaceId) ||
    typeof fixture.routes?.math !== "string"
  )
    throw new Error("Missing QA workspace identity");
  const route = new URL(fixture.routes.math);
  if (
    route.protocol !== "paseo-personal:" ||
    route.hostname !== "h" ||
    route.pathname !== `/${serverId}/workspace/${workspaceId}`
  )
    throw new Error("QA workspace route identity mismatch");
  return `sidebar-workspace-row-${serverId}:${workspaceId}`;
}
export function androidUiNodes(xml) {
  if (!xml.includes("<hierarchy")) throw new Error("Missing Android UI hierarchy");
  return [...xml.matchAll(/<node\s+([^>]+)>?/g)].map((match) => {
    const node = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.bounds ?? "");
    node.rect = bounds ? bounds.slice(1).map(Number) : null;
    return node;
  });
}
const hasId = (node, id) =>
  node["resource-id"] === id || (node["resource-id"] ?? "").endsWith(":id/" + id);
export function androidNodeVisible(node, nodes) {
  const b = node.rect,
    v = nodes[0]?.rect;
  return Boolean(
    b &&
    b[2] > Math.max(0, b[0]) &&
    b[3] > Math.max(0, b[1]) &&
    (!v || (b[0] < v[2] && b[1] < v[3] && b[2] > v[0] && b[3] > v[1])),
  );
}
export function assertHealthyAndroidUi(xml, expectedId) {
  const nodes = androidUiNodes(xml);
  if (
    nodes.some(
      (n) =>
        (n["resource-id"] ?? "").includes("root-error-boundary") ||
        /Object is not a function|Paseo 遇到了问题/.test(n.text),
    )
  )
    throw new Error("Android app entered root error boundary");
  if (!nodes.some((n) => hasId(n, expectedId) && androidNodeVisible(n, nodes)))
    throw new Error(`Normal UI not found: ${expectedId}`);
  return nodes;
}
export function visibleAndroidRect(nodes, id) {
  const node = nodes.findLast((n) => hasId(n, id) && androidNodeVisible(n, nodes));
  if (!node) throw new Error(`No visible measured node: ${id}`);
  return node.rect;
}
export function assertAndroidPanelsClosed(nodes) {
  for (const id of ["sidebar-close", "sidebar-settings", "explorer-close", "explorer-tab-files"]) {
    if (nodes.some((n) => hasId(n, id) && androidNodeVisible(n, nodes)))
      throw new Error(`Formula swipe opened a visible panel control: ${id}`);
  }
}
export function assertAndroidWorkspaceSelected(nodes, fixture) {
  const rowId = androidQaWorkspaceRowId(fixture);
  visibleAndroidRect(nodes, rowId.replace("sidebar-workspace-row-", "workspace-deck-entry-"));
  visibleAndroidRect(nodes, "workspace-header-menu-trigger");
  assertAndroidPanelsClosed(nodes);
}
export function assertAndroidDestination(nodes, options) {
  if (
    options.text &&
    !nodes.some((n) => n.text?.includes(options.text) && androidNodeVisible(n, nodes))
  )
    throw new Error(`Destination text missing: ${options.text}`);
  if (
    options.noMath &&
    nodes.some((n) => hasId(n, "android-math-webview") && androidNodeVisible(n, nodes))
  )
    throw new Error("Math surface still visible in plain chat");
}
export function assertAndroidFormulaFrameStable(before, after) {
  if (before.some((value, index) => Math.abs(value - after[index]) > 2))
    throw new Error("Formula host moved instead of internal scrolling");
}
function decodeFrame(bytes) {
  const width = bytes.readUInt32LE(0),
    height = bytes.readUInt32LE(4),
    format = bytes.readUInt32LE(8);
  const offset = bytes.length - width * height * 4;
  if (format !== 1 || ![12, 16].includes(offset))
    throw new Error("Unsupported raw Android screenshot");
  return { width, height, offset, bytes };
}
function cropRect(frame, rect) {
  const [left, top, right, bottom] = rect.map(Math.round);
  if (
    left < 0 ||
    top < 0 ||
    right > frame.width ||
    bottom > frame.height ||
    right <= left ||
    bottom <= top
  )
    throw new Error("Invalid screenshot crop");
  return [left, top, right, bottom];
}
export function androidFrameChanged(before, after, rect) {
  const a = decodeFrame(before),
    b = decodeFrame(after);
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("Screenshot dimensions changed");
  const [left, top, right, bottom] = cropRect(a, rect);
  let changed = 0;
  for (let y = top + 4; y < bottom - 4; y++)
    for (let x = left + 4; x < right - 4; x++) {
      const p = a.offset + (y * a.width + x) * 4,
        q = b.offset + (y * b.width + x) * 4;
      if (
        Math.abs(a.bytes[p] - b.bytes[q]) +
          Math.abs(a.bytes[p + 1] - b.bytes[q + 1]) +
          Math.abs(a.bytes[p + 2] - b.bytes[q + 2]) >
        60
      )
        changed++;
    }
  return changed > 100;
}
export function androidFrameBrightness(bytes, rect) {
  const frame = decodeFrame(bytes),
    [left, top, right, bottom] = cropRect(frame, rect);
  const histogram = Array(256).fill(0);
  let total = 0;
  for (let y = top + 4; y < bottom - 4; y += 4)
    for (let x = left + 4; x < right - 4; x += 4) {
      const p = frame.offset + (y * frame.width + x) * 4;
      histogram[Math.round(0.2126 * bytes[p] + 0.7152 * bytes[p + 1] + 0.0722 * bytes[p + 2])]++;
      total++;
    }
  if (!total) throw new Error("Empty screenshot crop");
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (cumulative >= total / 2) return value;
  }
  throw new Error("Invalid brightness samples");
}
