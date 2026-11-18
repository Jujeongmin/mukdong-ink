// Story text: NPC introductions, quest dialogue (offer → accept, in progress, complete), idle chatter,
// the prologue and the chapter ending. Pure data, shared by client and server. See docs/STORY.md.
// No hanja anywhere.

import { MAIN_QUESTS } from "./world";

export interface Line {
  /** speaker: an NPC id, "me" (먹동이), or "" for narration */
  who: string;
  text: string;
  /** a full-screen picture behind dark narration (file name under assets/art, without extension) */
  art?: string;
}

const PARTICLE: Record<string, readonly [string, string]> = {
  이: ["이", "가"], 가: ["이", "가"], 은: ["은", "는"], 는: ["은", "는"], 을: ["을", "를"], 를: ["을", "를"],
  아: ["아", "야"], 야: ["아", "야"], 과: ["과", "와"], 와: ["과", "와"], "(이)": ["이", ""],
};
/** Does the name end on a closing consonant (받침)? Latin and digits by how they are read aloud. */
function endsClosed(name: string): boolean {
  const c = name.charCodeAt(name.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  const ch = name.charAt(name.length - 1).toLowerCase();
  return "013678lmn".includes(ch);
}
/**
 * NPCs call the player by their nickname: `{이름}` in a line becomes the name, and `{이름/아}` adds the particle
 * that fits its last sound (이/가, 은/는, 을/를, 아/야, 과/와, and "(이)" for 이구나 / 구나).
 */
export function fillName(text: string, name: string): string {
  return text.replace(/\{이름(?:\/([^}]+))?\}/g, (_m, p?: string) => {
    if (!p) return name;
    const pair = PARTICLE[p];
    return name + (pair ? pair[endsClosed(name) ? 0 : 1] : p);
  });
}

export interface NpcInfo {
  name: string;
  title: string;
}

export const NPC_INFO: Record<string, NpcInfo> = {
  elder: { name: "먹노인", title: "먹골 마을 촌장" },
  dyer: { name: "단이", title: "염색 장인" },
  altar: { name: "돌쇠", title: "병기 제단지기" },
  baram: { name: "바람이", title: "죽림 지기" },
  noeul: { name: "노을", title: "연못가 뱃사공" },
  heukwol: { name: "흑월", title: "먹봉우리의 은자" },
  dalrae: { name: "달래", title: "옛 가마터 옹기장이" },
  haedam: { name: "해담", title: "불탄 절터의 등지기" },
  hongmae: { name: "홍매", title: "불빛의 붓 검객" },
  voice: { name: "번지는 목소리", title: "" },
};

export const PROLOGUE: Line[] = [
  { who: "", text: "아주 오래전, 세상은 첫 붓 오방붓이 다섯 빛으로 그린 그림이었다.", art: "intro-1" },
  { who: "", text: "서른 해 전, 먹 한 방울 '번짐'이 그 붓을 다섯 조각 냈다.", art: "intro-2" },
  { who: "", text: "세상엔 먹과 종이만 남았다. 색은 검법을 펼치는 순간에만 돌아온다.", art: "intro-3" },
  { who: "", text: "오늘, 연못에서 한 아이가 깨어났다. 목도리에만 붉은빛을 지닌 채.", art: "intro-4" },
];

export interface QuestStory {
  offer: Line[];
  accept: string; // accept button label
  progress: Line[];
  complete: Line[];
}

