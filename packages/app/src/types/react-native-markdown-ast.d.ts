declare module "react-native-markdown-display/src/lib/util/tokensToAST" {
  import type Token from "markdown-it/lib/token.mjs";
  import type { ASTNode } from "react-native-markdown-display";
  export default function tokensToAST(tokens: readonly Token[]): ASTNode[];
}
