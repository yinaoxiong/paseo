import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { resolveMarkdownInlineCodeLink } from "@/utils/markdown-inline-code-link";
import { Fragment, useMemo, useCallback, type ReactNode } from "react";
import { MarkdownParagraphView } from "@/components/markdown-text";
import { useAssistantFileLinkActions } from "@/assistant-file-links";
import type { MathParagraphProps } from "./paragraph";
import {
  shouldRenderMathTextGroup,
  renderMathParagraphParts,
  type MathParagraphContent,
} from "./paragraph-content";
import { MathHtmlHost, type MathPresentation } from "./host.android";

const parser = createAssistantMarkdownParser();

export function MathParagraph(props: MathParagraphProps) {
  const {
    node,
    children,
    paragraphStyle,
    containsImage,
    textStyle,
    linkStyle,
    codeStyle,
    nativeRenderer,
    nativeParents,
  } = props;
  const actions = useAssistantFileLinkActions();
  const parts = useMemo(
    () =>
      renderMathParagraphParts(node, {
        resolveInlineCode: (source) =>
          resolveMarkdownInlineCodeLink(parser, source, actions.canResolveFile),
      }),
    [node, actions.canResolveFile],
  );
  const renderNative = useCallback(
    (part: MathParagraphProps["node"]) => nativeRenderer?.renderNode(part, nativeParents ?? []),
    [nativeRenderer, nativeParents],
  );
  const canRender = parts && (nativeRenderer || !parts.some((part) => part.kind === "native"));
  const presentation = useMemo<MathPresentation>(
    () => ({
      fontSize: typeof textStyle.fontSize === "number" ? textStyle.fontSize : 16,
      lineHeight: typeof textStyle.lineHeight === "number" ? textStyle.lineHeight : 24,
      color: typeof textStyle.color === "string" ? textStyle.color : "#111111",
      linkColor: typeof linkStyle.color === "string" ? linkStyle.color : "#007aff",
      codeColor: typeof codeStyle.color === "string" ? codeStyle.color : "#111111",
      codeBackground:
        typeof codeStyle.backgroundColor === "string" ? codeStyle.backgroundColor : "transparent",
      fontWeight: typeof textStyle.fontWeight === "string" ? textStyle.fontWeight : "normal",
      fontStyle: textStyle.fontStyle,
      fontFamily: textStyle.fontFamily,
      codeFontSize: codeStyle.fontSize,
    }),
    [
      textStyle.fontSize,
      textStyle.lineHeight,
      textStyle.color,
      linkStyle.color,
      codeStyle.color,
      codeStyle.backgroundColor,
      codeStyle.fontSize,
      textStyle.fontWeight,
      textStyle.fontStyle,
      textStyle.fontFamily,
    ],
  );
  return (
    <MarkdownParagraphView paragraphStyle={paragraphStyle} containsImage={containsImage}>
      {canRender
        ? parts.map((part) =>
            part.kind === "native" ? (
              <Fragment key={part.key}>{renderNative?.(part.node)}</Fragment>
            ) : (
              <MathParagraphHtmlRun
                key={part.key}
                content={part.content}
                presentation={presentation}
                fallback={nativeRenderer ? renderNative(part.node) : children}
                open={actions.open}
              />
            ),
          )
        : children}
    </MarkdownParagraphView>
  );
}

function MathParagraphHtmlRun({
  content,
  presentation,
  fallback,
  open,
}: {
  content: MathParagraphContent;
  presentation: MathPresentation;
  fallback: ReactNode;
  open: ReturnType<typeof useAssistantFileLinkActions>["open"];
}) {
  const onLink = useCallback(
    (index: number) => {
      const source = content.links[index];
      if (source) open(source, "preferred");
    },
    [content, open],
  );
  return (
    <MathHtmlHost
      html={content.html}
      presentation={presentation}
      fallback={fallback}
      onLink={onLink}
    />
  );
}

const TEXTGROUP_PARAGRAPH_STYLE = {
  flexDirection: "row",
  flexWrap: "wrap",
  width: "100%",
  minWidth: 0,
  marginBottom: 0,
} as const;
export function MathTextGroup(props: MathParagraphProps) {
  if (!shouldRenderMathTextGroup(props.node, props.nativeParents ?? [])) return props.children;
  return <MathParagraph {...props} paragraphStyle={TEXTGROUP_PARAGRAPH_STYLE} />;
}

export const supportsMathTextGroups = true;
