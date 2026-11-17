// Story text: NPC introductions, quest dialogue (offer → accept, in progress, complete), idle chatter,
// the prologue and the chapter ending. Pure data, shared by client and server. See docs/STORY.md.
// No hanja anywhere.

export interface Line {
  /** speaker: an NPC id, "me" (먹동이), or "" for narration */
  who: string;
  text: string;
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
};

export const PROLOGUE: Line[] = [
  { who: "", text: "아주 오래전, 세상은 다섯 빛으로 그려진 한 폭의 그림이었다." },
  { who: "", text: "서른 해 전, 그림 가장자리에서 떨어진 먹 한 방울이 멈추지 않고 번졌다. 사람들은 그것을 '번짐'이라 불렀다." },
  { who: "", text: "번짐은 첫 붓 오방붓을 다섯 조각으로 부러뜨리고, 세상의 색을 마셔 버렸다." },
  { who: "", text: "그날 이후 세상에는 먹과 종이만 남았다. 색은 붓 검객이 검법을 펼치는 그 순간에만 잠깐 되살아난다." },
  { who: "", text: "그리고 오늘, 먹골 마을 연못에서 먹방울 하나가 터지며 한 아이가 깨어났다. 목에 감긴 천 조각에만, 희미한 분홍빛이 남아 있었다." },
];

export interface QuestStory {
  offer: Line[];
  accept: string; // accept button label
  progress: Line[];
  complete: Line[];
}

