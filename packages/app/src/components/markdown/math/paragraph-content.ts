import type { ASTNode } from "react-native-markdown-display";
import type { AssistantFileLinkSource } from "@/assistant-file-links/resolver";
import { markdownNodeContainsType } from "@/utils/markdown-ast";
import { getMathFormulaRenderModel } from "@/utils/markdown-math";
import { escapeFormulaSource, renderKatexFormulaHtml } from "../../math-formula-html";

export interface MathParagraphContent {
  html: string;
  text: string;
  links: AssistantFileLinkSource[];
}

export interface MathParagraphOptions {
  resolveInlineCode: (content: string) => AssistantFileLinkSource | null;
}

const INLINE_TAGS = new Map([
  ["strong", "strong"],
  ["em", "em"],
  ["s", "s"],
]);

function nodeText(node: ASTNode): string {
  if (!node.children.length) return node.content;
  return node.children.map(nodeText).join("");
}

function renderContainer(
  node: ASTNode,
  links: AssistantFileLinkSource[],
  options?: MathParagraphOptions,
  insideLink = false,
): MathParagraphContent | null {
  const group = node.type === "paragraph" || node.type === "inline" || node.type === "textgroup";
  const link = node.type === "link" || node.type === "blocklink";
  const tag = INLINE_TAGS.get(node.type);
  if (!group && !link && !tag) return null;

  let opening = tag ? `<${tag}>` : "";
  let closing = tag ? `</${tag}>` : "";
  if (link) {
    const href: unknown = node.attributes.href;
    if (typeof href !== "string") return null;
    const index = links.length;
    links.push({
      href,
      text: nodeText(node),
      title: typeof node.attributes.title === "string" ? node.attributes.title : undefined,
      markup: node.markup,
      sourceInfo: node.sourceInfo,
    });
    opening = `<a href="#" data-link="${index}">`;
    closing = "</a>";
  }
  const parts: MathParagraphContent[] = [];
  for (const child of node.children) {
    const part = renderNode(child, links, options, insideLink || link);
    if (!part) return null;
    parts.push(part);
  }
  return {
    html: opening + parts.map((part) => part.html).join("") + closing,
    text: parts.map((part) => part.text).join(""),
    links,
  };
}

function renderNode(
  node: ASTNode,
  links: AssistantFileLinkSource[],
  options?: MathParagraphOptions,
  insideLink = false,
): MathParagraphContent | null {
  if (node.type === "text") {
    return { html: escapeFormulaSource(node.content), text: node.content, links };
  }
  if (node.type === "softbreak" || node.type === "hardbreak") {
    return { html: "<br />", text: "\n", links };
  }
  if (node.type === "math_inline" || node.type === "math_block") {
    const model = getMathFormulaRenderModel(node);
    const formula = renderKatexFormulaHtml(model.expression, model.displayMode);
    const className = model.displayMode ? "paseo-display-math" : "paseo-inline-math";
    const html = `<span class="${className}">${formula ?? escapeFormulaSource(model.source)}</span>`;
    return { html, text: model.source, links };
  }
  if (node.type === "code_inline") {
    // A caller must explicitly preserve contextual file and URL actions.
    if (!options) return null;
    let html = `<code>${escapeFormulaSource(node.content)}</code>`;
    const source = insideLink ? null : options.resolveInlineCode(node.content);
    if (source) {
      const index = links.length;
      links.push(source);
      html = `<a href="#" data-link="${index}">${html}</a>`;
    }
    return { html, text: node.content, links };
  }
  return renderContainer(node, links, options, insideLink);
}

export function renderMathParagraph(
  node: ASTNode,
  options?: MathParagraphOptions,
): MathParagraphContent | null {
  if (!markdownNodeContainsType(node, "math_inline")) return null;
  return renderNode(node, [], options);
}

export type MathParagraphPart =
  | { kind: "html"; key: string; node: ASTNode; content: MathParagraphContent }
  | { kind: "native"; key: string; node: ASTNode };

// Split only at native images. Rebuild their surrounding AST containers so the
// existing renderer retains image preview, linked-image actions and styling.
function splitImageRuns(node: ASTNode): ASTNode[] {
  if (node.type === "image" || !markdownNodeContainsType(node, "image")) return [node];
  const runs: ASTNode[] = [];
  let children: ASTNode[] = [];
  const flush = () => {
    if (children.length) runs.push({ ...node, children });
    children = [];
  };
  for (const child of node.children) {
    for (const part of splitImageRuns(child)) {
      if (markdownNodeContainsType(part, "image")) {
        flush();
        runs.push({ ...node, children: [part] });
      } else children.push(part);
    }
  }
  flush();
  return runs;
}

export function renderMathParagraphParts(
  node: ASTNode,
  options?: MathParagraphOptions,
): MathParagraphPart[] | null {
  if (!markdownNodeContainsType(node, "math_inline")) return null;
  return splitImageRuns(node).map((part, index) => {
    const content = renderMathParagraph(part, options);
    const key = `${node.key}:${index}`;
    return content
      ? { kind: "html", key, node: part, content }
      : { kind: "native", key, node: part };
  });
}

export function shouldRenderMathTextGroup(node: ASTNode, parents: ASTNode[]): boolean {
  return (
    node.type === "textgroup" &&
    !parents.some((parent) => parent.type === "paragraph") &&
    markdownNodeContainsType(node, "math_inline")
  );
}
