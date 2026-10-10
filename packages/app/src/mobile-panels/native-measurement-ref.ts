/** Reanimated's getter handle is not a React/Unistyles ref cleanup callback. */
export function createAnimatedViewRef<T>(setAnimatedRef: (node: T | null) => unknown) {
  return (node: T | null): void | (() => void) => {
    setAnimatedRef(node);
    if (node === null) return;
    return () => {
      setAnimatedRef(null);
    };
  };
}