export const QUEST_STORY: Record<string, QuestStory> = {
  c1q1: {
    offer: [
      { who: "elder", text: "눈을 떴구나. 연못에서 너를 건져 올린 지 사흘이 지났단다." },
      { who: "elder", text: "놀라지 말거라. 네 몸은 먹으로 되어 있다. 이 세상의 것들은 이제 다 그렇지." },
      { who: "elder", text: "한데 이상하구나. 네 목에 감긴 그 천… 분홍빛이 남아 있어. 빛바램 이후로 색은 저절로 남아 있지 않는데." },
      { who: "elder", text: "마을 동쪽 염색집의 단이에게 보여 주거라. 그 아이는 색을 손으로 기억하지." },
    ],
    accept: "단이를 찾아간다",
    progress: [{ who: "elder", text: "단이는 동쪽 빨랫대 옆에 있단다. 천들이 걸려 있는 곳이야." }],
    complete: [
      { who: "dyer", text: "어머, 어머! 이거 진짜 색이에요! 물들인 게 아니라 원래부터 있던 색!" },
      { who: "dyer", text: "저는 단이예요. 먹귀신을 베면 나오는 '안료'로 천을 잠깐 물들이는 일을 해요." },
      { who: "dyer", text: "근데 이 분홍은 안료 색이 아니에요. 빛바램 전의… 진짜 색 같아요. 소름 돋았어요." },
      { who: "me", text: "……." },
      { who: "dyer", text: "말이 없는 편이구나! 괜찮아요. 안료 조금 챙겨 줄게요. 물들이는 법부터 알려 드릴게요!" },
    ],
  },
  c1q2: {
    offer: [
      { who: "dyer", text: "안료는 색의 부스러기예요. 번짐이 마신 색이 먹귀신 안에 갇혀 있다가, 베면 흩어지는 거죠." },
      { who: "dyer", text: "그걸 천에 먹이면 잠깐이지만 색이 돌아와요. 먹 세상에서도 남들 눈에 보이는 색이요." },
      { who: "dyer", text: "방금 드린 안료로 허리띠나 목도리를 한 번 물들여 보세요. 제 염색통 쓰셔도 돼요!" },
    ],
    accept: "물들여 본다",
    progress: [{ who: "dyer", text: "염색통 앞에서 색을 골라 보세요. 마음에 드는 걸로요!" }],
    complete: [
      { who: "dyer", text: "와, 잘 어울려요! 색이 있으니까 사람이 살아 보이네요." },
      { who: "dyer", text: "먹노인 할아버지가 아까부터 찾으시던데요? 죽림 얘기를 하시는 것 같았어요." },
    ],
  },
  c1q3: {
    offer: [
      { who: "elder", text: "단이가 놀라더냐. 그럴 테지. 나도 서른 해 만에 처음 보는 빛이다." },
      { who: "elder", text: "그 손에 쥔 붓을 보거라. 예전엔 붓 검객들이 붓끝에 빛을 담아 번짐과 싸웠다. 나도 그중 하나였지." },
      { who: "elder", text: "이 굳은 왼팔로는 더는 붓을 못 쥐지만… 너라면 어쩌면." },
      { who: "elder", text: "북쪽 죽림에 먹방울이 늘었다. 여덟쯤 베어 보거라. 붓이 손에 익을 게다. 거기 바람이가 있으니 다 하면 그 아이를 찾거라." },
    ],
    accept: "죽림으로 간다",
    progress: [{ who: "elder", text: "베고 나면 그 자리에 색 부스러기가 흩어질 게다. 그게 안료란다." }],
    complete: [
      { who: "baram", text: "…너구나. 먹에서 태어났다는 애." },
      { who: "baram", text: "난 바람이. 이 대숲을 지켜. 스승님이 너를 보냈다는 건 들었어." },
      { who: "baram", text: "솔직히 말할게. 난 아직 너를 못 믿어. 먹에서 나온 건 다 번짐 편이었으니까." },
      { who: "baram", text: "그래도 방금 그 칼놀림… 아니, 붓놀림은 나쁘지 않았어." },
    ],
  },
  c1q4: {
    offer: [
      { who: "baram", text: "검법은 몸에 깃든 색의 기억이야. 물결베기는 물빛, 화염선풍은 불빛." },
      { who: "baram", text: "수련이 쌓이면 붓이 더 깊은 빛을 기억해 내. 4단계까지 올라와. 그럼 화염선풍을 인정해 줄게." },
    ],
    accept: "수련한다",
    progress: [{ who: "baram", text: "아직이야. 대숲 먹방울이 남아 있잖아. 더 베고 와." }],
    complete: [
      { who: "baram", text: "…방금 붓끝에 붉은빛 봤어? 불빛이야. 화염선풍." },
      { who: "baram", text: "스승님 말고 불빛을 그렇게 낸 사람은 처음 봐. 인정할게." },
    ],
  },
  c1q5: {
    offer: [
      { who: "baram", text: "대숲 북쪽 문 앞에 먹덩굴이 엉켜 있어. 그 너머 굴에 그림자 무사가 살아." },
      { who: "baram", text: "이상하지. 그 칼놀림이… 스승님 칼놀림이랑 닮았어." },
      { who: "baram", text: "덩굴은 화염선풍으로 태워. 그리고 굴의 무사를 베고 와." },
    ],
    accept: "그림자 무사를 찾는다",
    progress: [
      { who: "baram", text: "칼이 미끄러졌지? 먹 갑옷이야. 단련 안 한 검법은 그냥 튕겨 나가." },
      { who: "baram", text: "수련에서 검법 하나라도 한 단계 올리고 다시 가. 붓을 치켜드는 순간엔 굴러서 피하고." },
    ],
    complete: [
      { who: "baram", text: "…이건 붓 검객의 매듭이야. 스승님 띠에 달린 거랑 똑같아." },
      { who: "baram", text: "그러니까 먹그림자는… 번짐에 삼켜진 옛 붓 검객들이었던 거야." },
      { who: "baram", text: "스승님은 알고 계셨겠지. 그래서 아무 말씀 안 하신 거고." },
      { who: "me", text: "……." },
      { who: "baram", text: "괜찮아. 그분들이 계속 그림자로 떠도는 것보단 나아. 고마워." },
    ],
  },
  c1q6: {
    offer: [
      { who: "baram", text: "죽림 너머 연못가에 노을 할아버지가 계셔. 빛바램 전부터 배를 저으셨대." },
      { who: "baram", text: "요즘 연못 바닥에서 뭔가가 운대. 네 목도리처럼 색이 남은 무언가가." },
      { who: "baram", text: "가 봐. 대숲은 내가 지킬게. …다치지 말고." },
    ],
    accept: "연못가로 간다",
    progress: [{ who: "baram", text: "북쪽 문을 지나면 연못가야." }],
    complete: [
      { who: "noeul", text: "바람이 보낸 아이로구나. 물 위에 비친 네 모습이… 반은 먹이고 반은 분홍이네." },
      { who: "noeul", text: "나는 노을이라 한다. 이 연못에 연꽃이 붉게 피던 시절을 기억하는 늙은이지." },
      { who: "noeul", text: "꽃은 지고, 물은 검어지고, 이제 남은 건 먹두꺼비 울음뿐이란다." },
    ],
  },
  c1q7: {
    offer: [
      { who: "noeul", text: "먹두꺼비들이 연못에 먹을 뱉어 물을 더 검게 만든단다. 멀리서 침을 쏘니 조심하렴." },
      { who: "noeul", text: "열 마리쯤 쫓아 주면, 물 밑의 소리가 조금은 또렷해지겠지." },
    ],
    accept: "먹두꺼비를 쫓는다",
    progress: [{ who: "noeul", text: "먹 침이 떨어질 자리에 먹 고리가 먼저 그려진단다. 그 안에 서 있지 마렴." }],
    complete: [
      { who: "noeul", text: "들리느냐. 물 밑에서… 맑은 소리가 울린다." },
      { who: "noeul", text: "저건 물빛이다. 오방붓의 다섯 조각 중 하나가 이 근처에 있어." },
      { who: "noeul", text: "하지만 그 빛을 품고 있는 건 연못이 아니라… 저 위, 먹봉우리의 그림자구나." },
    ],
  },
  c1q8: {
    offer: [
      { who: "noeul", text: "먹봉우리는 번짐이 처음 떨어진 자리에 가장 가까운 곳이란다. 그곳의 먹은 무겁고 깊지." },
      { who: "noeul", text: "열다섯 단계쯤 붓이 깊어지면 올라가거라. 그 전엔 먹에 발이 빠져 돌아오지 못할 게다." },
    ],
    accept: "수련을 쌓는다",
    progress: [{ who: "noeul", text: "서두르지 마라. 물도 고여야 맑아지는 법이란다." }],
    complete: [
      { who: "noeul", text: "붓끝이 깊어졌구나. 이제 먹봉우리에 오를 때가 되었다." },
      { who: "noeul", text: "봉우리에 '흑월'이라는 이가 있을 게다. 반은 사람이고 반은 그림자인 이." },
      { who: "noeul", text: "그를 만나면 먹노인의 이름을 대거라. …그 둘 사이엔 오래된 이야기가 있단다." },
    ],
  },
  c1q9: {
    offer: [
      { who: "noeul", text: "북쪽 문 너머가 먹봉우리다. 바람이 차니 목도리를 단단히 여미렴." },
    ],
    accept: "먹봉우리로 오른다",
    progress: [{ who: "noeul", text: "연못가 북쪽 문을 지나거라." }],
    complete: [
      { who: "heukwol", text: "…먹 냄새가 나는데, 색 냄새도 나는군." },
      { who: "heukwol", text: "흑월이다. 보다시피 반은 그림자가 됐지." },
      { who: "me", text: "……먹노인." },
      { who: "heukwol", text: "그 이름을 여기서 들을 줄이야. 그 늙은이, 아직 살아 있나." },
      { who: "heukwol", text: "빛바램 날, 나는 번짐을 막으려 남았고 그는 마을 아이들을 데리고 떠났다. 원망하진 않는다. 그게 옳았으니까." },
    ],
  },
  c1q10: {
    offer: [
      { who: "heukwol", text: "이 봉우리 꼭대기에 대먹귀가 있다. 번짐의 첫째 그림자. 물빛 조각을 삼킨 놈이다." },
      { who: "heukwol", text: "놈이 바닥을 내리찍기 전에 먹 고리가 그려진다. 고리 밖으로 피해라. 혼자보다 여럿이 낫다." },
      { who: "heukwol", text: "놈을 베면 물빛이 돌아올 거다. 그리고 너는… 네가 왜 색을 가졌는지 조금은 알게 되겠지." },
    ],
    accept: "대먹귀에게 간다",
    progress: [
      { who: "heukwol", text: "놈의 먹 갑옷은 무딘 붓을 받아 내지 않는다. 붓을 +3까지 다듬고 와라." },
      { who: "heukwol", text: "수련에서 먹돌로 붓을 벼려라. +3까지는 부서질 걱정 없다." },
      { who: "heukwol", text: "놈은 쓰러져도 다시 고인다. 때를 기다렸다가 다시 올라가라." },
    ],
    complete: [
      { who: "heukwol", text: "…해냈군. 봐라. 놈이 남긴 먹 속에서 푸른빛이 떨린다." },
      { who: "", text: "먹동이가 손을 뻗자, 푸른 조각이 붓끝으로 스며든다. 순간 봉우리 아래 연못이 아주 잠깐, 물빛으로 반짝였다." },
      { who: "heukwol", text: "오방붓의 첫 조각, 물빛 조각이다. 남은 건 넷. 불빛, 흙빛, 바람빛, 그리고 먹빛." },
      { who: "heukwol", text: "그리고 하나 더. 조각이 너에게 스며들었다는 건… 네가 그 붓과 같은 것에서 나왔다는 뜻일 수도 있다." },
      { who: "heukwol", text: "먹노인에게 전해라. 흑월은 아직 버티고 있다고." },
    ],
  },
};

