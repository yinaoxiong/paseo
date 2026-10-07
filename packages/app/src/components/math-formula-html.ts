import { renderToString } from "katex";

export function escapeFormulaSource(source: string): string {
  return source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderKatexFormulaHtml(expression: string, displayMode: boolean): string | null {
  const compactExpression = displayMode ? expression : expression.replace(/^\\displaystyle\s*/, "");
  try {
    const html = renderToString(compactExpression, {
      displayMode,
      output: "htmlAndMathml",
      throwOnError: false,
      trust: false,
    });
    if (html.includes("katex-error")) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}
