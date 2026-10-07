import React, { useMemo, type CSSProperties } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import "./katex.web.css";
import "./math-formula.web.css";
import { escapeFormulaSource, renderKatexFormulaHtml } from "./math-formula-html";

export interface MathFormulaProps {
  expression: string;
  source: string;
  displayMode: boolean;
  textStyle?: StyleProp<TextStyle>;
}

const DISPLAY_STYLE: CSSProperties = {
  display: "block",
  maxWidth: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  color: "inherit",
};

const INLINE_STYLE: CSSProperties = {
  display: "inline-block",
  maxWidth: "100%",
  fontSize: "0.9em",
  verticalAlign: "baseline",
  color: "inherit",
};

export function MathFormula({ expression, source, displayMode, textStyle }: MathFormulaProps) {
  const innerHtml = useMemo(() => {
    const html = renderKatexFormulaHtml(expression, displayMode) ?? escapeFormulaSource(source);
    return { __html: html };
  }, [displayMode, expression, source]);

  const style = useMemo(() => {
    const flattened = StyleSheet.flatten(textStyle);
    const color = typeof flattened?.color === "string" ? flattened.color : undefined;
    return {
      ...(displayMode ? DISPLAY_STYLE : INLINE_STYLE),
      ...(color ? { color } : {}),
    };
  }, [displayMode, textStyle]);

  return (
    <span
      aria-label={source}
      className="paseo-math-formula"
      style={style}
      dangerouslySetInnerHTML={innerHtml}
    />
  );
}
