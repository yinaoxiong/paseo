import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Keyboard, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import type { GestureType } from "react-native-gesture-handler";
import {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useSharedValue,
  useAnimatedRef,
  withTiming,
  measure,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { isNative } from "@/constants/platform";
import {
  usePanelStore,
  type MobilePanelSelection,
  type MobilePanelView,
} from "@/stores/panel-store";
import {
  canBeginMobilePanelGesture,
  createMobilePanelMotionState,
  getMobilePanelAnchor,
  isMobilePanelGestureCurrent,
  transitionMobilePanel,
  type MobilePanelCommit,
  type MobilePanelMotionState,
  type MobilePanelTransition,
} from "./model";
import {
  isMobilePanelGestureRegionHit,
  isPointInMobilePanelGestureFrame,
  type MobilePanelGestureRegion,
  type MobilePanelGestureFrame,
} from "./gesture-regions";
import { createAnimatedViewRef } from "./native-measurement-ref";

const ANIMATION_DURATION = 220;
const ANIMATION_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

interface MobilePanelsRuntime {
  beginGesture: (input: BeginGestureInput) => number;
  finishGesture: (input: FinishGestureInput) => MobilePanelCommit | null;
  leftCloseGestureRef: RefObject<GestureType | undefined>;
  leftOpenGestureRef: RefObject<GestureType | undefined>;
  motionState: SharedValue<MobilePanelMotionState>;
  openGesturesBlocked: SharedValue<boolean>;
  position: SharedValue<number>;
  rightCloseGestureRef: RefObject<GestureType | undefined>;
  rightOpenGestureRef: RefObject<GestureType | undefined>;
  updateGesture: (startedRevision: number, nextPosition: number) => boolean;
  setOpenGestureBlocked: (owner: symbol, blocked: boolean) => void;
  isOpeningTouchInScrollRegion: (absoluteX: number, absoluteY: number) => boolean;
  setOpenGestureSurface: (owner: symbol, surface: MobilePanelGestureSurface | null) => void;
  windowWidth: number;
}

export interface MobilePanelGestureSurface {
  ref: AnimatedRef<View>;
  viewportRefs: readonly AnimatedRef<View>[];
  layoutWidth: number;
  layoutHeight: number;
  regions: readonly MobilePanelGestureRegion[];
}

interface BeginGestureInput {
  origin: MobilePanelView;
}

interface FinishGestureInput {
  startedRevision: number;
  success: boolean;
  target: MobilePanelView;
}

const MobilePanelsContext = createContext<MobilePanelsRuntime | null>(null);
const MobilePanelActiveContext = createContext<MobilePanelView>("agent");
const MobilePanelScrollViewportContext = createContext<readonly AnimatedRef<View>[]>([]);

export function MobilePanelsProvider({ children }: { children: ReactNode }) {
  const { width: windowWidth } = useWindowDimensions();
  const initialSelection = useRef(usePanelStore.getState().mobilePanel).current;
  const position = useSharedValue(getMobilePanelAnchor(initialSelection.target));
  const motionState = useSharedValue(createMobilePanelMotionState(initialSelection));
  const openGesturesBlocked = useSharedValue(false);
  const openGestureBlockersRef = useRef(new Set<symbol>());
  const openGestureSurfacesRef = useRef(new Map<symbol, MobilePanelGestureSurface>());
  const openGestureSurfaces = useSharedValue<MobilePanelGestureSurface[]>([]);
  const leftOpenGestureRef = useRef<GestureType | undefined>(undefined);
  const leftCloseGestureRef = useRef<GestureType | undefined>(undefined);
  const rightOpenGestureRef = useRef<GestureType | undefined>(undefined);
  const rightCloseGestureRef = useRef<GestureType | undefined>(undefined);
  const [activePanel, setActivePanel] = useState(initialSelection.target);

  const setOpenGestureBlocked = useCallback(
    (owner: symbol, blocked: boolean) => {
      if (blocked) {
        openGestureBlockersRef.current.add(owner);
      } else {
        openGestureBlockersRef.current.delete(owner);
      }
      openGesturesBlocked.value = openGestureBlockersRef.current.size > 0;
    },
    [openGesturesBlocked],
  );

  const setOpenGestureSurface = useCallback(
    (owner: symbol, surface: MobilePanelGestureSurface | null) => {
      if (surface) openGestureSurfacesRef.current.set(owner, surface);
      else openGestureSurfacesRef.current.delete(owner);
      openGestureSurfaces.value = [...openGestureSurfacesRef.current.values()];
    },
    [openGestureSurfaces],
  );
  const isOpeningTouchInScrollRegion = useCallback(
    (absoluteX: number, absoluteY: number): boolean => {
      "worklet";
      for (const surface of openGestureSurfaces.value) {
        const frame = measure(surface.ref);
        if (!frame || !isPointInMobilePanelGestureFrame(absoluteX, absoluteY, frame)) continue;
        const viewports: MobilePanelGestureFrame[] = [];
        for (const viewportRef of surface.viewportRefs) {
          const viewport = measure(viewportRef);
          if (!viewport || !isPointInMobilePanelGestureFrame(absoluteX, absoluteY, viewport)) break;
          viewports.push(viewport);
        }
        if (viewports.length !== surface.viewportRefs.length) continue;
        if (
          isMobilePanelGestureRegionHit({
            absoluteX,
            absoluteY,
            frame,
            viewports,
            layoutWidth: surface.layoutWidth,
            layoutHeight: surface.layoutHeight,
            regions: surface.regions,
          })
        )
          return true;
      }
      return false;
    },
    [openGestureSurfaces],
  );

  const publishActivePanel = useCallback((panel: MobilePanelView, revision: number) => {
    const selection = usePanelStore.getState().mobilePanel;
    if (selection.revision !== revision || selection.target !== panel) {
      return;
    }
    if (isNative && panel !== "agent") {
      Keyboard.dismiss();
    }
    setActivePanel(panel);
  }, []);

  useAnimatedReaction(
    () => ({ motionState: motionState.value, position: position.value }),
    ({ motionState: currentState, position: currentPosition }) => {
      const settled = transitionMobilePanel(currentState, {
        type: "position.changed",
        position: currentPosition,
      });
      if (settled.state === currentState) {
        return;
      }
      motionState.value = settled.state;
      scheduleOnRN(publishActivePanel, settled.state.settledTarget, settled.state.revision);
    },
    [motionState, position, publishActivePanel],
  );

  const animateTransition = useCallback(
    (transition: MobilePanelTransition) => {
      "worklet";
      if (!transition.animationTarget) {
        return;
      }
      const target = transition.animationTarget;
      position.value = withTiming(getMobilePanelAnchor(target), {
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
      });
    },
    [position],
  );

  const applySelection = useCallback(
    (selection: MobilePanelSelection) => {
      "worklet";
      const currentState = motionState.value;
      const transition = transitionMobilePanel(currentState, {
        type: "command",
        selection,
      });
      if (transition.state === currentState) {
        return;
      }
      motionState.value = transition.state;
      animateTransition(transition);
    },
    [animateTransition, motionState],
  );

  useEffect(() => {
    return usePanelStore.subscribe((state, previousState) => {
      const selection = state.mobilePanel;
      if (selection === previousState.mobilePanel) {
        return;
      }
      scheduleOnUI(applySelection, selection);
    });
  }, [applySelection]);

  const beginGesture = useCallback(
    ({ origin }: BeginGestureInput): number => {
      "worklet";
      const currentState = motionState.value;
      if (!canBeginMobilePanelGesture(currentState, origin, position.value)) {
        return -1;
      }
      const transition = transitionMobilePanel(currentState, {
        type: "gesture.begin",
        origin,
      });
      motionState.value = transition.state;
      cancelAnimation(position);
      return transition.state.gesture?.startedRevision ?? -1;
    },
    [motionState, position],
  );

  const updateGesture = useCallback(
    (startedRevision: number, nextPosition: number): boolean => {
      "worklet";
      if (!isMobilePanelGestureCurrent(motionState.value, startedRevision)) {
        return false;
      }
      position.value = Math.max(-1, Math.min(1, nextPosition));
      return true;
    },
    [motionState, position],
  );

  const finishGesture = useCallback(
    ({ startedRevision, target, success }: FinishGestureInput): MobilePanelCommit | null => {
      "worklet";
      const currentState = motionState.value;
      const transition = transitionMobilePanel(currentState, {
        type: "gesture.finish",
        startedRevision,
        success,
        target,
      });
      if (transition.state === currentState) {
        return null;
      }
      motionState.value = transition.state;
      animateTransition(transition);
      return transition.commit ?? null;
    },
    [animateTransition, motionState],
  );

  const value = useMemo<MobilePanelsRuntime>(
    () => ({
      beginGesture,
      finishGesture,
      leftCloseGestureRef,
      leftOpenGestureRef,
      motionState,
      openGesturesBlocked,
      position,
      rightCloseGestureRef,
      rightOpenGestureRef,
      updateGesture,
      setOpenGestureBlocked,
      isOpeningTouchInScrollRegion,
      setOpenGestureSurface,
      windowWidth,
    }),
    [
      beginGesture,
      finishGesture,
      motionState,
      openGesturesBlocked,
      position,
      setOpenGestureBlocked,
      isOpeningTouchInScrollRegion,
      setOpenGestureSurface,
      updateGesture,
      windowWidth,
    ],
  );

  return (
    <MobilePanelsContext.Provider value={value}>
      <MobilePanelActiveContext.Provider value={activePanel}>
        {children}
      </MobilePanelActiveContext.Provider>
    </MobilePanelsContext.Provider>
  );
}

/** Internal to the mobile-panels module. Callers use gesture and presentation adapters. */
export function useMobilePanelsRuntime(): MobilePanelsRuntime {
  const context = useContext(MobilePanelsContext);
  if (!context) {
    throw new Error("useMobilePanelsRuntime must be used within MobilePanelsProvider");
  }
  return context;
}

export function useIsMobilePanelActive(panel: MobilePanelView): boolean {
  return useContext(MobilePanelActiveContext) === panel;
}

export function useBlockMobilePanelOpenGestures(blocked: boolean): void {
  const { setOpenGestureBlocked } = useMobilePanelsRuntime();
  const owner = useRef(Symbol("mobile-panel-open-gesture-blocker")).current;

  useLayoutEffect(() => {
    setOpenGestureBlocked(owner, blocked);
    return () => setOpenGestureBlocked(owner, false);
  }, [blocked, owner, setOpenGestureBlocked]);
}

/** Register layout ahead of touch; never send touch events through React or the HTML bridge. */
export function useMobilePanelScrollSurface(
  surface: Omit<MobilePanelGestureSurface, "viewportRefs"> | null,
): void {
  const context = useContext(MobilePanelsContext);
  const viewportRefs = useContext(MobilePanelScrollViewportContext);
  const owner = useRef(Symbol("mobile-panel-scroll-surface")).current;
  const setSurface = context?.setOpenGestureSurface;
  useLayoutEffect(() => {
    setSurface?.(owner, surface && viewportRefs.length ? { ...surface, viewportRefs } : null);
    return () => setSurface?.(owner, null);
  }, [owner, setSurface, surface, viewportRefs]);
}

export function MobilePanelScrollViewportBoundary({
  children,
  viewportRef,
}: {
  children: ReactNode;
  viewportRef: AnimatedRef<View>;
}) {
  const parents = useContext(MobilePanelScrollViewportContext);
  const viewports = useMemo(() => [...parents, viewportRef], [parents, viewportRef]);
  return (
    <MobilePanelScrollViewportContext.Provider value={viewports}>
      {children}
    </MobilePanelScrollViewportContext.Provider>
  );
}

/** The existing non-inverted chat root supplies clipping without adding a layout wrapper. */
export function MobilePanelScrollViewport({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const viewportRef = useAnimatedRef<View>();
  const attachViewport = useMemo(() => createAnimatedViewRef(viewportRef), [viewportRef]);
  return (
    <MobilePanelScrollViewportBoundary viewportRef={viewportRef}>
      <View ref={attachViewport} collapsable={false} style={style}>
        {children}
      </View>
    </MobilePanelScrollViewportBoundary>
  );
}
