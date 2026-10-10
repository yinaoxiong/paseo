declare module "react-native-markdown-display/src/lib/util/tokensToAST" {
  import type Token from "markdown-it/lib/token.mjs";
  import type { ASTNode } from "react-native-markdown-display";
  export default function tokensToAST(tokens: readonly Token[]): ASTNode[];
}

declare module "react-native-markdown-display/src/lib/AstRenderer" {
  import { AstRenderer } from "react-native-markdown-display";
  export default AstRenderer;
}
declare module "react-native-markdown-display/src/lib/parser" {
  import type MarkdownIt from "markdown-it";
  import type { ASTNode } from "react-native-markdown-display";
  export default function parser<T>(
    source: string | ASTNode[],
    renderer: (nodes: ASTNode[]) => T,
    markdownIt: MarkdownIt,
  ): T;
}