export const QUEST_STORY: Record<string, QuestStory> = {
  // ---------- 1장 「물빛 조각」 ----------
  c1q3: {
    offer: [
      { who: "elder", text: "눈을 떴구나, {이름/아}. 연못에서 너를 건진 지 사흘째다." },
      { who: "elder", text: "네 손의 붓으로 먹귀신을 벨 수 있다. 옛 붓 검객처럼." },
      { who: "elder", text: "마을 북쪽 문 너머 죽림에서 먹방울 여덟을 베어 보거라." },
      { who: "elder", text: "다 베면 대숲을 지키는 바람이를 찾거라." },
    ],
    accept: "죽림으로 간다",
    progress: [{ who: "elder", text: "죽림에서 먹방울 여덟을 베고 바람이를 찾거라." }],
    complete: [
      { who: "baram", text: "…네가 {이름/(이)}구나, 먹에서 태어났다는 애. 난 바람이야." },
      { who: "baram", text: "아직 너를 못 믿어. 그래도 붓놀림은 나쁘지 않네." },
    ],
  },
  c1q4: {
    offer: [
      { who: "baram", text: "검법은 붓에 깃든 색의 기억이야." },
      { who: "baram", text: "대숲 먹방울을 베면서 4단계까지 올라와." },
      { who: "baram", text: "그럼 붓끝에 불빛이 돌 거야. 화염선풍." },
    ],
    accept: "수련한다",
    progress: [{ who: "baram", text: "아직이야. 4단계까지 대숲에서 더 베고 와." }],
    complete: [
      { who: "baram", text: "…방금 붓끝에 붉은빛 봤어? 화염선풍이야." },
      { who: "baram", text: "검법은 알아서 나가. 넌 피하고 베기만 해." },
    ],
  },
  c1q5: {
    offer: [
      { who: "baram", text: "북쪽 문 앞 먹덩굴 너머 굴에 그림자 무사가 있어." },
      { who: "baram", text: "덩굴은 화염선풍으로 태워. 그리고 그 무사를 베고 와." },
      { who: "baram", text: "그 칼놀림… 스승님이랑 닮았어. 이상하지." },
    ],
    accept: "그림자 무사를 찾는다",
    progress: [{ who: "baram", text: "칼이 미끄러지면 수련에서 검법 하나를 한 단계 올려." }],
    complete: [
      { who: "baram", text: "…붓 검객의 매듭이야. 스승님 띠에 달린 거랑 같아." },
      { who: "baram", text: "먹그림자는 번짐에 삼켜진 옛 검객들이었어. 고마워." },
    ],
  },
  c1q6: {
    offer: [
      { who: "baram", text: "북쪽 문 너머 연못가에 노을 할아버지가 계셔." },
      { who: "baram", text: "연못 바닥에서 색이 남은 무언가가 운대. 가 봐." },
    ],
    accept: "연못가로 간다",
    progress: [{ who: "baram", text: "죽림 북쪽 문을 지나면 연못가야." }],
    complete: [
      { who: "noeul", text: "바람이 보낸 아이로구나. 나는 노을, 늙은 뱃사공이지." },
      { who: "noeul", text: "연꽃 붉던 물은 검어지고, 먹두꺼비 울음만 남았단다." },
    ],
  },
  c1q7: {
    offer: [
      { who: "noeul", text: "연못가의 먹두꺼비 열 마리를 쫓아 다오." },
      { who: "noeul", text: "멀리서 먹을 뱉는단다. 떨어질 자리의 고리를 보렴." },
    ],
    accept: "먹두꺼비를 쫓는다",
    progress: [{ who: "noeul", text: "먹두꺼비 열 마리. 먹 고리 안에 서 있지 마렴." }],
    complete: [
      { who: "noeul", text: "들리느냐, 물 밑의 맑은 소리. 물빛이로구나." },
      { who: "noeul", text: "허나 그 빛을 쥔 건 저 위, 먹봉우리의 그림자란다." },
    ],
  },
  c1q8: {
    offer: [
      { who: "noeul", text: "먹봉우리의 먹은 무겁단다. 지금은 발이 빠지지." },
      { who: "noeul", text: "열다섯 단계까지 붓을 깊게 하고 오렴." },
    ],
    accept: "수련을 쌓는다",
    progress: [{ who: "noeul", text: "물도 고여야 맑아지는 법. 열다섯 단계까지란다." }],
    complete: [
      { who: "noeul", text: "붓끝이 깊어졌구나. 봉우리엔 흑월이라는 이가 있단다." },
      { who: "noeul", text: "반은 사람, 반은 그림자. 먹노인과 오랜 사이지." },
    ],
  },
  c1q9: {
    offer: [{ who: "noeul", text: "연못가 북쪽 문 너머가 먹봉우리란다. 흑월을 찾으렴." }],
    accept: "먹봉우리로 오른다",
    progress: [{ who: "noeul", text: "북쪽 문을 지나면 봉우리란다." }],
    complete: [
      { who: "heukwol", text: "…색 냄새가 나는군. 흑월이다." },
      { who: "me", text: "……먹노인." },
      { who: "heukwol", text: "빛바램 날, 나는 남고 그는 아이들을 데리고 떠났다." },
    ],
  },
  c1q10: {
    offer: [
      { who: "heukwol", text: "꼭대기의 대먹귀를 베라. 물빛 조각을 삼킨 놈이다." },
      { who: "heukwol", text: "내리찍기 전에 먹 고리가 그려진다. 굴러서 피해라." },
      { who: "heukwol", text: "혼자보다 여럿이 낫다." },
    ],
    accept: "대먹귀에게 간다",
    progress: [{ who: "heukwol", text: "칼이 안 들면 수련에서 붓을 +3까지 벼려라." }],
    complete: [
      { who: "", text: "푸른 조각이 붓끝으로 스며든다. 오방붓의 첫 조각, 물빛." },
      { who: "heukwol", text: "조각이 네게 스며들었다. 네가 그 붓에서 왔다는 뜻일지도." },
      { who: "heukwol", text: "먹노인에게 전해라. 흑월은 아직 버틴다고." },
    ],
  },
  // ---------- 2장 「불빛 조각」 ----------
  c2q1: {
    offer: [
      { who: "heukwol", text: "산을 내려가 먹골의 먹노인에게 가라. 내 말을 전하고." },
      { who: "heukwol", text: "다음 조각, 불빛 이야기는 그 늙은이가 해 줄 거다." },
    ],
    accept: "먹골 마을로 내려간다",
    progress: [{ who: "heukwol", text: "연못가와 죽림을 지나면 마을이다." }],
    complete: [
      { who: "elder", text: "…흑월이 버틴다고? 그 고집쟁이가. 고맙다, {이름/아}." },
      { who: "elder", text: "이제 불빛 이야기를 할 때가 됐구나." },
    ],
  },
  c2q2: {
    offer: [
      { who: "elder", text: "그날 붓 검객은 셋이었다. 나, 흑월, 불빛의 홍매." },
      { who: "elder", text: "홍매는 불빛 조각을 안고 사라졌다. 이건 그 띠 자락이다." },
      { who: "elder", text: "동쪽 염색집 단이에게 보이거라. 그 아이 손은 색을 읽는다." },
    ],
    accept: "단이에게 천을 보인다",
    progress: [{ who: "elder", text: "단이는 마을 동쪽 염색집에 있단다." }],
    complete: [
      { who: "dyer", text: "불빛이에요! 가마 불 냄새… 봉우리 너머 옛 가마터예요." },
      { who: "dyer", text: "…근데 이상해요. 처음 보는 천인데 손에 익어요." },
    ],
  },
  c2q3: {
    offer: [
      { who: "dyer", text: "먹봉우리 동쪽 문 너머가 옛 가마터래요." },
      { who: "dyer", text: "이 천이 어디서 왔는지 알아봐 주세요. 꼭 돌려주시고요!" },
    ],
    accept: "옛 가마터로 간다",
    progress: [{ who: "dyer", text: "봉우리에 올라 동쪽 문으로요. 재 냄새 나는 쪽이요!" }],
    complete: [
      { who: "dalrae", text: "어이구, 산 사람이여? 나는 달래, 마지막 옹기장이여." },
      { who: "dalrae", text: "그 천… 홍매 아가씨 띠구먼. 서른 해 전 여길 지나갔어." },
    ],
  },
  c2q4: {
    offer: [
      { who: "dalrae", text: "옛날 얘기는 나중에 혀. 저 뛰어다니는 옹기들부터." },
      { who: "dalrae", text: "먹 스민 옹기귀 열다섯만 깨 줘. 가마터 어디에나 있어." },
    ],
    accept: "옹기귀를 깬다",
    progress: [{ who: "dalrae", text: "옹기귀 열다섯. 깨질 때 맑게 울리면 된 거여." }],
    complete: [
      { who: "dalrae", text: "시원허구먼. 그날 아가씨가 뜨겁지 않은 불을 안고 왔어." },
      { who: "dalrae", text: "큰 가마에 넣어 달라더니, 그 뒤로 지킴이가 들어앉았지." },
    ],
  },
  c2q5: {
    offer: [
      { who: "dalrae", text: "서쪽 비탈 위 큰 가마 입구의 지킴이를 베어 줘." },
      { who: "dalrae", text: "재 껍데기라 얕은 불은 튕겨. 깨어난 화염선풍이어야 혀." },
      { who: "dalrae", text: "수련에서 화염선풍을 5단계로 올려. 색 조각이 하나 들어." },
    ],
    accept: "큰 가마로 오른다",
    progress: [{ who: "dalrae", text: "화염선풍 5단계, 색 조각 하나. 그럼 껍데기가 녹아." }],
    complete: [
      { who: "dalrae", text: "가마에 불기가 돈다! 안에 글씨 긁힌 독이 있었어." },
      { who: "dalrae", text: "'절로 간다. 불씨는 등에 맡긴다.' 저 위 불탄 절터여." },
    ],
  },
  c2q6: {
    offer: [
      { who: "dalrae", text: "절터는 먹이 훨씬 짙어. 스물일곱 단계는 돼야 혀." },
      { who: "dalrae", text: "그때 북쪽 문으로 올라가 불 켜진 등을 찾어." },
    ],
    accept: "붓을 더 깊게 한다",
    progress: [{ who: "dalrae", text: "스물일곱 단계여. 옹기도 불을 오래 먹어야 단단혀." }],
    complete: [
      { who: "haedam", text: "등불을 보고 오셨구려. 나는 해담, 이 절의 등지기요." },
      { who: "haedam", text: "이 등은 홍매님이 맡긴 불씨로 서른 해를 켜 왔소." },
    ],
  },
  c2q7: {
    offer: [
      { who: "haedam", text: "이 절은 오방붓을 모시던 곳이오." },
      { who: "haedam", text: "붓을 지키다 삼켜진 스님들이 그림자 승병이 되었소." },
      { who: "haedam", text: "열다섯 분을 쉬게 해 주시오. 지팡이가 길게 닿소." },
    ],
    accept: "그림자 승병을 쉬게 한다",
    progress: [{ who: "haedam", text: "그림자 승병 열다섯 분. 지팡이 끝을 보시오." }],
    complete: [
      { who: "haedam", text: "고맙소. 그날 홍매님은 내게 불씨를 주고 향로 마당에 드셨소." },
      { who: "haedam", text: "그리고 다시는 나오지 않으셨소." },
    ],
  },
  c2q8: {
    offer: [
      { who: "haedam", text: "돌계단 옆 석등지기 여섯을 쓰러뜨려 주시오." },
      { who: "haedam", text: "향로 마당 가는 길을 막고 있소. 홍매님이 밝혔던 등이오." },
    ],
    accept: "석등지기를 쓰러뜨린다",
    progress: [{ who: "haedam", text: "석등이 몸을 들면 고리가 그려지오. 그때 물러나시오." }],
    complete: [
      { who: "haedam", text: "길이 열렸구려. 나온 먹돌로 붓을 벼려 두시오." },
      { who: "haedam", text: "마당 안엔 잿불귀가 있소. 그 이상은… 조금만 기다려 주시오." },
    ],
  },
  c2q9: {
    offer: [
      { who: "haedam", text: "잿불귀는 대먹귀보다 깊은 먹이오." },
      { who: "haedam", text: "서른두 단계까지 붓을 깊게 하고 오시오." },
    ],
    accept: "붓을 더 깊게 한다",
    progress: [{ who: "haedam", text: "서른두 단계요. 서두르면 등불도 꺼지오." }],
    complete: [
      { who: "haedam", text: "이제 말하겠소. 잿불귀는… 홍매님이오." },
      { who: "haedam", text: "조각을 지키려 삼켰고, 번짐이 그분을 삼켰소. 놓아 드리시오." },
    ],
  },
  c2q10: {
    offer: [
      { who: "haedam", text: "북쪽 문 너머 향로 마당의 잿불귀를 베시오." },
      { who: "haedam", text: "고리가 넓으니 끝까지 구르시오. 여럿이 가는 편이 낫소." },
      { who: "haedam", text: "조각을 찾거든 이 등 앞으로 오시오." },
    ],
    accept: "잿불귀에게 간다",
    progress: [{ who: "haedam", text: "붓이 밀리면 +6까지 벼리시오. 부서지는 건 +12부터요." }],
    complete: [
      { who: "hongmae", text: "…따뜻하구나. 그 목도리는 내가 오방붓에 감아 둔 끈이다." },
      { who: "hongmae", text: "붓이 부러지던 날 먹에 떨어진 끈, 그게 너였구나." },
      { who: "hongmae", text: "먹골의 단이는 내 딸이다. 이 천을 그 아이에게 전해 다오." },
    ],
  },
};

