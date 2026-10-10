import { createElement } from "react";
import { MathFormula as SourceMathFormula } from "../../math-formula.native";
import { getMathFormulaRenderModel } from "@/utils/markdown-math";
import AstRenderer from "react-native-markdown-display/src/lib/AstRenderer";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { ReactNode } from "react";
import type { TextStyle, ViewStyle } from "react-native";

function sourceFormula(
  node: ASTNode,
  _children: ReactNode[],
  _parents: ASTNode[],
  styles: Record<string, TextStyle & ViewStyle>,
  inheritedStyles: TextStyle = {},
) {
  return createElement(SourceMathFormula, {
    ...getMathFormulaRenderModel(node),
    textStyle: [styles.body, styles.text, inheritedStyles],
  });
}

function paragraphChildren(_node: ASTNode, children: ReactNode[]): ReactNode {
  return children;
}
export function createMathNativeRenderer(
  rules: RenderRules,
  styles: Record<string, TextStyle & ViewStyle>,
  onLinkPress: (url: string) => boolean,
  originalNode?: ASTNode,
): AstRenderer {
  // Reuse image previews, file actions and source-formula fallback. The outer
  // paragraph already owns spacing; recursing into MathParagraph would loop.
  const image: RenderRules["image"] = (
    node,
    children,
    parents,
    localStyles,
    allowed,
    fallbackHandler,
  ) => {
    const sourceParents =
      originalNode?.type === "paragraph"
        ? parents.map((parent) => (parent.type === "paragraph" ? originalNode : parent))
        : parents;
    return rules.image?.(node, children, sourceParents, localStyles, allowed, fallbackHandler);
  };
  // The package's constructor declaration omits its existing onLinkPress argument.
  // Preserve it for native block-links (notably linked image previews).
  return Reflect.construct(AstRenderer, [
    {
      ...rules,
      paragraph: paragraphChildren,
      textgroup: paragraphChildren,
      math_inline: sourceFormula,
      math_block: sourceFormula,
      image,
    },
    styles,
    onLinkPress,
  ]) as AstRenderer;
}
