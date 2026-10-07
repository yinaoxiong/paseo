import { describe, expect, it } from "vitest";
import { escapeFormulaSource, renderKatexFormulaHtml } from "./math-formula-html";

describe("renderKatexFormulaHtml", () => {
  it("renders an accessible KaTeX formula", () => {
    const html = renderKatexFormulaHtml("E = mc^2", false);
    expect(html).toContain("katex-html");
    expect(html).toContain("<math");
    expect(html).toContain("E = mc^2");
  });

  it("strips leading displaystyle from inline formulas", () => {
    const expression = String.raw`\displaystyle x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
    const html = renderKatexFormulaHtml(expression, false);
    expect(html).toContain("<mfrac");
    expect(html).not.toContain("\\displaystyle");
    expect(html).toContain("frac-line");
  });

  it("returns null for invalid LaTeX so the source stays visible", () => {
    expect(renderKatexFormulaHtml("\\notacommand{", true)).toBeNull();
    expect(escapeFormulaSource("\\[a<b & c>d\\]")).toBe("\\[a&lt;b &amp; c&gt;d\\]");
  });
});
