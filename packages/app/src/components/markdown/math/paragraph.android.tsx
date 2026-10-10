import { useCallback, useMemo } from "react";
import { MarkdownParagraphView } from "@/components/markdown-text";
import { useAssistantFileLinkActions } from "@/assistant-file-links";
import type { MathParagraphProps } from "./paragraph";
import { renderMathParagraph } from "./paragraph-content";
import { MathHtmlHost, type MathPresentation } from "./host.android";

export function MathParagraph(props: MathParagraphProps) {
  const { node, children, paragraphStyle, containsImage, textStyle, linkStyle, codeStyle } = props;
  const content = useMemo(() => renderMathParagraph(node), [node]);
  const actions = useAssistantFileLinkActions();
  const openLink = useCallback(
    (index: number) => {
      const source = content?.links[index];
      if (source) actions.open(source, "preferred");
    },
    [actions, content],
  );
  const presentation = useMemo<MathPresentation>(
    () => ({
      fontSize: typeof textStyle.fontSize === "number" ? textStyle.fontSize : 16,
      lineHeight: typeof textStyle.lineHeight === "number" ? textStyle.lineHeight : 24,
      color: typeof textStyle.color === "string" ? textStyle.color : "#111111",
      linkColor: typeof linkStyle.color === "string" ? linkStyle.color : "#007aff",
      codeColor: typeof codeStyle.color === "string" ? codeStyle.color : "#111111",
      codeBackground:
        typeof codeStyle.backgroundColor === "string" ? codeStyle.backgroundColor : "transparent",
    }),
    [
      textStyle.fontSize,
      textStyle.lineHeight,
      textStyle.color,
      linkStyle.color,
      codeStyle.color,
      codeStyle.backgroundColor,
    ],
  );
  return (
    <MarkdownParagraphView paragraphStyle={paragraphStyle} containsImage={containsImage}>
      {content ? (
        <MathHtmlHost
          html={content.html}
          presentation={presentation}
          fallback={children}
          onLink={openLink}
        />
      ) : (
        children
      )}
    </MarkdownParagraphView>
  );
}
