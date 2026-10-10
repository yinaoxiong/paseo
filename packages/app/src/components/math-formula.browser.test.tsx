import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MathFormula } from "./math-formula.web";
import { mathRuntimeHtml } from "./markdown/math/runtime/html.gen";
import { renderKatexFormulaHtml } from "./math-formula-html";
import {
  parseMathRuntimeMessage,
  type MathRuntimeMessage,
  type MathRuntimeRequest,
} from "./markdown/math/runtime/messages";

interface MountedFormula {
  root: Root;
  container: HTMLDivElement;
}

const mountedFormulas: MountedFormula[] = [];
const mountedMathFrames: HTMLIFrameElement[] = [];

function mountFormula(props: {
  expression: string;
  source: string;
  displayMode: boolean;
  textStyle?: { color?: string };
}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MathFormula {...props} />));
  mountedFormulas.push({ root, container });
  const formula = container.firstElementChild;
  if (!(formula instanceof HTMLElement)) {
    throw new Error("MathFormula did not render an element");
  }
  return formula;
}

afterEach(() => {
  for (const frame of mountedMathFrames.splice(0)) frame.remove();
  for (const mounted of mountedFormulas.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

function runtimeMessage(
  frame: HTMLIFrameElement,
  predicate: (message: MathRuntimeMessage) => boolean,
): Promise<MathRuntimeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Math runtime did not respond"));
    }, 10_000);
    function receive(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) return;
      const message = parseMathRuntimeMessage(event.data);
      if (!message || !predicate(message)) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(message);
    }
    window.addEventListener("message", receive);
  });
}

async function mountMathFrame(): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts", "allow-same-origin");
  const ready = runtimeMessage(frame, (message) => message.type === "ready");
  frame.srcdoc = mathRuntimeHtml;
  document.body.append(frame);
  mountedMathFrames.push(frame);
  await ready;
  return frame;
}

function mathRequest(
  frame: HTMLIFrameElement,
  input: { revision: number; html: string; width: number },
): Promise<MathRuntimeMessage> {
  const response = runtimeMessage(
    frame,
    (message) => message.type === "size" && message.revision === input.revision,
  );
  const request: MathRuntimeRequest = {
    ...input,
    fontSize: 16,
    lineHeight: 24,
    color: "#eeeeee",
    linkColor: "#00aaff",
    codeColor: "#eeeeee",
    codeBackground: "#222222",
  };
  const runtime = frame.contentWindow;
  if (!runtime) throw new Error("Missing iframe runtime");
  runtime.postMessage(request, "*");
  return response;
}

describe("Android offline math HTML runtime", () => {
  it("loads embedded fonts and measures a real inline fraction with Chinese text", async () => {
    const frame = await mountMathFrame();
    const html = `中文 <span class="paseo-inline-math">${renderKatexFormulaHtml("\\frac{1}{2}", false)}</span> 后面文字`;
    const result = await mathRequest(frame, { revision: 1, html, width: 300 });
    if (result.type !== "size") throw new Error("Expected measured size");
    expect(result.width).toBe(300);
    expect(result.height).toBeGreaterThanOrEqual(24);
    expect(result.fontCount).toBeGreaterThan(0);
    expect(frame.contentDocument?.querySelector(".frac-line")).not.toBeNull();
    expect(mathRuntimeHtml).not.toMatch(/url\((?!data:)/);
  });

  it("reflows on width changes without feeding iframe height back into measurements", async () => {
    const frame = await mountMathFrame();
    const html = `中文文字与 ${renderKatexFormulaHtml("x^2", false)} `.repeat(20);
    const wide = await mathRequest(frame, { revision: 1, html, width: 600 });
    const narrow = await mathRequest(frame, { revision: 2, html, width: 200 });
    frame.style.height = "20px";
    const shortFrame = await mathRequest(frame, { revision: 3, html, width: 200 });
    if (wide.type !== "size" || narrow.type !== "size" || shortFrame.type !== "size")
      throw new Error("Expected sizes");
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(shortFrame.height).toBe(narrow.height);
  });

  it("reports links for native handling while refusing an older render revision", async () => {
    const frame = await mountMathFrame();
    const html = '<a href="#" data-link="0">文件</a> ' + renderKatexFormulaHtml("x", false);
    await mathRequest(frame, { revision: 2, html, width: 300 });
    const clicked = runtimeMessage(frame, (message) => message.type === "link");
    const anchor = frame.contentDocument?.querySelector("a");
    if (!anchor) throw new Error("Expected native link proxy");
    anchor.click();
    expect(await clicked).toEqual({ type: "link", revision: 2, index: 0 });
    frame.contentWindow?.postMessage(
      {
        revision: 1,
        html: "OLD",
        width: 300,
        fontSize: 16,
        lineHeight: 24,
        color: "black",
        linkColor: "blue",
        codeColor: "black",
        codeBackground: "transparent",
      },
      "*",
    );
    await mathRequest(frame, { revision: 3, html, width: 300 });
    expect(frame.contentDocument?.getElementById("content")?.textContent).not.toContain("OLD");
    expect(
      frame.contentDocument
        ?.querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    ).toContain("connect-src 'none'");
  });
});

describe("MathFormula", () => {
  it("renders an accessible KaTeX formula", () => {
    const formula = mountFormula({
      expression: "E = mc^2",
      source: "$E = mc^2$",
      displayMode: false,
    });

    expect(formula.querySelector(".katex-html")?.textContent).toContain("E=mc2");
    expect(formula.querySelector("math")?.getAttribute("aria-hidden")).not.toBe("true");
    expect(formula.getAttribute("aria-label")).toBe("$E = mc^2$");
  });

  it("keeps inline fractions compact and structurally rendered", () => {
    const expression = String.raw`\displaystyle x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
    const formula = mountFormula({
      expression,
      source: `$${expression}$`,
      displayMode: false,
    });

    expect(formula.style.fontSize).toBe("0.9em");
    expect(formula.style.verticalAlign).toBe("baseline");
    expect(formula.querySelector("math")?.getAttribute("display")).not.toBe("block");
    expect(formula.querySelector("mfrac")).not.toBeNull();
    expect(formula.querySelector("annotation")?.textContent).not.toContain("\\displaystyle");
    expect(formula.querySelector(".frac-line")).not.toBeNull();
  });

  it("keeps invalid LaTeX visible instead of throwing", () => {
    const formula = mountFormula({
      expression: "\\notacommand{",
      source: "\\[\\notacommand{\\]",
      displayMode: true,
    });

    expect(formula.textContent).toContain("\\notacommand{");
    expect(formula.querySelector(".katex-error")).toBeNull();
  });

  it("paints display math with the markdown foreground color", () => {
    const formula = mountFormula({
      expression: "y = x",
      source: "$$\ny = x\n$$",
      displayMode: true,
      textStyle: { color: "#e8e6e3" },
    });

    expect(formula.style.color).toBe("rgb(232, 230, 227)");
    expect(formula.className).toBe("paseo-math-formula");
  });

  it("loads the KaTeX font from the app's static assets", async () => {
    const faces = await document.fonts.load("16px KaTeX_Main", "x");

    expect(faces.some((face) => face.status === "loaded")).toBe(true);
  });
});
