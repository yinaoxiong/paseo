import { parseMathRuntimeRequest, type MathRuntimeMessage } from "./messages";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage?: (data: string) => void };
    __PASEO_MATH_RUNTIME_RECEIVE__?: (request: unknown) => void;
  }
}

const content = document.getElementById("content");
if (!content) throw new Error("Missing math content element");
const host = content;
let latestRevision = 0;
let startedAt = 0;
let measuredHeight = 0;
let measuringRevision = 0;

function send(message: MathRuntimeMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) window.parent.postMessage(message, "*");
}

function measure(): void {
  if (!latestRevision || measuringRevision !== latestRevision) return;
  const height = Math.ceil(host.getBoundingClientRect().height);
  if (height < 1 || height === measuredHeight) return;
  measuredHeight = height;
  let fontCount = 0;
  document.fonts.forEach((font) => {
    if (font.status === "loaded" && font.family.startsWith("KaTeX_")) fontCount++;
  });
  send({
    type: "size",
    revision: latestRevision,
    width: host.getBoundingClientRect().width,
    height,
    fontCount,
    renderMs: Math.max(0, performance.now() - startedAt),
  });
}

async function receive(value: unknown): Promise<void> {
  const request = parseMathRuntimeRequest(value);
  if (!request || request.revision <= latestRevision) return;
  latestRevision = request.revision;
  startedAt = performance.now();
  measuredHeight = 0;
  measuringRevision = 0;
  try {
    host.style.width = `${request.width}px`;
    host.style.fontSize = `${request.fontSize}px`;
    host.style.lineHeight = `${request.lineHeight}px`;
    host.style.color = request.color;
    host.style.setProperty("--link-color", request.linkColor);
    host.style.setProperty("--code-color", request.codeColor);
    host.style.setProperty("--code-background", request.codeBackground);
    host.innerHTML = request.html;
    host.getBoundingClientRect();
    await document.fonts.ready;
    if (request.revision !== latestRevision) return;
    measuringRevision = request.revision;
    measure();
  } catch {
    if (request.revision === latestRevision) send({ type: "failed", revision: request.revision });
  }
}

new ResizeObserver(() => measure()).observe(host);
document.fonts.addEventListener("loadingdone", measure);
host.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a[data-link]");
  if (!(link instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  const index = Number(link.dataset.link);
  if (Number.isSafeInteger(index) && index >= 0)
    send({ type: "link", revision: latestRevision, index });
});
window.__PASEO_MATH_RUNTIME_RECEIVE__ = (value) => void receive(value);
window.addEventListener("message", (event) => {
  if (event.source === window.parent) void receive(event.data);
});
send({ type: "ready" });
