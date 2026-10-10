import { MathRuntimeRequestDriver, reduceMathHostLayout } from "./request-driver";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { mathRuntimeHtml, mathRuntimeIdentity } from "./runtime/html.gen";
import { parseMathRuntimeMessage, type MathRuntimeRequest } from "./runtime/messages";
import { useAnimatedRef } from "react-native-reanimated";
import { useMobilePanelScrollSurface } from "@/mobile-panels/provider";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { createAnimatedViewRef } from "@/mobile-panels/native-measurement-ref";

export interface MathPresentation {
  fontSize: number;
  lineHeight: number;
  color: string;
  linkColor: string;
  codeColor: string;
  codeBackground: string;
  fontWeight?: string;
  fontStyle?: string;
  fontFamily?: string;
  codeFontSize?: number;
}

interface MathHtmlHostProps {
  html: string;
  presentation: MathPresentation;
  fallback: ReactNode;
  onLink?: (index: number) => void;
}

const SOURCE = { html: mathRuntimeHtml };
const ORIGINS = ["*"];

export function MathHtmlHost({ html, presentation, fallback, onLink }: MathHtmlHostProps) {
  const webView = useRef<WebView | null>(null);
  const surfaceRef = useAnimatedRef<View>();
  const attachSurface = useMemo(() => createAnimatedViewRef(surfaceRef), [surfaceRef]);
  const active = useRetainedPanelActive();
  const driver = useMemo(() => new MathRuntimeRequestDriver(mathRuntimeIdentity), []);
  const renderTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, dispatch] = useReducer(reduceMathHostLayout, {
    width: 0,
    height: null,
    failed: false,
    painted: false,
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
      fontWeight: presentation.fontWeight ?? "normal",
      fontStyle: presentation.fontStyle ?? "normal",
      fontFamily: presentation.fontFamily ?? "system-ui",
      codeFontSize: (presentation.codeFontSize ?? presentation.fontSize) * fontScale,
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
      presentation.fontWeight,
      presentation.fontStyle,
      presentation.fontFamily,
      presentation.codeFontSize,
    ],
  );
  const send = useCallback((value: MathRuntimeRequest) => {
    const payload = JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
    webView.current?.injectJavaScript(
      `window.__PASEO_MATH_RUNTIME_RECEIVE__ && window.__PASEO_MATH_RUNTIME_RECEIVE__(${payload}); true;`,
    );
  }, []);

  const clearRenderTimeout = useCallback(() => {
    if (renderTimeout.current !== null) clearTimeout(renderTimeout.current);
    renderTimeout.current = null;
  }, []);
  const scheduleRenderTimeout = useCallback(() => {
    clearRenderTimeout();
    const revision = driver.revision;
    if (!revision) return;
    renderTimeout.current = setTimeout(() => {
      if (driver.expire(revision)) dispatch({ type: "failed" });
    }, 10000);
  }, [clearRenderTimeout, driver]);
  useLayoutEffect(() => {
    driver.start();
    return () => {
      driver.stop();
      clearRenderTimeout();
    };
  }, [driver, clearRenderTimeout]);
  useLayoutEffect(() => {
    if (request.width <= 0) {
      driver.suspend();
      clearRenderTimeout();
      return;
    }
    const next = driver.update(request);
    if (!driver.revision) {
      clearRenderTimeout();
      dispatch({ type: "failed" });
      return;
    }
    dispatch({ type: "pending", cached: next.cached });
    if (next.reload) webView.current?.reload();
    else if (next.request) send(next.request);
    scheduleRenderTimeout();
  }, [driver, request, send, scheduleRenderTimeout, clearRenderTimeout]);
  const onLoadStart = useCallback(() => {
    if (!driver.isActive) return;
    driver.reload();
    dispatch({ type: "document" });
    scheduleRenderTimeout();
  }, [driver, scheduleRenderTimeout]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!driver.isActive) return;
      const width = Number.isFinite(event.nativeEvent.layout.width)
        ? Math.max(0, event.nativeEvent.layout.width)
        : 0;
      if (width === 0) {
        driver.suspend();
        clearRenderTimeout();
      }
      dispatch({ type: "width", width });
    },
    [driver, clearRenderTimeout],
  );
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
        const queued = driver.ready();
        if (queued) {
          send(queued);
          scheduleRenderTimeout();
        }
        return;
      }
      const accepted = driver.accept(message);
      if (!accepted) return;
      if (accepted.type === "failed") {
        clearRenderTimeout();
        dispatch({ type: "failed" });
      }
      if (accepted.type === "size") {
        clearRenderTimeout();
        dispatch({
          type: "size",
          height: accepted.height,
          width: accepted.width,
          regions: accepted.horizontalScrollRegions,
        });
      }
      if (accepted.type === "link") onLink?.(accepted.index);
    },
    [driver, onLink, send, clearRenderTimeout, scheduleRenderTimeout],
  );
  const onError = useCallback(() => {
    if (!driver.isActive) return;
    driver.failedTransport();
    clearRenderTimeout();
    dispatch({ type: "failed" });
  }, [driver, clearRenderTimeout]);
  const allowNavigation = useCallback((load: { url: string }) => load.url === "about:blank", []);
  const showHtml = layout.painted && layout.height !== null && !layout.failed;
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
      style={[
        styles.container,
        !layout.failed && layout.height !== null && { minHeight: layout.height },
        showHtml && { height: layout.height },
      ]}
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
        onLoadStart={onLoadStart}
        onRenderProcessGone={onError}
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
