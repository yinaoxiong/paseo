import type { StyleProp, TextStyle } from "react-native";

interface MarkdownBodyStyle {
  color?: unknown;
}

export function getMathFormulaTextStyle(
  textStyle: StyleProp<TextStyle>,
  bodyStyle: MarkdownBodyStyle,
): StyleProp<TextStyle> {
  const color = bodyStyle.color;
  if (typeof color !== "string") {
    return textStyle;
  }
  return [textStyle, { color }];
}
