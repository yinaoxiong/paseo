import { useMemo } from "react";
import { Text, StyleSheet } from "react-native";
import { MathFormula as SourceFormula, type MathFormulaProps } from "./math-formula.native";
import { escapeFormulaSource, renderKatexFormulaHtml } from "./math-formula-html";
import { MathHtmlHost, type MathPresentation } from "./markdown/math/host.android";

export type { MathFormulaProps } from "./math-formula.native";

export function MathFormula(props: MathFormulaProps) {
  if (!props.displayMode) return <SourceFormula {...props} />;
  return <DisplayFormula {...props} />;
}

function DisplayFormula({ expression, source, textStyle }: MathFormulaProps) {
  const html = useMemo(() => {
    const formula = renderKatexFormulaHtml(expression, true) ?? escapeFormulaSource(source);
    return `<div class="paseo-display-math">${formula}</div>`;
  }, [expression, source]);
  const text = StyleSheet.flatten(textStyle);
  const color = typeof text?.color === "string" ? text.color : "#111111";
  const presentation = useMemo<MathPresentation>(
    () => ({
      fontSize: text?.fontSize ?? 16,
      lineHeight: text?.lineHeight ?? 24,
      color,
      linkColor: color,
      codeColor: color,
      codeBackground: "transparent",
    }),
    [text?.fontSize, text?.lineHeight, color],
  );
  const fallback = useMemo(
    () => (
      <Text selectable style={textStyle}>
        {source}
      </Text>
    ),
    [source, textStyle],
  );
  return <MathHtmlHost html={html} presentation={presentation} fallback={fallback} />;
}
