// 1080 × 1350 冒險者卡面。職業由文案分析決定，卡面等級只由會員方案決定。
import { ADVENTURER_JOBS, normalizeCardTier } from './adventure-system.js';

const COLORS = {
  villager: ['#8a6640', '#ece2cd'], warrior: ['#9b4c31', '#eee0d4'], bard: ['#3d6752', '#dee7d8'],
  assassin: ['#66517d', '#e4deec'], knight: ['#2e5d86', '#dce6ed'], mage: ['#625080', '#e3dcef'],
  swordmaster: ['#9b4c31', '#eee0d4'], legendary_bard: ['#3d6752', '#dee7d8'], shadowblade: ['#66517d', '#e4deec'],
  paladin: ['#2e5d86', '#dce6ed'], archmage: ['#625080', '#e3dcef']
};
export const professions = Object.freeze(Object.fromEntries(Object.entries(ADVENTURER_JOBS).map(([key, job]) => [key, {
  label: job.label, color: COLORS[key][0], pale: COLORS[key][1], subtitle: job.type, intro: job.intro,
  artKey: job.artKey, stage: job.stage, baseJob: job.baseJob
}])));

const TIER_META = Object.freeze({
  normal: { label: 'NORMAL', frame: '#1b2a40', inner: '#5b6774', accent: '#cf9641', paper: '#f8f2e7', sparkle: false },
  silver: { label: 'SILVER', frame: '#607080', inner: '#b8c2cc', accent: '#94a7b8', paper: '#f2f4f6', sparkle: true },
  gold: { label: 'GOLD · PRO', frame: '#9b6a12', inner: '#e8b947', accent: '#d89a22', paper: '#fbf2dc', sparkle: true }
});
const STAGE_LABELS = Object.freeze({ villager: '村民', first: '一轉', second: '二轉' });
function tierMeta(value) { return TIER_META[normalizeCardTier(value)] || TIER_META.normal; }

export async function drawCard(canvas, data = {}) {
  const key = professions[data.profession?.key] ? data.profession.key : 'villager';
  const p = professions[key], tier = tierMeta(data.cardTier || data.adventure?.cardTier), art = new Image();
  art.src = new URL(`${p.artKey || key}.png`, import.meta.url).href;
  await art.decode(); await document.fonts.ready;
  canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext('2d'); c.fillStyle = tier.paper; c.fillRect(0, 0, 1080, 1350);
  let seed = tier.sparkle ? 29 : 7; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  c.fillStyle = tier.sparkle ? 'rgba(216,154,67,.20)' : 'rgba(174,150,110,.18)';
  for (let i = 0; i < (tier.sparkle ? 9000 : 7000); i++) c.fillRect(random() * 1080, random() * 1350, 1, 1);
  if (tier.sparkle) { c.fillStyle = tier === TIER_META.gold ? 'rgba(255,205,70,.75)' : 'rgba(255,255,255,.85)'; for (let i = 0; i < 28; i++) { const x = 55 + random() * 970, y = 55 + random() * 1220; c.fillRect(x, y, 2, 2); c.fillRect(x - 3, y + 1, 8, 1); c.fillRect(x, y - 3, 1, 8); } }
  function box(x, y, w, h, r, fill, stroke, line = 2) { c.beginPath(); c.roundRect(x, y, w, h, r); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = line; c.stroke(); } }
  function text(value, x, y, size, color, align = 'left', outline = 0, max = 850) { c.font = `${size}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`; while (c.measureText(String(value)).width > max && size > 16) { size--; c.font = `${size}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`; } c.textAlign = align; c.textBaseline = 'top'; c.fillStyle = color; if (outline) { c.strokeStyle = '#1b2a40'; c.lineWidth = outline * 2; c.lineJoin = 'round'; c.strokeText(value, x, y); } c.fillText(value, x, y); }
  box(33, 33, 1014, 1284, 21, null, tier.frame, tier === TIER_META.normal ? 10 : 12); box(54, 54, 972, 1242, 17, null, tier.inner, 2);
  const scale = Math.max(904 / art.width, 650 / art.height), sw = 904 / scale, sh = 650 / scale; c.drawImage(art, (art.width - sw) / 2, (art.height - sh) / 2, sw, sh, 88, 92, 904, 650);
  const adventure = data.adventure || {}, stageLabel = STAGE_LABELS[adventure.jobStage] || (p.stage === 'second' ? '二轉' : p.stage === 'first' ? '一轉' : '村民');
  text(stageLabel, 125, 130, 32, '#fffbee', 'left', 3); text(p.label, 125, 180, 40, '#fffbee', 'left', 3); text(`@${data.username || 'threads_adventurer'}`, 940, 617, 24, '#fffbee', 'right', 2, 470);
  box(820, 76, 190, 52, 20, tier.paper, tier.frame, 3); text(tier.label, 915, 90, 20, tier.frame, 'center', 0, 180);
  box(89, 681, 902, 318, 25, '#fffcf6', tier.frame, 3); text('THREADS ADVENTURER', 126, 723, 21, p.color); text('戰鬥力', 126, 774, 35, p.color); text(Number(data.battlePower || 0).toFixed(2), 952, 772, 58, p.color, 'right');
  c.beginPath(); c.moveTo(126, 837); c.lineTo(954, 837); c.strokeStyle = '#d6cdbf'; c.lineWidth = 2; c.stroke();
  (data.dimensions || []).slice(0, 5).forEach((row, i) => { const x = 172 + i * 180, score = Math.max(0, Math.min(100, Number(row.score) || 0)); text(row.label, x, 867, 22, '#1b2a40', 'center'); box(x - 55, 903, 110, 17, 8, '#e8e0d2'); if (score > 0) box(x - 55, 903, 110 * score / 100, 17, Math.min(8, 110 * score / 200), tier.accent); text(String(Math.round(score)), x, 941, 25, '#1b2a40', 'center'); });
  box(89, 1031, 902, 191, 25, p.pale, p.color, 3); text(`${p.label}  ·  ${p.subtitle}`, 126, 1073, 31, p.color); text(p.intro, 126, 1127, 25, '#1b2a40'); text('每一種經營方式，都是一種厲害。', 126, 1177, 23, '#61676b');
  const collected = Number(adventure.collectedPostCount ?? data.source?.collectedPostCount ?? data.source?.sampleCount ?? 0); text(`已蒐集 ${collected} 篇  ·  ${stageLabel}  ·  ${tier.label}`, 954, 1271, 19, '#61676b', 'right');
}

export { TIER_META, STAGE_LABELS };