/** Chatter when an NPC has no quest for you right now (one set is picked at random). */
export const IDLE_LINES: Record<string, Line[][]> = {
  elder: [
    [{ who: "elder", text: "날마다 내게 오거라. 그날 할 일을 주마." }],
    [{ who: "elder", text: "쓰러지면 이 마을에서 깨어난다. 겁내지 말고 다시 가거라." }],
  ],
  dyer: [
    [{ who: "dyer", text: "염색통은 언제든 쓰세요! 안료만 있으면 다시 물들여요." }],
    [{ who: "dyer", text: "물약도 팔아요! 위험할 땐 꼭 하나 마시세요." }],
  ],
  altar: [
    [{ who: "altar", text: "…묵옥을 바치면 옛 검객의 붓이 돌아온다. 확률은 제단에 새겼다." }],
    [{ who: "altar", text: "…쉰 번째엔 전설 붓이 반드시 온다. 제단은 셈을 잊지 않는다." }],
  ],
  baram: [
    [{ who: "baram", text: "내리찍는 놈은 바닥에 고리부터 그려. 그때 굴러서 빠져." }],
    [{ who: "baram", text: "대숲은 내가 지켜. 넌 앞만 봐." }],
  ],
  noeul: [
    [{ who: "noeul", text: "날아오는 먹은 고리로 먼저 내려앉는단다. 고리를 보렴." }],
    [{ who: "noeul", text: "물은 기억한단다. 비춘 것을 다." }],
  ],
  heukwol: [
    [{ who: "heukwol", text: "붓이 무디면 수련에서 벼려라. 먹돌은 먹귀신 속에 있다." }],
    [{ who: "heukwol", text: "대먹귀는 다시 고인다. 번짐이 있는 한." }],
  ],
  dalrae: [
    [{ who: "dalrae", text: "재는 다 탄 게 아니여. 불이 잠깐 쉬는 거여." }],
    [{ who: "dalrae", text: "색 조각은 아껴 둬. 검법 5단계 문턱에서 쓰는 거여." }],
    [{ who: "dalrae", text: "홍매 아가씨는 웃을 때 꼭 가마 불 앞에 선 것 같았어." }],
  ],
  haedam: [
    [{ who: "haedam", text: "등불은 바람보다 사람 마음에 더 잘 꺼지오." }],
    [{ who: "haedam", text: "풍경 소리가 들리오? 바람빛은 아직 어딘가 남아 있구려." }],
    [{ who: "haedam", text: "강화가 실패해도 먹돌만 잃소. 붓이 부서지는 건 +12부터요." }],
  ],
};

