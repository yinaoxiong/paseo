import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { createAnimatedViewRef } from "./native-measurement-ref";

import { captureMobilePanelOpeningTouch, resolveMobilePanelGestureIntent } from "./gesture-intent";
import { isMobilePanelGestureRegionHit } from "./gesture-regions";

// Use the actual pinned native Unistyles cleanup implementation, not a copy or mock.
const require = createRequire(import.meta.url);
const unistylesRoot = path.dirname(require.resolve("react-native-unistyles/package.json"));
const { passForwardedRef } = require(
  path.join(unistylesRoot, "lib/commonjs/core/passForwardRef.js"),
);

describe("native measured-view ref cleanup", () => {
  it("reproduces the installed Unistyles failure when an animated ref leaks its native handle", () => {
    const handle = { nativeWrapper: true };
    const cleanup = passForwardedRef({ id: 1 }, () => handle);
    expect(() => cleanup()).toThrow(TypeError);
  });

  it("detaches and remounts through real Unistyles cleanup without treating a handle as a function", () => {
    const handle = { nativeWrapper: true };
    const first = { id: 1 };
    const second = { id: 2 };
    const attached: Array<typeof first | null> = [];
    const unmounted: number[] = [];
    const callback = createAnimatedViewRef((node: typeof first | null) => {
      attached.push(node);
      return handle;
    });
    const firstCleanup = passForwardedRef(first, callback, undefined, () =>
      unmounted.push(first.id),
    );
    expect(() => firstCleanup()).not.toThrow();
    const secondCleanup = passForwardedRef(second, callback, undefined, () =>
      unmounted.push(second.id),
    );
    expect(() => secondCleanup()).not.toThrow();
    expect(attached).toEqual([first, null, second, null]);
    expect(unmounted).toEqual([1, 2]);
  });
});

describe("mobile panel gesture intent", () => {
  it("rejects a second pointer before it can replace the formula's touch-start ownership", () => {
    const startX = { value: 0 };
    const startY = { value: 0 };
    const blocked = { value: false };
    let failures = 0;
    const stateManager = {
      fail: () => {
        failures++;
      },
    };
    const common = {
      startX,
      startY,
      blocked,
      native: true,
      hitTest: (x: number) => x < 200,
      stateManager,
    };
    captureMobilePanelOpeningTouch({
      ...common,
      numberOfTouches: 1,
      touch: { absoluteX: 150, absoluteY: 170 },
    });
    captureMobilePanelOpeningTouch({
      ...common,
      numberOfTouches: 2,
      touch: { absoluteX: 340, absoluteY: 170 },
    });
    expect({ failures, x: startX.value, y: startY.value, blocked: blocked.value }).toEqual({
      failures: 1,
      x: 150,
      y: 170,
      blocked: true,
    });
    expect(
      [-1, 1].map((direction) =>
        resolveMobilePanelGestureIntent({
          deltaX: direction * 80,
          deltaY: 2,
          direction: direction as -1 | 1,
          openGesturesBlocked: blocked.value,
        }),
      ),
    ).toEqual(["fail", "fail"]);
    captureMobilePanelOpeningTouch({
      ...common,
      numberOfTouches: 1,
      touch: { absoluteX: 340, absoluteY: 170 },
    });
    expect(blocked.value).toBe(false);
  });
  const surface = {
    frame: { pageX: 20, pageY: 100, width: 300, height: 160 },
    layoutWidth: 300,
    layoutHeight: 160,
    regions: [{ x: 0, y: 40, width: 300, height: 60 }],
    viewports: [{ pageX: 0, pageY: 0, width: 400, height: 800 }],
  };

  it("gives both opening directions to a long formula without claiming surrounding prose", () => {
    const startInFormula = isMobilePanelGestureRegionHit({
      ...surface,
      absoluteX: 150,
      absoluteY: 170,
    });
    expect(startInFormula).toBe(true);
    expect(
      [-1, 1].map((direction) =>
        resolveMobilePanelGestureIntent({
          deltaX: direction * 70,
          deltaY: 2,
          direction: direction as -1 | 1,
          openGesturesBlocked: startInFormula,
        }),
      ),
    ).toEqual(["fail", "fail"]);
    expect(isMobilePanelGestureRegionHit({ ...surface, absoluteX: 150, absoluteY: 120 })).toBe(
      false,
    );
    expect(isMobilePanelGestureRegionHit({ ...surface, absoluteX: 150, absoluteY: 240 })).toBe(
      false,
    );
  });

  it("does not block short formulas, stale width or a hidden/zero-sized host", () => {
    const touch = { absoluteX: 150, absoluteY: 170 };
    expect(isMobilePanelGestureRegionHit({ ...surface, ...touch, regions: [] })).toBe(false);
    expect(isMobilePanelGestureRegionHit({ ...surface, ...touch, layoutWidth: 200 })).toBe(false);
    expect(
      isMobilePanelGestureRegionHit({
        ...surface,
        ...touch,
        frame: { ...surface.frame, height: 0 },
      }),
    ).toBe(false);
    expect(isMobilePanelGestureRegionHit({ ...surface, ...touch, layoutHeight: 200 })).toBe(false);
  });

  it("does not let clipped rows block touches over the composer or header", () => {
    const clipped = { ...surface, viewports: [{ pageX: 20, pageY: 160, width: 300, height: 20 }] };
    expect(isMobilePanelGestureRegionHit({ ...clipped, absoluteX: 150, absoluteY: 150 })).toBe(
      false,
    );
    expect(isMobilePanelGestureRegionHit({ ...clipped, absoluteX: 150, absoluteY: 170 })).toBe(
      true,
    );
    expect(isMobilePanelGestureRegionHit({ ...clipped, absoluteX: 150, absoluteY: 190 })).toBe(
      false,
    );
  });

  it("intersects the stationary viewport after the keyboard translates chat content", () => {
    const translated = {
      ...surface,
      viewports: [
        { pageX: 0, pageY: 180, width: 400, height: 600 },
        { pageX: 20, pageY: 100, width: 300, height: 160 },
      ],
    };
    expect(isMobilePanelGestureRegionHit({ ...translated, absoluteX: 150, absoluteY: 170 })).toBe(
      false,
    );
    expect(isMobilePanelGestureRegionHit({ ...translated, absoluteX: 150, absoluteY: 190 })).toBe(
      true,
    );
    expect(
      isMobilePanelGestureRegionHit({ ...surface, viewports: [], absoluteX: 150, absoluteY: 170 }),
    ).toBe(false);
  });

  it("uses the current native position after chat scrolling and excludes outside touches", () => {
    expect(isMobilePanelGestureRegionHit({ ...surface, absoluteX: 330, absoluteY: 170 })).toBe(
      false,
    );
    expect(
      isMobilePanelGestureRegionHit({
        ...surface,
        absoluteX: 150,
        absoluteY: 170,
        frame: { ...surface.frame, pageY: 400 },
      }),
    ).toBe(false);
    expect(
      isMobilePanelGestureRegionHit({
        ...surface,
        absoluteX: 150,
        absoluteY: 470,
        frame: { ...surface.frame, pageY: 400 },
      }),
    ).toBe(true);
  });

  it("blocks both panel-opening directions while the active surface owns horizontal dragging", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: true,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: true,
      }),
    ]).toEqual(["fail", "fail"]);
  });

  it("keeps ordinary horizontal panel gestures available when unblocked", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: false,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: false,
      }),
    ]).toEqual(["activate", "activate"]);
  });
});
