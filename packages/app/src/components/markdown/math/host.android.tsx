import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { mathRuntimeHtml } from "./runtime/html.gen";
import { parseMathRuntimeMessage, type MathRuntimeRequest } from "./runtime/messages";

export interface MathPresentation {
  fontSize: number;
  lineHeight: number;
  color: string;
  linkColor: string;
  codeColor: string;
  codeBackground: string;
}

interface MathHtmlHostProps {
  html: string;
  presentation: MathPresentation;
  fallback: ReactNode;
  onLink?: (index: number) => void;
}

interface HostLayout {
  width: number;
  height: number | null;
  failed: boolean;
}

type HostEvent =
  | { type: "width"; width: number }
  | { type: "height"; height: number }
  | { type: "failed" };

function reduceLayout(state: HostLayout, event: HostEvent): HostLayout {
  if (event.type === "width") {
    if (Math.abs(state.width - event.width) < 0.5) return state;
    return { ...state, width: event.width };
  }
  if (event.type === "failed") return { ...state, failed: true };
  if (state.height === event.height) return state;
  return { ...state, height: event.height };
}

const SOURCE = { html: mathRuntimeHtml };
const ORIGINS = ["*"];

export function MathHtmlHost({ html, presentation, fallback, onLink }: MathHtmlHostProps) {
  const webView = useRef<WebView | null>(null);
  const ready = useRef(false);
  const latest = useRef<MathRuntimeRequest | null>(null);
  const revision = useRef(0);
  const [layout, dispatch] = useReducer(reduceLayout, { width: 0, height: null, failed: false });
  const { fontScale } = useWindowDimensions();
  const request = useMemo(
    () => ({
      html,
      width: layout.width,
      fontSize: presentation.fontSize * fontScale,
      lineHeight: presentation.lineHeight * fontScale,
      color: presentation.color,
      linkColor: presentation.linkColor,
      codeColor: presentation.codeColor,
      codeBackground: presentation.codeBackground,
    }),
    [
      html,
      layout.width,
      fontScale,
      presentation.fontSize,
      presentation.lineHeight,
      presentation.color,
      presentation.linkColor,
      presentation.codeColor,
      presentation.codeBackground,
    ],
  );
  const send = useCallback((value: MathRuntimeRequest) => {
    const payload = JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
    webView.current?.injectJavaScript(
      `window.__PASEO_MATH_RUNTIME_RECEIVE__ && window.__PASEO_MATH_RUNTIME_RECEIVE__(${payload}); true;`,
    );
  }, []);

  useEffect(() => {
    if (request.width <= 0) return;
    const next = { ...request, revision: ++revision.current };
    latest.current = next;
    if (ready.current) send(next);
  }, [request, send]);

  useEffect(
    () => () => {
      ready.current = false;
      latest.current = null;
    },
    [],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    dispatch({ type: "width", width: event.nativeEvent.layout.width });
  }, []);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      const message = parseMathRuntimeMessage(value);
      if (!message) return;
      if (message.type === "ready") {
        ready.current = true;
        if (latest.current) send(latest.current);
        return;
      }
      const current = latest.current;
      if (!current || current.revision !== message.revision) return;
      if (message.type === "failed") dispatch({ type: "failed" });
      if (message.type === "size" && Math.abs(message.width - current.width) < 1) {
        dispatch({ type: "height", height: message.height });
      }
      if (message.type === "link") onLink?.(message.index);
    },
    [onLink, send],
  );
  const onError = useCallback(() => dispatch({ type: "failed" }), []);
  const allowNavigation = useCallback((load: { url: string }) => load.url === "about:blank", []);
  const showHtml = layout.height !== null && !layout.failed;

  return (
    <View onLayout={onLayout} style={[styles.container, showHtml && { height: layout.height }]}>
      {!showHtml && fallback}
      <WebView
        ref={webView}
        testID="android-math-webview"
        source={SOURCE}
        originWhitelist={ORIGINS}
        containerStyle={[styles.webView, !showHtml && styles.hidden]}
        style={styles.surface}
        pointerEvents={showHtml ? "auto" : "none"}
        onMessage={onMessage}
        onError={onError}
        onShouldStartLoadWithRequest={allowNavigation}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        textZoom={100}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", minWidth: 0, flexShrink: 1 },
  webView: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent" },
  surface: { backgroundColor: "transparent" },
  hidden: { opacity: 0 },
});
