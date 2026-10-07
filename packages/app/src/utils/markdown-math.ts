import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";

interface MathDelimiter {
  opening: "$$" | "\\[";
  closing: "$$" | "\\]";
}

export type DisplayMathClosing = MathDelimiter["closing"];

export interface DisplayMathDelimiter {
  closing: DisplayMathClosing;
  closesOnOpeningLine: boolean;
}

interface InlineMathDelimiter {
  opening: "$" | "$$" | "\\(" | "\\[";
  closing: "$" | "$$" | "\\)" | "\\]";
  isSingleDollar: boolean;
}

export interface MathTokenSource {
  type: string;
  content: string;
  markup: string;
  sourceInfo?: string;
}

export interface MathFormulaRenderModel {
  expression: string;
  source: string;
  displayMode: boolean;
}

const DISPLAY_MATH_DELIMITERS: MathDelimiter[] = [
  { opening: "$$", closing: "$$" },
  { opening: "\\[", closing: "\\]" },
];

const INLINE_MATH_DELIMITERS: InlineMathDelimiter[] = [
  { opening: "\\(", closing: "\\)", isSingleDollar: false },
  { opening: "\\[", closing: "\\]", isSingleDollar: false },
  { opening: "$$", closing: "$$", isSingleDollar: false },
  { opening: "$", closing: "$", isSingleDollar: true },
];

const DISPLAY_PROMOTER = /\\(?:begin|tag)\b/;

function isEscaped(source: string, position: number): boolean {
  let backslashCount = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) {
    backslashCount++;
  }
  return backslashCount % 2 === 1;
}

export function findUnescapedDelimiter(source: string, delimiter: string): number {
  let searchStart = 0;

  while (searchStart < source.length) {
    const delimiterStart = source.indexOf(delimiter, searchStart);
    if (delimiterStart === -1) {
      return -1;
    }
    if (!isEscaped(source, delimiterStart)) {
      return delimiterStart;
    }
    searchStart = delimiterStart + delimiter.length;
  }

  return -1;
}

function stripMarkdownContainerPrefix(line: string): string {
  let remainder = line;
  let foundContainer = false;

  while (true) {
    const blockquote = /^ {0,3}>[ \t]?/.exec(remainder);
    if (blockquote) {
      remainder = remainder.slice(blockquote[0].length);
      foundContainer = true;
      continue;
    }

    const listItem = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(remainder);
    if (listItem) {
      remainder = remainder.slice(listItem[0].length);
      foundContainer = true;
      continue;
    }

    return foundContainer ? remainder : line;
  }
}

export function getDisplayMathDelimiter(line: string): DisplayMathDelimiter | null {
  const content = stripMarkdownContainerPrefix(line);
  const match = /^ {0,3}(\$\$|\\\[)/.exec(content);
  if (!match) {
    return null;
  }

  const opening = match[1];
  const closing: DisplayMathClosing = opening === "$$" ? "$$" : "\\]";
  const remainder = content.slice(match[0].length);
  return {
    closing,
    closesOnOpeningLine: findUnescapedDelimiter(remainder, closing) !== -1,
  };
}

function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const end = state.eMarks[startLine];
  const openingLine = state.src.slice(start, end);
  const delimiter = DISPLAY_MATH_DELIMITERS.find(({ opening }) => openingLine.startsWith(opening));
  if (!delimiter) {
    return false;
  }

  const openingRemainder = openingLine.slice(delimiter.opening.length);
  // Same-line $$x$$ / \[x\] stay inline, matching remark-math / Cherry Studio.
  if (findUnescapedDelimiter(openingRemainder, delimiter.closing) >= 0) {
    return false;
  }

  const contentLines: string[] = [];
  if (openingRemainder.length > 0) {
    contentLines.push(openingRemainder);
  }

  let trailingContent = "";
  let closingLine = startLine + 1;
  for (; closingLine < endLine; closingLine++) {
    const lineStart = state.bMarks[closingLine] + state.tShift[closingLine];
    const lineEnd = state.eMarks[closingLine];
    const line = state.src.slice(lineStart, lineEnd);
    const closingStart = findUnescapedDelimiter(line, delimiter.closing);
    if (closingStart === -1) {
      contentLines.push(line);
      continue;
    }

    const closingPrefix = line.slice(0, closingStart);
    if (closingPrefix.length > 0) {
      contentLines.push(closingPrefix);
    }
    trailingContent = line.slice(closingStart + delimiter.closing.length).trimStart();
    break;
  }

  if (closingLine >= endLine) {
    return false;
  }

  const content = contentLines.join("\n").trim();
  if (content.length === 0) {
    return false;
  }
  if (silent) {
    return true;
  }

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content;
  token.markup = delimiter.opening;
  token.map = [startLine, closingLine + 1];
  if (trailingContent.length > 0) {
    const paragraphOpen = state.push("paragraph_open", "p", 1);
    paragraphOpen.map = [closingLine, closingLine + 1];

    const inline = state.push("inline", "", 0);
    inline.content = trailingContent;
    inline.map = [closingLine, closingLine + 1];
    inline.children = [];

    state.push("paragraph_close", "p", -1);
  }
  state.line = closingLine + 1;
  return true;
}

