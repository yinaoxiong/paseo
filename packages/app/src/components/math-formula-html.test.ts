import { describe, expect, it } from "vitest";
import { escapeFormulaSource, renderKatexFormulaHtml } from "./math-formula-html";
import MarkdownIt from "markdown-it";
import tokensToAST from "react-native-markdown-display/src/lib/util/tokensToAST";
import { markdownMath } from "@/utils/markdown-math";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { renderMathParagraph } from "./markdown/math/paragraph-content";
import { parseMathRuntimeMessage, parseMathRuntimeRequest } from "./markdown/math/runtime/messages";

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

describe("Android math paragraph content", () => {
  it("keeps mixed Chinese prose and emphasis around a rendered inline fraction", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMath);
    const nodes = tokensToAST(parser.parse("中文 **加粗** 与 $\\frac{1}{2}$，后面是文字。", {}));
    const paragraph = nodes.find((node) => node.type === "paragraph");
    if (!paragraph) throw new Error("Expected a paragraph");
    const content = renderMathParagraph(paragraph);
    expect(content?.html).toContain("<strong>加粗</strong>");
    expect(content?.html).toContain("<mfrac>");
    expect(content?.text).toBe("中文 加粗 与 $\\frac{1}{2}$，后面是文字。");
  });

  it("keeps ordinary and image-bearing paragraphs on their original native path", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMath);
    const ordinary = tokensToAST(parser.parse("普通 **文字**", {}))[0];
    const image = tokensToAST(parser.parse("$x$ 和 ![图片](https://example.com/a.png)", {}))[0];
    expect(renderMathParagraph(ordinary)).toBeNull();
    expect(renderMathParagraph(image)).toBeNull();
  });

  it("keeps markup-looking text and invalid formulas visible without executable HTML", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMath);
    const paragraph = tokensToAST(
      parser.parse('<img src=x onerror="bad()"> $\\notacommand{$', {}),
    )[0];
    const content = renderMathParagraph(paragraph);
    expect(content?.html).toContain("&lt;img");
    expect(content?.html).not.toContain("<img");
    expect(content?.html).toContain("$\\notacommand{$");
    expect(content?.text).toBe('<img src=x onerror="bad()"> $\\notacommand{$');
  });

  it("retains links as native actions, not navigable WebView addresses", () => {
    const parser = createAssistantMarkdownParser();
    const withLink = tokensToAST(parser.parse('[文件](file:///tmp/test.md "标题") 与 $x$', {}))[0];
    const content = renderMathParagraph(withLink);
    expect(content?.links).toEqual([
      { href: "file:///tmp/test.md", text: "文件", title: "标题", markup: "", sourceInfo: "" },
    ]);
    expect(content?.html).toContain('<a href="#" data-link="0">文件</a>');
    expect(content?.html).not.toContain("file:///");
    expect(content?.text).toBe("文件 与 $x$");
  });

  it("keeps native automatic inline-code file links instead of replacing their action", () => {
    const parser = new MarkdownIt({ html: false }).use(markdownMath);
    const paragraph = tokensToAST(parser.parse("`src/index.ts:12` 与 $x$", {}))[0];
    expect(renderMathParagraph(paragraph)).toBeNull();
  });

  it("retains the native action for bare filenames mixed with math", () => {
    const parser = createAssistantMarkdownParser();
    const paragraph = tokensToAST(parser.parse("`message-renderer.tsx` 与 $x$", {}))[0];
    expect(renderMathParagraph(paragraph)).toBeNull();
  });

  it("accepts measured sizes but rejects stale-shape and non-finite bridge payloads", () => {
    expect(
      parseMathRuntimeMessage({
        type: "size",
        revision: 1,
        width: 300,
        height: 80,
        fontCount: 2,
        renderMs: 12,
        horizontalScrollRegions: [],
      }),
    ).toEqual({
      type: "size",
      revision: 1,
      width: 300,
      height: 80,
      fontCount: 2,
      renderMs: 12,
      horizontalScrollRegions: [],
    });
    expect(
      parseMathRuntimeMessage({
        type: "size",
        revision: 1,
        width: 300,
        height: Infinity,
        fontCount: 2,
        renderMs: 12,
      }),
    ).toBeNull();
    expect(parseMathRuntimeMessage({ type: "link", revision: 1, index: -1 })).toBeNull();
    expect(parseMathRuntimeRequest({ revision: 0, html: "test", width: 300 })).toBeNull();
  });

  it("validates overflow rectangles before native gesture admission", () => {
    const size = { type: "size", revision: 1, width: 300, height: 80, fontCount: 2, renderMs: 12 };
    const region = { x: 0, y: 20, width: 300, height: 40 };
    expect(parseMathRuntimeMessage({ ...size, horizontalScrollRegions: [region] })).toEqual({
      ...size,
      horizontalScrollRegions: [region],
    });
    expect(
      parseMathRuntimeMessage({ ...size, horizontalScrollRegions: [{ ...region, x: -1 }] }),
    ).toBeNull();
    expect(
      parseMathRuntimeMessage({
        ...size,
        horizontalScrollRegions: [{ ...region, width: Infinity }],
      }),
    ).toBeNull();
    expect(
      parseMathRuntimeMessage({ ...size, horizontalScrollRegions: [{ ...region, y: 60 }] }),
    ).toBeNull();
    expect(
      parseMathRuntimeMessage({ ...size, horizontalScrollRegions: Array(65).fill(region) }),
    ).toBeNull();
  });
});
