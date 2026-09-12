// Threads 冒險者轉職規則。這個檔案只處理遊戲化狀態，會員方案另由 cardTier 決定。
export const FIRST_JOB_KEYS = Object.freeze(['warrior', 'bard', 'assassin', 'knight', 'mage']);
export const SECOND_JOB_MAP = Object.freeze({
  warrior: 'swordmaster',
  bard: 'legendary_bard',
  assassin: 'shadowblade',
  knight: 'paladin',
  mage: 'archmage'
});
export const STAGE_META = Object.freeze({
  villager: { label: '村民', next: 100 },
  first: { label: '一轉', next: 500 },
  second: { label: '二轉', next: null }
});
export const CARD_TIERS = Object.freeze(['normal', 'silver', 'gold']);

export const ADVENTURER_JOBS = Object.freeze({
  villager: { key: 'villager', label: '村民', stage: 'villager', type: '冒險尚未開始', intro: '目前的文案庫正在建立，這只是冒險的起點。', baseJob: null, artKey: 'villager' },
  warrior: { key: 'warrior', label: '戰士', stage: 'first', type: '高頻輸出型', intro: '持續發文、活躍度高，用穩定輸出累積影響力。', baseJob: 'warrior', artKey: 'warrior' },
  bard: { key: 'bard', label: '吟遊詩人', stage: 'first', type: '討論互動型', intro: '擅長引發共鳴，把一篇文變成一場有趣的聊天。', baseJob: 'bard', artKey: 'bard' },
  assassin: { key: 'assassin', label: '刺客', stage: 'first', type: '爆擊型', intro: '發文量不一定高，但總能在關鍵時刻帶來高互動。', baseJob: 'assassin', artKey: 'assassin' },
  knight: { key: 'knight', label: '騎士', stage: 'first', type: '穩定經營型', intro: '內容表現穩定，用時間建立信任與影響力。', baseJob: 'knight', artKey: 'knight' },
  mage: { key: 'mage', label: '法師', stage: 'first', type: '內容實力型', intro: '分享專業、觀點或知識，用有深度的內容吸引對的人。', baseJob: 'mage', artKey: 'mage' },
  swordmaster: { key: 'swordmaster', label: '劍聖', stage: 'second', type: '極致輸出型', intro: '高頻行動，持續進攻，把穩定輸出磨成真正的招牌。', baseJob: 'warrior', artKey: 'swordmaster' },
  legendary_bard: { key: 'legendary_bard', label: '傳奇詩人', stage: 'second', type: '魅力互動型', intro: '你不只會發文，更會把留言區變成舞台。', baseJob: 'bard', artKey: 'legendary_bard' },
  shadowblade: { key: 'shadowblade', label: '影刃', stage: 'second', type: '精準爆發型', intro: '平時低調，出手精準，總能在關鍵時刻打中注意力。', baseJob: 'assassin', artKey: 'shadowblade' },
  paladin: { key: 'paladin', label: '聖騎士', stage: 'second', type: '信任守護型', intro: '穩定、可靠、持續出現，讓信任在時間裡慢慢累積。', baseJob: 'knight', artKey: 'paladin' },
  archmage: { key: 'archmage', label: '大魔導師', stage: 'second', type: '深度內容型', intro: '靠觀點、專業與知識，用內容本身吸引真正對的人。', baseJob: 'mage', artKey: 'archmage' }
});

export function normalizeBaseJob(value) {
  return FIRST_JOB_KEYS.includes(value) ? value : null;
}

export function normalizeCardTier(value) {
  return CARD_TIERS.includes(value) ? value : 'normal';
}

export function cardTierForPlan(plan) {
  return plan === 'pro' ? 'gold' : plan === 'vip' ? 'silver' : 'normal';
}

export function advanceAdventure(previous = {}, options = {}) {
  const count = Math.max(0, Math.floor(Number(options.collectedPostCount ?? previous.collectedPostCount) || 0));
  const previousCount = Math.max(0, Math.floor(Number(previous.lastUniquePostCount ?? previous.collectedPostCount) || 0));
  const previousBaseJob = normalizeBaseJob(previous.baseJob);
  const baseJob = previousBaseJob || (count >= 100 ? normalizeBaseJob(options.baseJob) : null);
  const cardTier = normalizeCardTier(options.cardTier || previous.cardTier);
  const firstCrossed = previousCount < 100 && count >= 100;
  const secondCrossed = previousCount < 500 && count >= 500;
  let jobStage = 'villager';
  let currentJob = 'villager';
  if (count >= 500 && baseJob) {
    jobStage = 'second';
    currentJob = SECOND_JOB_MAP[baseJob];
  } else if (count >= 100 && baseJob) {
    jobStage = 'first';
    currentJob = baseJob;
  }
  const transition = secondCrossed ? 'second' : firstCrossed ? 'first' : null;
  return {
    schemaVersion: 1,
    collectedPostCount: count,
    lastUniquePostCount: count,
    jobStage,
    baseJob,
    currentJob,
    cardTier,
    firstJobUnlocked: Boolean(previous.firstJobUnlocked || firstCrossed),
    secondJobUnlocked: Boolean(previous.secondJobUnlocked || secondCrossed),
    lastTransition: transition || previous.lastTransition || null,
    transition
  };
}

export function jobMeta(key) {
  return ADVENTURER_JOBS[key] || ADVENTURER_JOBS.villager;
}
