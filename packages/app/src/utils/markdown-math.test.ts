import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "./markdown-parser";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";
import { getMathFormulaRenderModel, markdownMath } from "./markdown-math";

function getMathTokens(markdown: string) {
  const parser = createMarkdownParser({ linkify: true }).use(markdownMath);
  const blockTokens = parser.parse(markdown, {});
  return blockTokens.flatMap((token) =>
    token.type === "inline" && token.children ? token.children : [token],
  );
}

describe("markdownMath", () => {
  it("parses inline and display formulas into dedicated tokens", () => {
    const tokens = getMathTokens("Energy is $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$");

    expect(
      tokens
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content, markup: token.markup })),
    ).toEqual([
      { type: "math_inline", content: "E = mc^2", markup: "$" },
      { type: "math_block", content: "\\int_0^1 x^2 dx", markup: "$$" },
    ]);
  });

  it("supports parenthesis and bracket delimiters emitted by agents", () => {
    const tokens = getMathTokens("Inline \\(x^2\\).\n\n\\[\nE = mc^2\n\\]");

    expect(
      tokens
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content, markup: token.markup })),
    ).toEqual([
      { type: "math_inline", content: "x^2", markup: "\\(" },
      { type: "math_block", content: "E = mc^2", markup: "\\[" },
    ]);
  });

  it("keeps same-line display delimiters inline, including a formula-only paragraph", () => {
    const tokens = getMathTokens("Results: \\[x = 1\\], then $$y = 2$$.\n\n$$z$$");

    expect(
      tokens
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content, markup: token.markup })),
    ).toEqual([
      { type: "math_inline", content: "x = 1", markup: "\\[" },
      { type: "math_inline", content: "y = 2", markup: "$$" },
      { type: "math_inline", content: "z", markup: "$$" },
    ]);
  });

  it("promotes same-line bracket formulas with begin or tag to display math", () => {
    expect(
      getMathTokens("\\[x=1\\tag{1}\\]")
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content })),
    ).toEqual([{ type: "math_block", content: "x=1\\tag{1}" }]);

    expect(
      getMathTokens("\\[\\begin{aligned}x&=1\\end{aligned}\\]")
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content })),
    ).toEqual([{ type: "math_block", content: "\\begin{aligned}x&=1\\end{aligned}" }]);
  });

  it("keeps prose between punctuated same-line formulas", () => {
    const tokens = getMathTokens("$$x$$.\n\ntext\n\n$$y$$");

    expect(
      tokens
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({ type: token.type, content: token.content, markup: token.markup })),
    ).toEqual([
      { type: "math_inline", content: "x", markup: "$$" },
      { type: "math_inline", content: "y", markup: "$$" },
    ]);
  });

  it("parses multiline display formulas with trailing closing-line content", () => {
    const tokens = getMathTokens("$$\nx\n$$.\n\n\\[\ny\n\\] and then");

    expect(
      tokens
        .filter((token) => token.type === "math_block" || token.type === "text")
        .map((token) => ({ type: token.type, content: token.content })),
    ).toEqual([
      { type: "math_block", content: "x" },
      { type: "text", content: "." },
      { type: "math_block", content: "y" },
      { type: "text", content: "and then" },
    ]);
  });

  it("ignores escaped display closers inside multiline formulas", () => {
    const tokens = getMathTokens(
      "$$\n\\$$ is literal\n\nstill math\n$$\n\n\\[\n\\\\] is literal\n\nstill math\n\\]",
    );

    expect(
      tokens.filter((token) => token.type === "math_block").map((token) => token.content),
    ).toEqual(["\\$$ is literal\n\nstill math", "\\\\] is literal\n\nstill math"]);
  });

  it("parses numeric-leading single-dollar formulas without treating prices as math", () => {
    const tokens = getMathTokens("$2x$ + $42$ + $2\\pi$; prices are $300 or $500.");

    expect(
      tokens.filter((token) => token.type.startsWith("math_")).map((token) => token.content),
    ).toEqual(["2x", "42", "2\\pi"]);
  });

  it("promotes fenced math to a display-math token", () => {
    const tokens = getMathTokens("```math\nx^2 + y^2 = z^2\n```");

    expect(
      tokens
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => ({
          type: token.type,
          content: token.content,
          markup: token.markup,
          info: token.info,
        })),
    ).toEqual([
      {
        type: "math_block",
        content: "x^2 + y^2 = z^2\n",
        markup: "```",
        info: "math",
      },
    ]);
  });

  it("leaves currency, escaped delimiters, code, and incomplete formulas literal", () => {
    const tokens = getMathTokens(
      "Costs $300 or $500. Escaped: \\$x$. Code: `$x$`. Incomplete: $x + 1",
    );

    expect(tokens.filter((token) => token.type.startsWith("math_"))).toEqual([]);
  });

  it("leaves incomplete streamed display math as ordinary markdown", () => {
    const source = "\\[\\begin{aligned}\nx&=1\n\\end{aligned}\\]";
    const prefixLengths = [1, 8, 16, source.length - 1];
    for (const end of prefixLengths) {
      expect(
        getMathTokens(source.slice(0, end)).filter((token) => token.type.startsWith("math_")),
      ).toEqual([]);
    }
    expect(
      getMathTokens(source)
        .filter((token) => token.type.startsWith("math_"))
        .map((token) => token.type),
    ).toEqual(["math_block"]);
  });

  it("does not parse math inside links", () => {
    const tokens = getMathTokens("[\\(label\\) and \\[pdf\\]](https://example.com/\\[path\\])");
    expect(tokens.filter((token) => token.type.startsWith("math_"))).toEqual([]);
  });
});

describe("createAssistantMarkdownParser math", () => {
  it("still renders typographer sequences verbatim after enabling math", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("(c) (C) wait for it...")).toBe("(c) (C) wait for it...");
  });

  it("emits escaped formula source from the html renderer", () => {
    const parser = createAssistantMarkdownParser();
    const html = parser.render("Energy is $E = mc^2$.");
    expect(html).toContain('<code class="math-inline">$E = mc^2$</code>');
    expect(html).not.toContain("<script>");
  });
});

describe("getMathFormulaRenderModel", () => {
  it("uses display mode for block tokens and promoted bracket formulas", () => {
    expect(
      getMathFormulaRenderModel({
        type: "math_block",
        content: "x",
        markup: "$$",
      }),
    ).toEqual({
      expression: "x",
      source: "$$\nx\n$$",
      displayMode: true,
    });

    expect(
      getMathFormulaRenderModel({
        type: "math_inline",
        content: "x=1\\tag{1}",
        markup: "\\[",
      }).displayMode,
    ).toBe(true);

    expect(
      getMathFormulaRenderModel({
        type: "math_inline",
        content: "x = 1",
        markup: "\\[",
      }).displayMode,
    ).toBe(false);
  });
});
