import type { ReactNode } from "react";
import type { ASTNode, AstRenderer } from "react-native-markdown-display";
import type { TextStyle, ViewStyle } from "react-native";
import { MarkdownParagraphView } from "@/components/markdown-text";

export interface MathParagraphProps {
  node: ASTNode;
  children: ReactNode;
  paragraphStyle: ViewStyle;
  textStyle: TextStyle;
  linkStyle: TextStyle;
  codeStyle: TextStyle;
  containsImage: boolean;
  nativeRenderer?: AstRenderer;
  nativeParents?: ASTNode[];
}

export function MathParagraph({ children, paragraphStyle, containsImage }: MathParagraphProps) {
  return (
    <MarkdownParagraphView paragraphStyle={paragraphStyle} containsImage={containsImage}>
      {children}
    </MarkdownParagraphView>
  );
}

export function MathTextGroup({ children }: MathParagraphProps) {
  return children;
}

export const supportsMathTextGroups = false;
