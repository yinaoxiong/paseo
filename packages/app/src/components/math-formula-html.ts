import { BoundedMathCache } from "./markdown/math/render-cache";
import { renderToString, version as katexVersion } from "katex";

export function escapeFormulaSource(source: string): string {
  return source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function createMathFormulaRenderer(render: typeof renderToString = renderToString) {
  const cache = new BoundedMathCache<string | null>(256, 2 * 1024 * 1024);
  return (expression: string, displayMode: boolean): string | null => {
    const key = JSON.stringify([
      katexVersion,
      "htmlAndMathml-trustFalse-v1",
      expression,
      displayMode,
    ]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = renderFormula(expression, displayMode, render);
    cache.set(key, value, (key.length + (value?.length ?? 0)) * 2);
    return value;
  };
}

export const renderKatexFormulaHtml = createMathFormulaRenderer();

function renderFormula(
  expression: string,
  displayMode: boolean,
  render: typeof renderToString,
): string | null {
  const compactExpression = displayMode ? expression : expression.replace(/^\\displaystyle\s*/, "");
  try {
    const html = render(compactExpression, {
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
