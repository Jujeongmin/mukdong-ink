// Words chat hides and names may not hold: swearing and slurs (Korean and English), the jamo shorthands
// (chat only: a name cannot hold jamo anyway) and posing as staff (names only). Pure data + pure
// functions; the server applies them, the client may preview with the same rules.
//
// Evasions handled: case and full-width letters; digits, dots, underscores and symbols between letters
// ("시.발", "f_u_c_k", "시1발"); look-alike digits in English ("sh1t"); spaces between syllables when the
// word stands on its own ("시 발", "f u c k", but not "다시 발견"); digit spellings ("씨8", "18놈").

/** Matched with separators between letters skipped. */
export const SWEAR_WORDS: readonly string[] = [
  // Korean
  "시발", "씨발", "씨빨", "씨팔", "시팔", "쓰발", "씨바", "씨이발", "싀발", "십알", "씹", "썅", "쌍년", "쌍놈",
  "병신", "븅신", "빙신", "병쉰", "등신", "지랄", "좆", "좃", "존나", "졸라",
  "개새", "개색", "새끼", "섹스", "후장", "자위", "강간",
  "니미", "니애미", "니엄마", "느금", "엠창", "엿먹", "미친놈", "미친년", "미친새", "창녀", "걸레년",
  "닥쳐", "꺼져", "호로새",
  // English
  "fuck", "fuk", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "whore", "slut", "asshole", "bastard",
  "dick", "pussy", "porn", "rapist",
];
/** Chat only: jamo shorthands. */
export const CHAT_ONLY_WORDS: readonly string[] = ["ㅅㅂ", "ㅆㅂ", "ㅂㅅ", "ㅄ", "ㅈㄹ", "ㅈㄴ", "ㅈ같", "ㅗㅗ"];
/** Matched as written, spaces aside (their digits are part of the word). */
export const DIGIT_WORDS: readonly string[] = ["씨8", "시8", "ㅅ8", "18놈", "18년", "18새"];
/** Everyday words that hold a banned one; never masked. */
export const ALLOWED_WORDS: readonly string[] = ["시발점", "시발역", "씹다", "씹어", "씹는", "씹고", "씹을"];
/** Names only: words harmless in a sentence, and posing as the game's staff. */
export const NAME_ONLY_WORDS: readonly string[] = ["보지", "자지", "운영자", "운영진", "운영팀", "관리자", "개발자", "admin", "gamemaster", "moderator"];
/** Short latin staff tags, banned in a name only as a whole token ("GM먹동" yes, "Pigment" no). */
export const NAME_TAGS: readonly string[] = ["gm", "dev", "mod"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
const SEPARATOR = /^[0-9_.,·~\-+=*'"`^:;!?@#$%&|/\\()[\]{}<>]$/;
const SPACE = /^\s$/;
const WORDY = /^[0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]$/;

/** One character as matched: full-width latin and digits folded to ASCII, lower-cased. (Not NFKC: that would turn
 * the compatibility jamo of "ㅅㅂ" into conjoining ones.) */
function fold(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const ascii = code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : ch;
  const low = ascii.toLowerCase();
  return [...low].length === 1 ? low : ch;
}

/** The kept characters (after `keep`), each with its index in the text. */
function scan(folded: string[], keep: (ch: string) => string | null): { at: number[]; plain: string[] } {
  const at: number[] = [];
  const plain: string[] = [];
  folded.forEach((raw, i) => {
    const ch = keep(raw);
    if (ch === null) return;
    at.push(i);
    plain.push(ch);
  });
  return { at, plain };
}

/** Marks in `out` every span where one of `words` appears in the scan (`standalone`: nothing wordy at either end). */
function mark(folded: string[], keep: (ch: string) => string | null, words: readonly string[], out: boolean[], standalone = false): void {
  const s = scan(folded, keep);
  for (const w of words) {
    const word = [...w];
    for (let i = 0; i + word.length <= s.plain.length; i++) {
      if (!word.every((ch, k) => s.plain[i + k] === ch)) continue;
      const from = s.at[i];
      const to = s.at[i + word.length - 1];
      if (standalone && ((from > 0 && WORDY.test(folded[from - 1])) || (to + 1 < folded.length && WORDY.test(folded[to + 1])))) continue;
      for (let j = from; j <= to; j++) out[j] = true;
    }
  }
}

const skipSeparators = (ch: string) => (SEPARATOR.test(ch) || SPACE.test(ch) ? null : ch);
const leetThenSkip = (ch: string) => LEET[ch] ?? skipSeparators(ch);
const noSpaces = (ch: string) => (SPACE.test(ch) ? null : ch);
const asIs = (ch: string) => ch;

/** Which characters of `text` a banned word covers. */
function banned(folded: string[], words: readonly string[], digitWords: readonly string[]): boolean[] {
  // Inside one run of text (a space breaks the word): separators skipped, digits either skipped or read
  // as look-alike letters.
  const inRun = new Array<boolean>(folded.length).fill(false);
  mark(folded, (ch) => (SEPARATOR.test(ch) ? null : ch), words, inRun);
  mark(folded, (ch) => LEET[ch] ?? (SEPARATOR.test(ch) ? null : ch), words, inRun);
  // Across spaces too, but only when the word stands on its own ("시 발", not "다시 발견").
  mark(folded, skipSeparators, words, inRun, true);
  mark(folded, leetThenSkip, words, inRun, true);
  mark(folded, noSpaces, digitWords, inRun);
  // Everyday words are kept as they are.
  const allowed = new Array<boolean>(folded.length).fill(false);
  mark(folded, asIs, ALLOWED_WORDS, allowed);
  return inRun.map((hit, i) => hit && !allowed[i]);
}

/** A chat line with every banned word turned to *, one per character it spans (spaces kept). */
export function maskChat(text: string): string {
  const chars = [...text.normalize("NFC")];
  const hide = banned(chars.map(fold), [...SWEAR_WORDS, ...CHAT_ONLY_WORDS], DIGIT_WORDS);
  return chars.map((ch, i) => (hide[i] && !SPACE.test(ch) ? "*" : ch)).join("");
}

/** Whether a character name holds a banned word or poses as staff. */
export function isBannedName(name: string): boolean {
  const folded = [...name.normalize("NFC")].map(fold);
  if (banned(folded, [...SWEAR_WORDS, ...NAME_ONLY_WORDS], DIGIT_WORDS).some(Boolean)) return true;
  const raw = folded.join("");
  // A staff tag standing alone between non-latin characters (or the ends).
  return NAME_TAGS.some((tag) => new RegExp(`(^|[^a-z])${tag}([^a-z]|$)`).test(raw));
}

/** What chat shows for a name (a name from before these rules that poses as staff shows as 먹동이). */
export function chatName(name: string): string {
  return isBannedName(name) ? "먹동이" : name;
}
