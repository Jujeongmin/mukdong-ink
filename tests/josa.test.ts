// "경지 {n}이 필요하다" reads "경지 15가 필요하다": particles after a placeholder follow what fills it (src/game/josa.ts)
import { expect, test } from "vitest";
import { fillKo } from "../src/game/josa";
test("Korean particles follow what fills a placeholder", () => {
  const cases: [string, Record<string, string | number>, string][] = [
    ["경지 {n}이 필요하다", { n: 15 }, "경지 15가 필요하다"],
    ["경지 {n}이 필요하다", { n: 10 }, "경지 10이 필요하다"],
    ["경지 {n}이 필요하다", { n: 13 }, "경지 13이 필요하다"],
    ["경지 {n}이 필요하다", { n: 20 }, "경지 20이 필요하다"],
    ["경지 {n}이 필요하다", { n: 4 }, "경지 4가 필요하다"],
    ["{mat}을 쓰면", { mat: "파괴방지권" }, "파괴방지권을 쓰면"],
    ["{mat}을 쓰면", { mat: "색 조각" }, "색 조각을 쓰면"],
    ["{name}이 부서졌다", { name: "황금붓" }, "황금붓이 부서졌다"],
    ["{name}이 부서졌다", { name: "칠흑검" }, "칠흑검이 부서졌다"],
    ["{skill}을 익혔다", { skill: "바람" }, "바람을 익혔다"],
    ["{skill}을 익혔다", { skill: "화염" }, "화염을 익혔다"],
    ["{skill}을 익혔다", { skill: "먹" }, "먹을 익혔다"],
    ["{skill}을 익혔다", { skill: "물결" }, "물결을 익혔다"],
    ["{skill}을 익혔다", { skill: "대지" }, "대지를 익혔다"],
    ["{x}으로 가자", { x: "마을" }, "마을로 가자"],
    ["{x}으로 가자", { x: "죽림" }, "죽림으로 가자"],
    ["{x}으로 가자", { x: "연못" }, "연못으로 가자"],
    ["{n}경지", { n: 15 }, "15경지"],
    ["{n}이다", { n: 15 }, "15이다"],
  ];
  for (const [ko, v, want] of cases) expect(fillKo(ko, v)).toBe(want);
});
