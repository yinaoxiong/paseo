export type MobilePanelGestureDirection = -1 | 1;
export type MobilePanelGestureIntent = "activate" | "fail" | "wait";

export function captureMobilePanelOpeningTouch(input: {
  numberOfTouches: number;
  touch: { absoluteX: number; absoluteY: number } | undefined;
  startX: { value: number };
  startY: { value: number };
  blocked: { value: boolean };
  native: boolean;
  hitTest: (x: number, y: number) => boolean;
  stateManager: { fail: () => void };
}): void {
  "worklet";
  const touch = input.touch;
  if (input.numberOfTouches !== 1 || !touch) {
    input.stateManager.fail();
    return;
  }
  input.startX.value = touch.absoluteX;
  input.startY.value = touch.absoluteY;
  input.blocked.value = input.native && input.hitTest(touch.absoluteX, touch.absoluteY);
}

export function resolveMobilePanelGestureIntent(input: {
  deltaX: number;
  deltaY: number;
  direction: MobilePanelGestureDirection;
  openGesturesBlocked: boolean;
}): MobilePanelGestureIntent {
  "worklet";
  if (input.openGesturesBlocked) {
    return "fail";
  }
  const directedDelta = input.deltaX * input.direction;
  const absDeltaX = Math.abs(input.deltaX);
  const absDeltaY = Math.abs(input.deltaY);
  if (directedDelta <= -10 || (absDeltaY > 10 && absDeltaY > absDeltaX)) {
    return "fail";
  }
  if (directedDelta >= 15 && absDeltaX > absDeltaY) {
    return "activate";
  }
  return "wait";
}
