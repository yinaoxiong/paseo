export interface MobilePanelGestureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MobilePanelGestureFrame {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

export function isPointInMobilePanelGestureFrame(
  x: number,
  y: number,
  frame: MobilePanelGestureFrame,
): boolean {
  "worklet";
  return (
    frame.width > 0 &&
    frame.height > 0 &&
    x >= frame.pageX &&
    x < frame.pageX + frame.width &&
    y >= frame.pageY &&
    y < frame.pageY + frame.height
  );
}

/** Coordinates come from the surface's CSS layout, not its scroll offset. */
export function isMobilePanelGestureRegionHit(input: {
  absoluteX: number;
  absoluteY: number;
  frame: MobilePanelGestureFrame;
  viewports: readonly MobilePanelGestureFrame[];
  layoutWidth: number;
  layoutHeight: number;
  regions: readonly MobilePanelGestureRegion[];
}): boolean {
  "worklet";
  const { frame, layoutWidth, layoutHeight } = input;
  if (
    !input.viewports.length ||
    !input.viewports.every((viewport) =>
      isPointInMobilePanelGestureFrame(input.absoluteX, input.absoluteY, viewport),
    )
  )
    return false;
  if (frame.width <= 0 || frame.height <= 0 || layoutWidth <= 0 || layoutHeight <= 0) return false;
  // A resize invalidates the DOM layout until a matching measurement arrives.
  if (Math.abs(frame.width - layoutWidth) >= 1 || Math.abs(frame.height - layoutHeight) >= 1)
    return false;
  const x = input.absoluteX - frame.pageX;
  const y = input.absoluteY - frame.pageY;
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return false;
  return input.regions.some(
    (region) =>
      x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height,
  );
}
