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
): MathParagraphContent | null {
  const group = node.type === "paragraph" || node.type === "inline" || node.type === "textgroup";
  const link = node.type === "link";
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
    const part = renderNode(child, links);
    if (!part) return null;
    parts.push(part);
  }
  return {
    html: opening + parts.map((part) => part.html).join("") + closing,
    text: parts.map((part) => part.text).join(""),
    links,
  };
}

function renderNode(node: ASTNode, links: AssistantFileLinkSource[]): MathParagraphContent | null {
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
    // Native file/URL actions depend on workspace context, including bare filenames.
    // The prototype retains that path for every inline-code paragraph.
    return null;
  }
  return renderContainer(node, links);
}

export function renderMathParagraph(node: ASTNode): MathParagraphContent | null {
  if (!markdownNodeContainsType(node, "math_inline")) return null;
  return renderNode(node, []);
}
