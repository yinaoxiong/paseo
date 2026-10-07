import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MathFormula } from "./math-formula.web";

interface MountedFormula {
  root: Root;
  container: HTMLDivElement;
}

const mountedFormulas: MountedFormula[] = [];

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
  for (const mounted of mountedFormulas.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
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
