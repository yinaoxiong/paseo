import React from "react";
import parseNativeMarkdown from "react-native-markdown-display/src/lib/parser";
import { createMathNativeRenderer } from "./markdown/math/native-renderer";
import { renderToString } from "katex";
import { resolveMarkdownInlineCodeLink } from "@/utils/markdown-inline-code-link";
import { BoundedMathCache } from "./markdown/math/render-cache";
import {
  reduceMathHostLayout,
  MathRuntimeRequestDriver,
  type MathHostInput,
  type MathHostMeasurement,
} from "./markdown/math/request-driver";
import { describe, expect, it } from "vitest";
import {
  escapeFormulaSource,
  renderKatexFormulaHtml,
  createMathFormulaRenderer,
} from "./math-formula-html";
import MarkdownIt from "markdown-it";
import tokensToAST from "react-native-markdown-display/src/lib/util/tokensToAST";
import { markdownMath } from "@/utils/markdown-math";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import {
  renderMathParagraph,
  renderMathParagraphParts,
  shouldRenderMathTextGroup,
} from "./markdown/math/paragraph-content";
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

  it("splits native images from formula-bearing runs without dropping nested links or emphasis", () => {
    const node = tokensToAST(
      createAssistantMarkdownParser().parse(
        "**$x$ ![图片](https://example.com/a.png) 后 $y$**",
        {},
      ),
    )[0];
    const parts = renderMathParagraphParts(node);
    expect(parts?.map((part) => part.kind)).toEqual(["html", "native", "html"]);
    expect(parts?.filter((part) => part.kind === "html").map((part) => part.content.html)).toEqual([
      expect.stringContaining("<strong>"),
      expect.stringContaining("<strong>"),
    ]);
    const native = parts?.find((part) => part.kind === "native");
    expect(JSON.stringify(native?.node)).toContain("https://example.com/a.png");
    const linked = tokensToAST(
      createAssistantMarkdownParser().parse(
        "[![图片](https://example.com/a.png)](file:///tmp/a) $x$",
        {},
      ),
    )[0];
    const linkedParts = renderMathParagraphParts(linked);
    expect(linkedParts?.map((part) => part.kind)).toEqual(["native", "html"]);
    expect(JSON.stringify(linkedParts?.[0].node)).toContain("file:///tmp/a");
    expect(
      linkedParts
        ?.filter((part) => part.kind === "html")
        .every((part) => !part.content.html.includes("<img")),
    ).toBe(true);
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

  it("renders inline-code file actions with math when an explicit native resolver is supplied", () => {
    const paragraph = tokensToAST(
      createAssistantMarkdownParser().parse("`message-renderer.tsx` 与 $x$", {}),
    )[0];
    const source = {
      href: "message-renderer.tsx",
      text: "message-renderer.tsx",
      sourceType: "inline-code" as const,
    };
    const content = renderMathParagraph(paragraph, { resolveInlineCode: () => source });
    expect(content?.html).toContain(
      '<a href="#" data-link="0"><code>message-renderer.tsx</code></a>',
    );
    expect(content?.html).toContain("katex-html");
    expect(content?.links).toEqual([source]);
    expect(content?.text).toBe("message-renderer.tsx 与 $x$");
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

describe("bounded math render cache and host lifecycle", () => {
  it("evicts least recently used entries and bounds both count and retained text", () => {
    const cache = new BoundedMathCache<string>(2, 20);
    cache.set("a", "a", 6);
    cache.set("b", "b", 6);
    expect(cache.get("a")).toBe("a");
    cache.set("c", "c", 6);
    expect(cache.get("b")).toBeUndefined();
    cache.set("oversize", "too large", 21);
    expect(cache.snapshot()).toEqual({ entries: 2, cost: 12 });
    cache.set("d", "d", 18);
    expect(cache.snapshot()).toEqual({ entries: 1, cost: 18 });
  });

  it("queues only the newest request before ready and rejects reload/unmount stale sizes", () => {
    const cache = new BoundedMathCache<MathHostMeasurement>(8, 100000);
    const driver = new MathRuntimeRequestDriver("runtime-v1", cache);
    const input: MathHostInput = {
      html: "first",
      width: 300,
      fontSize: 16,
      lineHeight: 24,
      color: "black",
      linkColor: "blue",
      codeColor: "black",
      codeBackground: "white",
    };
    driver.update(input);
    driver.update({ ...input, html: "latest" });
    const request = driver.ready();
    expect(request?.html).toBe("latest");
    const size = {
      type: "size" as const,
      revision: request!.revision,
      width: 300,
      height: 40,
      fontCount: 1,
      renderMs: 3,
      horizontalScrollRegions: [],
    };
    expect(driver.accept(size)).toEqual(size);
    driver.reload();
    expect(driver.accept(size)).toBeNull();
    const reloaded = driver.ready();
    expect(reloaded!.revision).toBeGreaterThan(request!.revision);
    driver.stop();
    expect(driver.accept({ ...size, revision: reloaded!.revision })).toBeNull();
    expect(driver.ready()).toBeNull();
  });

  it("uses distinct measured-layout keys for width, font scale, theme and runtime", () => {
    const cache = new BoundedMathCache<MathHostMeasurement>(8, 100000);
    const input: MathHostInput = {
      html: "formula",
      width: 300,
      fontSize: 16,
      lineHeight: 24,
      color: "black",
      linkColor: "blue",
      codeColor: "black",
      codeBackground: "white",
    };
    const first = new MathRuntimeRequestDriver("runtime-v1", cache);
    first.update(input);
    const req = first.ready()!;
    first.accept({
      type: "size",
      revision: req.revision,
      width: 300,
      height: 40,
      fontCount: 1,
      renderMs: 3,
      horizontalScrollRegions: [],
    });
    expect(new MathRuntimeRequestDriver("runtime-v1", cache).update(input).cached?.height).toBe(40);
    for (const changed of [
      { ...input, width: 200 },
      { ...input, fontSize: 24 },
      { ...input, color: "white" },
      { ...input, html: "new" },
    ])
      expect(new MathRuntimeRequestDriver("runtime-v1", cache).update(changed).cached).toBeNull();
    expect(new MathRuntimeRequestDriver("runtime-v2", cache).update(input).cached).toBeNull();
  });
});

describe("formal math action and recovery regressions", () => {
  it("shares the existing inline-code URL matching and preserves bare filename source type", () => {
    const parser = createAssistantMarkdownParser();
    expect(resolveMarkdownInlineCodeLink(parser, "message-renderer.tsx", () => true)).toEqual({
      href: "message-renderer.tsx",
      text: "message-renderer.tsx",
      sourceType: "inline-code",
    });
    expect(resolveMarkdownInlineCodeLink(parser, "https://example.com", () => false)).toEqual({
      href: "https://example.com",
      text: "https://example.com",
      markup: "linkify",
      sourceInfo: "auto",
    });
    expect(
      resolveMarkdownInlineCodeLink(parser, "code https://example.com tail", () => false),
    ).toBeNull();
    const node = tokensToAST(parser.parse("[`src/a.ts`](file:///different) 与 $x$", {}))[0];
    let calls = 0;
    const result = renderMathParagraph(node, {
      resolveInlineCode: () => {
        calls++;
        return null;
      },
    });
    expect(calls).toBe(0);
    expect(result?.links.map((link) => link.href)).toEqual(["file:///different"]);
    expect(result?.html).toContain("<code>src/a.ts</code>");
  });

  it("recovers from rendering failure without accepting old geometry or exposing a blank cache hit", () => {
    const state = {
      width: 300,
      height: 40,
      failed: false,
      painted: true,
      measuredWidth: 300,
      regions: [],
    };
    const failed = reduceMathHostLayout(state, { type: "failed" });
    const pending = reduceMathHostLayout(failed, { type: "pending" });
    expect(pending).toMatchObject({ failed: false, painted: false, height: null });
    expect(
      reduceMathHostLayout(pending, { type: "size", width: 300, height: 80, regions: [] }),
    ).toMatchObject({ failed: false, painted: true, height: 80 });
    expect(reduceMathHostLayout(state, { type: "width", width: 200 })).toMatchObject({
      height: null,
      painted: false,
      regions: [],
    });
    expect(reduceMathHostLayout(state, { type: "document" }).painted).toBe(false);
  });

  it("queues a single retry after a dead WebView and binds timeouts to the current revision", () => {
    const driver = new MathRuntimeRequestDriver("runtime-v1");
    const input = {
      html: "first",
      width: 300,
      fontSize: 16,
      lineHeight: 24,
      color: "black",
      linkColor: "blue",
      codeColor: "black",
      codeBackground: "white",
    };
    driver.update(input);
    const old = driver.ready()!;
    driver.failedTransport();
    expect(driver.accept({ type: "link", revision: old.revision, index: 0 })).toBeNull();
    const retry = driver.update({ ...input, html: "next" });
    expect(retry.reload).toBe(true);
    expect(retry.request).toBeNull();
    expect(driver.update({ ...input, html: "next" }).reload).toBe(false);
    driver.failedTransport();
    expect(driver.update({ ...input, html: "yet another streamed prefix" }).reload).toBe(false);
    const newest = driver.ready()!;
    expect(driver.expire(old.revision)).toBe(false);
    expect(driver.expire(newest.revision)).toBe(true);
    driver.stop();
    expect(driver.expire(newest.revision)).toBe(false);
    driver.start();
    expect(driver.update(input).request?.html).toBe("first");
  });

  it("renders a fixed 30-formula sample only once during repeated history visits", () => {
    let calls = 0;
    const render = createMathFormulaRenderer((source, options) => {
      calls++;
      return renderToString(source, options);
    });
    const samples = Array.from({ length: 30 }, (_, i) => `\\frac{x_${i}}{1+x_${i}}`);
    const first = samples.map((sample) => render(sample, false));
    expect(calls).toBe(30);
    for (let visit = 0; visit < 3; visit++)
      expect(samples.map((sample) => render(sample, false))).toEqual(first);
    expect(calls).toBe(30);
    expect(render("x", true)).not.toEqual(render("x", false));
  });
});

describe("actual native markdown pipeline", () => {
  it("retains linked image preview and file-link dispatch through real parser cleanup and AstRenderer", () => {
    const parser = createAssistantMarkdownParser();
    const nodes = parseNativeMarkdown(
      "[![图片](https://example.com/a.png)](file:///tmp/image) 与 $x$",
      (tree) => tree,
      parser,
    );
    const parts = renderMathParagraphParts(nodes[0]);
    expect(parts?.map((part) => part.kind)).toEqual(["native", "html"]);
    const opened: string[] = [];
    const previews: string[] = [];
    const renderer = createMathNativeRenderer(
      {
        text: (node) => node.content,
        textgroup: (_node, children) => children,
        image: (node) =>
          React.createElement("img", {
            src: node.attributes.src,
            onClick: () => previews.push(node.attributes.src),
          }),
        blocklink: (node, children, _parents, _styles, onLinkPress) =>
          React.createElement(
            "a",
            { onClick: () => onLinkPress?.(node.attributes.href) },
            children,
          ),
      },
      {},
      (url) => {
        opened.push(url);
        return false;
      },
    );
    const rendered = renderer.renderNode(parts![0].node, []) as React.ReactElement<{
      onClick(): void;
      children: React.ReactElement<{ onClick(): void }>[];
    }>[];
    const link = rendered
      .flat(Infinity)
      .find((element) => React.isValidElement(element) && element.type === "a")!;
    link.props.onClick();
    const image = link.props.children
      .flat(Infinity)
      .find((element) => React.isValidElement(element) && element.type === "img")!;
    image.props.onClick();
    expect(opened).toEqual(["file:///tmp/image"]);
    expect(previews).toEqual(["https://example.com/a.png"]);
    expect(parts![1].kind === "html" && parts![1].content.html).toContain("katex-html");
  });

  it("renders multiple formulas and inline code in real textgroup nodes while ordinary paragraphs stay native", () => {
    const parser = createAssistantMarkdownParser();
    const paragraph = parseNativeMarkdown(
      "中文 `message-renderer.tsx` 与 $x$ 后 $y$",
      (tree) => tree,
      parser,
    )[0];
    const result = renderMathParagraph(paragraph, {
      resolveInlineCode: (text) => resolveMarkdownInlineCodeLink(parser, text, () => true),
    });
    expect(result?.links).toEqual([
      { href: "message-renderer.tsx", text: "message-renderer.tsx", sourceType: "inline-code" },
    ]);
    expect(result?.html.match(/class="paseo-inline-math"/g)).toHaveLength(2);
    expect(
      renderMathParagraphParts(parseNativeMarkdown("普通文字", (tree) => tree, parser)[0]),
    ).toBeNull();
  });
});

describe("native list and mixed history coverage", () => {
  it("admits tight-list formula textgroups only when no paragraph host owns them", () => {
    const parser = createAssistantMarkdownParser();
    const nodes = parseNativeMarkdown("- 普通条目\n- 数学 $x$ 和 $y$\n", (tree) => tree, parser);
    const matches: Array<{ node: (typeof nodes)[number]; parents: typeof nodes }> = [];
    const visit = (node: (typeof nodes)[number], parents: typeof nodes) => {
      if (shouldRenderMathTextGroup(node, parents)) matches.push({ node, parents });
      for (const child of node.children) visit(child, [node, ...parents]);
    };
    for (const node of nodes) visit(node, []);
    expect(matches).toHaveLength(1);
    const parts = renderMathParagraphParts(matches[0].node);
    expect(parts?.filter((part) => part.kind === "html")).toHaveLength(1);
    expect(
      parts?.[0].kind === "html" && parts[0].content.html.match(/class="paseo-inline-math"/g),
    ).toHaveLength(2);
    const paragraph = parseNativeMarkdown("数学 $x$", (tree) => tree, parser)[0];
    expect(shouldRenderMathTextGroup(paragraph.children[0], [paragraph])).toBe(false);
  });

  it("keeps 70 ordinary messages native in a fixed 100-message sample with 30 formula messages", () => {
    const parser = createAssistantMarkdownParser();
    let htmlHosts = 0;
    let nativeImages = 0;
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      let source = `普通消息 ${i}`;
      if (i < 30) {
        if (i % 3 === 0) source = `- 数学 $x_${i}$ 与 $y_${i}$`;
        else if (i % 3 === 1) source = `![图片](https://example.com/${i}.png) 后 $x_${i}$`;
        else source = `\n> 中文 $x_${i}$ 与 **强调** 和 \`file-${i}.ts\``;
      }
      const nodes = parseNativeMarkdown(source, (tree) => tree, parser);
      const visit = (node: (typeof nodes)[number], parents: typeof nodes) => {
        if (node.type === "paragraph" || shouldRenderMathTextGroup(node, parents)) {
          const parts = renderMathParagraphParts(node, {
            resolveInlineCode: (text) => resolveMarkdownInlineCodeLink(parser, text, () => true),
          });
          if (parts) {
            htmlHosts += parts.filter((part) => part.kind === "html").length;
            nativeImages += parts.filter(
              (part) =>
                part.kind === "native" && JSON.stringify(part.node).includes('"type":"image"'),
            ).length;
            return;
          }
        }
        for (const child of node.children) visit(child, [node, ...parents]);
      };
      for (const node of nodes) visit(node, []);
    }
    console.info(
      JSON.stringify({
        sample: "100 mixed messages / 30 formula messages",
        htmlHosts,
        nativeImages,
        parseAndRenderMs: performance.now() - start,
        nativeMemory: "not measured",
      }),
    );
    expect(htmlHosts).toBe(30);
    expect(nativeImages).toBe(10);
  });
});

describe("native image paragraph context", () => {
  it("preserves leading-content spacing when formula runs are split around the original image", () => {
    const parser = createAssistantMarkdownParser();
    const node = parseNativeMarkdown(
      "$x$ ![图片](https://example.com/a.png) 后 $y$",
      (tree) => tree,
      parser,
    )[0];
    const parts = renderMathParagraphParts(node)!;
    const originalImage = node.children.find((child) => child.type === "image")!;
    const originalIndex = node.children.indexOf(originalImage);
    expect(originalIndex).toBeGreaterThan(0);
    let leading = false;
    const renderer = createMathNativeRenderer(
      {
        text: (current) => current.content,
        image: (current, _children, parents) => {
          const paragraph = parents.find((parent) => parent.type === "paragraph")!;
          leading = paragraph.children.findIndex((child) => child.key === current.key) > 0;
          return null;
        },
      },
      {},
      () => false,
      node,
    );
    const imagePart = parts.find((part) => part.kind === "native")!;
    renderer.renderNode(imagePart.node, []);
    expect(leading).toBe(true);
  });
});

describe("retained math viewport restoration", () => {
  it("rejects pending geometry while width is zero and requests a fresh measurement after restoration", () => {
    const driver = new MathRuntimeRequestDriver("runtime-v1");
    const input = {
      html: "same content",
      width: 300,
      fontSize: 16,
      lineHeight: 24,
      color: "black",
      linkColor: "blue",
      codeColor: "black",
      codeBackground: "white",
    };
    driver.update(input);
    const old = driver.ready()!;
    driver.update({ ...input, width: 0 });
    expect(
      driver.accept({
        type: "size",
        revision: old.revision,
        width: 300,
        height: 40,
        fontCount: 1,
        renderMs: 1,
        horizontalScrollRegions: [],
      }),
    ).toBeNull();
    const restored = driver.update(input).request!;
    expect(restored.revision).toBeGreaterThan(old.revision);
    expect(restored.html).toBe(input.html);
  });
});

describe("math document readiness ordering", () => {
  it("requires a fresh acknowledgement for each document-ready event and rejects the previous document's size", () => {
    const driver = new MathRuntimeRequestDriver("runtime-v1");
    const input = {
      html: "current",
      width: 300,
      fontSize: 16,
      lineHeight: 24,
      color: "black",
      linkColor: "blue",
      codeColor: "black",
      codeBackground: "white",
    };
    driver.update(input);
    const first = driver.ready()!;
    const current = driver.ready()!;
    expect(current.revision).toBeGreaterThan(first.revision);
    const oldSize = {
      type: "size" as const,
      revision: first.revision,
      width: 300,
      height: 40,
      fontCount: 1,
      renderMs: 1,
      horizontalScrollRegions: [],
    };
    expect(driver.accept(oldSize)).toBeNull();
    expect(driver.accept({ ...oldSize, revision: current.revision })).not.toBeNull();
    const nextReady = driver.ready()!;
    expect(nextReady.revision).toBeGreaterThan(current.revision);
    expect(nextReady.html).toBe(input.html);
  });
});
