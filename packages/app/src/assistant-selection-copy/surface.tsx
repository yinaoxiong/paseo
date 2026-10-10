import type { ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { MobilePanelScrollViewport } from "@/mobile-panels/provider";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function AssistantSelectionCopySurface({
  children,
  style,
}: AssistantSelectionCopySurfaceProps) {
  return <MobilePanelScrollViewport style={style}>{children}</MobilePanelScrollViewport>;
}
