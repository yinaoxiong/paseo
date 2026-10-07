import { describe, expect, it } from "vitest";
import { getMathFormulaTextStyle } from "./math-formula-style";

describe("getMathFormulaTextStyle", () => {
  it("copies body foreground onto formulas so display math is visible on dark surfaces", () => {
    expect(getMathFormulaTextStyle({ fontSize: 16 }, { color: "#e8e6e3" })).toEqual([
      { fontSize: 16 },
      { color: "#e8e6e3" },
    ]);
  });

  it("leaves the text style unchanged when body has no color", () => {
    const textStyle = { fontSize: 16 };
    expect(getMathFormulaTextStyle(textStyle, {})).toBe(textStyle);
  });
});