function getInlineMathDelimiter(source: string, start: number): InlineMathDelimiter | null {
  if (isEscaped(source, start)) {
    return null;
  }

  for (const delimiter of INLINE_MATH_DELIMITERS) {
    if (!source.startsWith(delimiter.opening, start)) {
      continue;
    }

    const isDollarDelimiter = delimiter.opening.startsWith("$");
    const previous = source[start - 1] ?? "";
    const followsWordCharacter = /[A-Za-z0-9]/.test(previous);
    if (isDollarDelimiter && followsWordCharacter) {
      return null;
    }
    if (delimiter.isSingleDollar && source[start + 1] === "$") {
      continue;
    }
    return delimiter;
  }

  return null;
}

function findInlineMathClosing(
  source: string,
  contentStart: number,
  closing: InlineMathDelimiter["closing"],
  maximum: number,
): number | null {
  let closingStart = contentStart;
  while (closingStart < maximum) {
    closingStart = source.indexOf(closing, closingStart);
    if (closingStart === -1 || closingStart >= maximum) {
      return null;
    }
    if (!isEscaped(source, closingStart)) {
      return closingStart;
    }
    closingStart += closing.length;
  }
  return null;
}

function startsLikeCurrency(content: string): boolean {
  const number = /^\d[\d,.]*/.exec(content);
  if (!number) {
    return false;
  }

  const afterNumber = content.slice(number[0].length);
  if (afterNumber.length === 0 || /^[A-Za-z\\+\-*/=^_]/.test(afterNumber)) {
    return false;
  }

  return !/^[+\-*/=^_\\]/.test(afterNumber.trimStart());
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const source = state.src;
  const start = state.pos;
  const delimiter = getInlineMathDelimiter(source, start);
  if (!delimiter) {
    return false;
  }

  const contentStart = start + delimiter.opening.length;
  if (contentStart >= state.posMax || /\s/.test(source[contentStart])) {
    return false;
  }

  const closingStart = findInlineMathClosing(source, contentStart, delimiter.closing, state.posMax);
  if (closingStart === null) {
    return false;
  }

  const content = source.slice(contentStart, closingStart);
  const crossesLineBoundary = content.includes("\n");
  const allowNewlines = delimiter.opening === "\\[" || delimiter.opening === "$$";
  if (content.length === 0) {
    return false;
  }
  if (crossesLineBoundary && !allowNewlines) {
    return false;
  }
  if (/\s/.test(content[content.length - 1] ?? "")) {
    return false;
  }

  if (delimiter.isSingleDollar && startsLikeCurrency(content)) {
    return false;
  }

  const closesBeforeAnotherAmount =
    delimiter.isSingleDollar && /^\d/.test(content) && /\d/.test(source[closingStart + 1] ?? "");
  if (closesBeforeAnotherAmount) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.markup = delimiter.opening;
  }
  state.pos = closingStart + delimiter.closing.length;
  return true;
}

function shouldPromoteInlineMath(token: Token): boolean {
  if (token.type !== "math_inline") {
    return false;
  }
  if (token.markup !== "\\[") {
    return false;
  }
  return token.content.includes("\n") || DISPLAY_PROMOTER.test(token.content);
}

function createParagraphTokens(state: StateCore, children: Token[], template: Token): Token[] {
  if (children.length === 0) {
    return [];
  }

  const open = new state.Token("paragraph_open", "p", 1);
  open.block = true;
  open.map = template.map;

  const inline = new state.Token("inline", "", 0);
  inline.children = children;
  inline.map = template.map;
  inline.content = children.map((child) => child.content).join("");

  const close = new state.Token("paragraph_close", "p", -1);
  close.block = true;

  return [open, inline, close];
}

function mathTokenToText(state: StateCore, token: Token): Token {
  const text = new state.Token("text", "", 0);
  const model = getMathFormulaRenderModel({
    type: token.type,
    content: token.content,
    markup: token.markup,
    sourceInfo: token.info,
  });
  text.content = model.source;
  return text;
}

