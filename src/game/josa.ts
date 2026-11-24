// Korean particles after a filled-in placeholder: "경지 {n}이 필요하다" reads "경지 15가 필요하다" and "경지 10이
// 필요하다"; "{mat}을 쓰면" reads "파괴방지권을" / "대지를". The source may write either form of a pair (이/가, 을/를,
// 은/는, 과/와, 으로/로); a particle that runs straight into more hangul (a copula like "{n}이다") is left alone.
// Pure (no DOM): i18n's t() uses it for Korean, and tests/josa.test.ts checks it.

/** `{name}` placeholders filled from `vars`, each particle right after one fitted to what went in. */
export function fillKo(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}(으로|이|가|을|를|은|는|과|와|로)?/g, (m, k: string, josa: string | undefined, at: number) => {
    if (!(k in vars)) return m;
    const v = String(vars[k]);
    if (!josa || /[가-힣]/.test(s.charAt(at + m.length))) return v + (josa ?? "");
    return v + particle(v, josa);
  });
}

/** 받침 of how a word or number ends when read aloud: null for none, else the final consonant index (8 = ㄹ). */
export function batchim(word: string): number | null {
  const w = word.trim();
  const c = w.charCodeAt(w.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) { const j = (c - 0xac00) % 28; return j === 0 ? null : j; }
  const num = /([0-9]+)$/.exec(w);
  if (num) {
    const d = num[1];
    const zeros = d.length - d.replace(/0+$/, "").length;
    if (d.replace(/0+$/, "") === "") return 21; // 영
    if (zeros === 0) return [null, 8, null, 16, null, null, 1, 8, 8, null][Number(d[d.length - 1])] ?? null; // 일 이 삼 사 오 육 칠 팔 구
    return zeros === 1 ? 17 : zeros === 2 ? 1 : 4; // 십, 백, 천·만 and up
  }
  if (/[lL]$/.test(w)) return 8;
  if (/[mnMN]$/.test(w)) return 4;
  return null;
}

/** The form of a particle that fits after `word` (written either way in the source: 이/가, 을/를, 으로/로…). */
export function particle(word: string, josa: string): string {
  const b = batchim(word);
  const pairs: Record<string, [string, string]> = { 이: ["이", "가"], 가: ["이", "가"], 을: ["을", "를"], 를: ["을", "를"], 은: ["은", "는"], 는: ["은", "는"], 과: ["과", "와"], 와: ["과", "와"] };
  if (josa === "으로" || josa === "로") return b === null || b === 8 ? "로" : "으로";
  const pair = pairs[josa];
  return pair ? (b === null ? pair[1] : pair[0]) : josa;
}
