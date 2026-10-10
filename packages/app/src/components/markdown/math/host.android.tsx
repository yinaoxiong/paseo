import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { mathRuntimeHtml } from "./runtime/html.gen";
import { parseMathRuntimeMessage, type MathRuntimeRequest } from "./runtime/messages";
import { useAnimatedRef } from "react-native-reanimated";
import { useMobilePanelScrollSurface } from "@/mobile-panels/provider";
import type { MobilePanelGestureRegion } from "@/mobile-panels/gesture-regions";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { createAnimatedViewRef } from "@/mobile-panels/native-measurement-ref";

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
  measuredWidth: number;
  regions: MobilePanelGestureRegion[];
}

type HostEvent =
  | { type: "width"; width: number }
  | { type: "size"; height: number; width: number; regions: MobilePanelGestureRegion[] }
  | { type: "pending" }
  | { type: "failed" };

function reduceLayout(state: HostLayout, event: HostEvent): HostLayout {
  if (event.type === "width") {
    if (Math.abs(state.width - event.width) < 0.5) return state;
    return { ...state, width: event.width, regions: [] };
  }
  if (event.type === "failed") return { ...state, failed: true, regions: [] };
  if (event.type === "pending") return state.regions.length ? { ...state, regions: [] } : state;
  return { ...state, height: event.height, measuredWidth: event.width, regions: event.regions };
}

const SOURCE = { html: mathRuntimeHtml };
const ORIGINS = ["*"];

export function MathHtmlHost({ html, presentation, fallback, onLink }: MathHtmlHostProps) {
  const webView = useRef<WebView | null>(null);
  const surfaceRef = useAnimatedRef<View>();
  const attachSurface = useMemo(() => createAnimatedViewRef(surfaceRef), [surfaceRef]);
  const active = useRetainedPanelActive();
  const ready = useRef(false);
  const latest = useRef<MathRuntimeRequest | null>(null);
  const revision = useRef(0);
  const [layout, dispatch] = useReducer(reduceLayout, {
    width: 0,
    height: null,
    failed: false,
    measuredWidth: 0,
    regions: [],
  });
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

  useLayoutEffect(() => {
    if (request.width <= 0) return;
    dispatch({ type: "pending" });
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
        dispatch({
          type: "size",
          height: message.height,
          width: message.width,
          regions: message.horizontalScrollRegions,
        });
      }
      if (message.type === "link") onLink?.(message.index);
    },
    [onLink, send],
  );
  const onError = useCallback(() => dispatch({ type: "failed" }), []);
  const allowNavigation = useCallback((load: { url: string }) => load.url === "about:blank", []);
  const showHtml = layout.height !== null && !layout.failed;
  const gestureSurface = useMemo(
    () =>
      active && showHtml && layout.regions.length > 0
        ? {
            ref: surfaceRef,
            layoutWidth: layout.measuredWidth,
            layoutHeight: layout.height ?? 0,
            regions: layout.regions,
          }
        : null,
    [active, showHtml, surfaceRef, layout.measuredWidth, layout.height, layout.regions],
  );
  useMobilePanelScrollSurface(gestureSurface);

  return (
    <View
      ref={attachSurface}
      collapsable={false}
      onLayout={onLayout}
      style={[styles.container, showHtml && { height: layout.height }]}
    >
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