/** Chatter when an NPC has no quest for you right now (one set is picked at random). */
export const IDLE_LINES: Record<string, Line[][]> = {
  elder: [
    [{ who: "elder", text: "붓은 힘으로 쥐는 게 아니란다. 먹이 스스로 흐르게 두거라." }],
    [{ who: "elder", text: "빛바램 이후 서른 해… 이 마을에 웃음소리가 다시 들리는구나." }],
  ],
  dyer: [
    [{ who: "dyer", text: "안료가 모이면 언제든 오세요! 오늘은 쪽빛이 예쁘게 먹어요." }],
    [{ who: "dyer", text: "색이 있는 천을 두른 사람은 멀리서도 보여요. 그게 좋아요. 혼자가 아니라는 표시 같아서요." }],
  ],
  altar: [
    [{ who: "altar", text: "…묵옥을 바치면, 번짐에 삼켜진 검객들의 붓이 돌아온다. 어느 붓이 올지는 제단이 정한다." }],
    [{ who: "altar", text: "…확률은 제단에 다 새겨 두었다. 숨기는 것 없다." }],
  ],
  baram: [
    [{ who: "baram", text: "대숲은 내가 지켜. 넌 앞만 봐." }],
    [{ who: "baram", text: "스승님 팔이 왜 굳었는지 알아? …나도 몰라. 안 알려 주셔." }],
  ],
  noeul: [
    [{ who: "noeul", text: "물은 기억한단다. 비춘 것을 다." }],
    [{ who: "noeul", text: "언젠가 다시 노를 저어 붉은 연꽃 사이를 지나 보고 싶구나." }],
  ],
  heukwol: [
    [{ who: "heukwol", text: "그림자가 된 쪽 팔이 아직도 붓을 쥐려 한다. 버릇이란 무섭지." }],
    [{ who: "heukwol", text: "대먹귀는 다시 고인다. 번짐이 있는 한." }],
  ],
};

/** Lines when you talk to an NPC who gives the daily quests. */
export const DAILY_INTRO: Line[] = [
  { who: "elder", text: "날마다 먹귀신은 다시 고인단다. 오늘도 마을 둘레를 좀 살펴 주겠느냐." },
];

export const CHAPTER_END: Line[] = [
  { who: "", text: "1장 「물빛 조각」 끝." },
  { who: "", text: "다음 이야기: 불빛을 삼킨 그림자, 그리고 먹동이가 태어난 곳." },
];