function demoteMathInsideLinks(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children) {
      continue;
    }

    let linkDepth = 0;
    token.children = token.children.map((child) => {
      if (child.type === "link_open") {
        linkDepth += 1;
        return child;
      }
      if (child.type === "link_close") {
        linkDepth -= 1;
        return child;
      }
      if (linkDepth > 0 && child.type.startsWith("math_")) {
        return mathTokenToText(state, child);
      }
      return child;
    });
  }
}

function promoteDisplayMath(state: StateCore): void {
  const tokens = state.tokens;
  const next: Token[] = [];
  let index = 0;

  while (index < tokens.length) {
    const open = tokens[index];
    if (!open) {
      break;
    }

    const inline = tokens[index + 1];
    const close = tokens[index + 2];
    const children = inline?.children;
    const shouldSplit =
      open.type === "paragraph_open" &&
      inline?.type === "inline" &&
      close?.type === "paragraph_close" &&
      children != null &&
      children.some(shouldPromoteInlineMath);

    if (!shouldSplit || !inline || !children) {
      next.push(open);
      index += 1;
      continue;
    }

    let phrasing: Token[] = [];
    for (const child of children) {
      if (!shouldPromoteInlineMath(child)) {
        phrasing.push(child);
        continue;
      }

      next.push(...createParagraphTokens(state, phrasing, open));
      phrasing = [];

      const block = new state.Token("math_block", "math", 0);
      block.block = true;
      block.content = child.content;
      block.markup = child.markup;
      block.map = inline.map;
      next.push(block);
    }
    next.push(...createParagraphTokens(state, phrasing, open));
    index += 3;
  }

  state.tokens = next;
}

function promoteMathFences(state: StateCore): void {
  for (const token of state.tokens) {
    const language = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (token.type !== "fence" || language !== "math") {
      continue;
    }

    token.type = "math_block";
    token.tag = "math";
  }
}

function closingDelimiterFor(markup: string): string {
  if (markup === "\\(") return "\\)";
  if (markup === "\\[") return "\\]";
  if (markup === "$$") return "$$";
  if (markup.startsWith("`") || markup.startsWith("~")) return markup;
  return "$";
}

export function isMathFenceToken(node: MathTokenSource): boolean {
  const fenceLanguage = node.sourceInfo?.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return (
    node.type === "math_block" &&
    fenceLanguage === "math" &&
    (node.markup.startsWith("`") || node.markup.startsWith("~"))
  );
}

export function shouldRenderAsDisplayMath(node: MathTokenSource): boolean {
  if (node.type === "math_block") {
    return true;
  }
  if (node.markup !== "\\[") {
    return false;
  }
  return node.content.includes("\n") || DISPLAY_PROMOTER.test(node.content);
}

export function getMathFormulaRenderModel(node: MathTokenSource): MathFormulaRenderModel {
  const content = node.content;
  if (isMathFenceToken(node)) {
    const terminatedContent = content.endsWith("\n") ? content : `${content}\n`;
    const info = node.sourceInfo ?? "";
    return {
      expression: content.trim(),
      source: `${node.markup}${info}\n${terminatedContent}${node.markup}`,
      displayMode: true,
    };
  }

  const closingDelimiter = closingDelimiterFor(node.markup);
  const displayMode = shouldRenderAsDisplayMath(node);
  const separator = node.type === "math_block" ? "\n" : "";
  return {
    expression: content,
    source: `${node.markup}${separator}${content}${separator}${closingDelimiter}`,
    displayMode,
  };
}

function renderMathHtml(markdown: MarkdownIt, token: Token, block: boolean): string {
  const model = getMathFormulaRenderModel({
    type: token.type,
    content: token.content,
    markup: token.markup,
    sourceInfo: token.info,
  });
  const escaped = markdown.utils.escapeHtml(model.source);
  if (block) {
    return `<pre><code class="math-display">${escaped}</code></pre>\n`;
  }
  return `<code class="math-inline">${escaped}</code>`;
}

export function markdownMath(markdown: MarkdownIt): void {
  markdown.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  markdown.inline.ruler.before("escape", "math_inline", mathInline);
  markdown.core.ruler.after("block", "math_fence", promoteMathFences);
  markdown.core.ruler.after("inline", "math_link_demote", demoteMathInsideLinks);
  markdown.core.ruler.after("math_link_demote", "math_display_promote", promoteDisplayMath);
  markdown.renderer.rules.math_inline = (tokens, idx) => {
    const token = tokens[idx];
    return token ? renderMathHtml(markdown, token, false) : "";
  };
  markdown.renderer.rules.math_block = (tokens, idx) => {
    const token = tokens[idx];
    return token ? renderMathHtml(markdown, token, true) : "";
  };
}