/** Lines when you talk to an NPC who gives the daily quests. */
export const DAILY_INTRO: Line[] = [
  { who: "elder", text: "먹귀신은 날마다 다시 고인단다. 오늘도 살펴 주겠느냐." },
];

export const CHAPTER_END: Line[] = [
  { who: "", text: "1장 「물빛 조각」 끝." },
  { who: "", text: "다음 이야기: 불빛을 삼킨 그림자, 그리고 {이름/이} 태어난 곳." },
];

export const CHAPTER2_END: Line[] = [
  { who: "", text: "등불이 꺼지고, 재 속에서 낯선 목소리가 번졌다." },
  { who: "voice", text: "조각을 모으는구나. 다섯을 다 모아 내게 돌아오너라." },
  { who: "", text: "같은 시각, 먹봉우리. 흑월의 그림자 팔이 혼자 붓을 쥐었다." },
  { who: "", text: "2장 「불빛 조각」 끝." },
  { who: "", text: "다음 이야기: 흙빛 조각, 그리고 흑월의 그림자." },
];

/** The ending played when a chapter's last main quest is handed in, by chapter number. */
export const CHAPTER_ENDS: Record<number, Line[]> = { 1: CHAPTER_END, 2: CHAPTER2_END };

/** Chapter number of a main quest, by its index in MAIN_QUESTS or its id ("c2q4" -> 2). */
export function chapterOf(quest: number | string): number {
  const id = typeof quest === "number" ? MAIN_QUESTS[quest]?.id ?? "" : quest;
  const digits = id.startsWith("c") ? id.slice(1, id.indexOf("q") > 0 ? id.indexOf("q") : undefined) : "";
  const n = Number(digits);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * 서브 퀘스트 lines, in each keeper's own voice: what they ask when you talk to them (offer), and the word they
 * give when it's done (done: said in the talk, and shown under the reward when handed in from the tracker).
 */
export const SUB_STORY: Record<string, { offer: Line[]; done: string }> = {
  s_bam1: {
    offer: [{ who: "baram", text: "먹방울이 또 불었어. 대숲 길이 미끄러워." }, { who: "baram", text: "열두 마리만 치워 줄래? 나도 쉬고 싶거든." }],
    done: "길이 좀 보이네. 고마워.",
  },
  s_bam2: {
    offer: [{ who: "baram", text: "대숲 안쪽에 먹그림자가 숨어 있어." }, { who: "baram", text: "네 마리. 혼자 가기엔 좀 무섭더라." }],
    done: "그림자 없어지니까 대숲이 조용하다.",
  },
  s_bam3: {
    offer: [{ who: "baram", text: "한 바퀴 돌면서 보이는 대로 베 줘." }, { who: "baram", text: "열다섯이면 오늘은 됐어." }],
    done: "수고했어. 내일 또 부탁할지도 몰라.",
  },
  s_pond1: {
    offer: [{ who: "noeul", text: "물가에 먹방울이 엉겨서 배를 못 댄단다." }, { who: "noeul", text: "열두 놈만 걷어 다오." }],
    done: "이제 배를 댈 수 있겠구나. 고맙다.",
  },
  s_pond2: {
    offer: [{ who: "noeul", text: "먹두꺼비가 물에 먹을 뱉어 대는구나." }, { who: "noeul", text: "여덟 마리만 쫓아 다오. 뱉는 자리를 잘 보렴." }],
    done: "물빛이 조금 맑아졌구나.",
  },
  s_pond3: {
    offer: [{ who: "noeul", text: "연못을 한 바퀴 돌아 보련?" }, { who: "noeul", text: "눈에 띄는 먹귀신 열여덟만 베어 다오." }],
    done: "덕분에 오늘 밤은 편히 노를 젓겠구나.",
  },
  s_peak1: {
    offer: [{ who: "heukwol", text: "바위 사이에 먹그림자가 다시 고였다." }, { who: "heukwol", text: "열을 베라." }],
    done: "됐다. 손이 빨라졌군.",
  },
  s_peak2: {
    offer: [{ who: "heukwol", text: "바위틈에 먹두꺼비가 붙어 있다." }, { who: "heukwol", text: "열 마리. 뱉는 먹을 맞지 마라." }],
    done: "좋다. 다음에도 부탁하지.",
  },
  s_peak3: {
    offer: [{ who: "heukwol", text: "봉우리를 한 바퀴 돌아라." }, { who: "heukwol", text: "스물을 베면 돌아와도 된다." }],
    done: "쉬어라. 오래 버티는 것도 실력이다.",
  },
  s_kiln1: {
    offer: [{ who: "dalrae", text: "아이고, 옹기들이 또 뛰어다니네." }, { who: "dalrae", text: "열두 개만 깨 줘. 다시 빚으면 되니께." }],
    done: "어이구, 시원허다. 고마워.",
  },
  s_kiln2: {
    offer: [{ who: "dalrae", text: "잿까마귀가 가마 위에서 재를 뿌려 대." }, { who: "dalrae", text: "여덟 마리만 떨궈 줘." }],
    done: "하늘이 좀 맑아졌구먼.",
  },
  s_kiln3: {
    offer: [{ who: "dalrae", text: "가마터 한 바퀴만 돌아 줄텨?" }, { who: "dalrae", text: "스물만 베면 오늘은 문 닫어도 되겄어." }],
    done: "수고혔어. 이따 뭐라도 구워 줄게.",
  },
  s_tem1: {
    offer: [{ who: "haedam", text: "그림자 승병들이 아직 절을 지키고 있소." }, { who: "haedam", text: "열 분만 쉬게 해 주시오." }],
    done: "고맙소. 조금은 편히 쉬실 거요.",
  },
  s_tem2: {
    offer: [{ who: "haedam", text: "석등지기가 길을 막고 있소." }, { who: "haedam", text: "넷만 무너뜨려 주시오. 내리치기 전에 물러나시고." }],
    done: "길이 트였소. 등불도 더 멀리 보이겠구려.",
  },
  s_tem3: {
    offer: [{ who: "haedam", text: "절터를 한 바퀴 돌아 주겠소?" }, { who: "haedam", text: "스물둘을 베면 오늘 밤은 조용할 거요." }],
    done: "오늘도 무사히 지나가는구려. 고맙소.",
  },
};
