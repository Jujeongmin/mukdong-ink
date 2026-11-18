import { DYES, harmonySkill } from "../../src/shared/items";
import { SKILLS } from "../../src/shared/combat";

describe("염색 조화", () => {
  test("one color per 검법, plus 검정", () => {
    const skills = DYES.filter((d) => d.skill != null).map((d) => d.skill);
    expect(skills).toEqual(SKILLS.map((_, i) => i));
    expect(DYES.filter((d) => d.hex === null).length).toBe(1);
  });

  test("scarf and sash in the same 검법 color: that 검법; otherwise none", () => {
    const red = DYES.find((d) => d.name === "빨강")!.hex;
    const blue = DYES.find((d) => d.name === "파랑")!.hex;
    expect(harmonySkill({ scarf: red, sash: red })).toBe(1);
    expect(harmonySkill({ scarf: red, sash: blue })).toBe(-1);
    expect(harmonySkill({ scarf: null, sash: null })).toBe(-1);
    // an old color no longer sold gives nothing
    expect(harmonySkill({ scarf: 0xe58aa5, sash: 0xe58aa5 })).toBe(-1);
  });
});
