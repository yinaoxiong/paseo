import type MarkdownIt from "markdown-it";
import type { AssistantFileLinkSource } from "@/assistant-file-links/resolver";

export function getInlineCodeAutoLinkUrl(
  markdownParser: MarkdownIt,
  content: string,
): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const matches:
    | {
        index: number;
        lastIndex: number;
        url: string;
      }[]
    | null = markdownParser.linkify.match(trimmed);
  if (!matches || matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (!match || match.index !== 0 || match.lastIndex !== trimmed.length) {
    return null;
  }

  return match.url;
}

export function getInlineCodeAutoLinkSource(input: {
  href: string;
  content: string;
}): AssistantFileLinkSource {
  return {
    href: input.href,
    text: input.content,
    markup: "linkify",
    sourceInfo: "auto",
  };
}

export function resolveMarkdownInlineCodeLink(
  parser: MarkdownIt,
  content: string,
  canResolveFile: (source: AssistantFileLinkSource) => boolean,
): AssistantFileLinkSource | null {
  const source: AssistantFileLinkSource = {
    href: content,
    text: content,
    sourceType: "inline-code",
  };
  if (canResolveFile(source)) return source;
  const url = getInlineCodeAutoLinkUrl(parser, content);
  return url ? getInlineCodeAutoLinkSource({ href: url, content }) : null;
}
