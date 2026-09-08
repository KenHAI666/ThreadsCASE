// Approved 1080 × 1350 layout. Only data and the matching profession artwork vary.
export const professions = {
  warrior: { label:'戰士', color:'#9b4c31', pale:'#eee0d4', subtitle:'高頻輸出型', intro:'持續發文、活躍度高，用穩定輸出累積影響力。' },
  bard: { label:'吟遊詩人', color:'#3d6752', pale:'#dee7d8', subtitle:'討論互動型', intro:'擅長引發共鳴，把一篇文變成一場有趣的聊天。' },
  assassin: { label:'刺客', color:'#66517d', pale:'#e4deec', subtitle:'爆擊型', intro:'發文量不一定高，但總能在關鍵時刻帶來高互動。' },
  knight: { label:'騎士', color:'#2e5d86', pale:'#dce6ed', subtitle:'穩定經營型', intro:'內容表現穩定，用時間建立信任與影響力。' },
  mage: { label:'法師', color:'#625080', pale:'#e3dcef', subtitle:'內容實力型', intro:'分享專業、觀點或知識，用有深度的內容吸引對的人。' },
  villager: { label:'村民', color:'#8a6640', pale:'#ece2cd', subtitle:'冒險尚未開始', intro:'目前的公開樣本較少，這只是冒險的起點。' }
};

export async function drawCard(canvas, data) {
  const key = professions[data.profession?.key] ? data.profession.key : 'villager';
  const p = professions[key];
  const art = new Image();
  art.src = `/assets/${key}.png`;
  await art.decode();
  await document.fonts.ready;
  canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext('2d');
  const navy = '#1b2a40', muted = '#61676b';
  c.fillStyle = '#f8f2e7'; c.fillRect(0,0,1080,1350);
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  c.fillStyle = 'rgba(174,150,110,.18)';
  for (let i=0;i<7000;i++) c.fillRect(random()*1080,random()*1350,1,1);
  function box(x,y,w,h,r,fill,stroke,line=2) {
    c.beginPath(); c.roundRect(x,y,w,h,r);
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}
  }
  function text(value,x,y,size,color,align='left',outline=0,max=850) {
    c.font = `${size}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    while(c.measureText(String(value)).width > max && size > 16) {
      size--; c.font = `${size}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    }
    c.textAlign=align;c.textBaseline='top';c.fillStyle=color;
    if(outline){c.strokeStyle=navy;c.lineWidth=outline*2;c.lineJoin='round';c.strokeText(value,x,y);}
    c.fillText(value,x,y);
  }
  box(33,33,1014,1284,21,null,navy,10);
  box(54,54,972,1242,17,null,'#5b6774',2);
  const scale=Math.max(904/art.width,650/art.height), sw=904/scale,sh=650/scale;
  c.drawImage(art,(art.width-sw)/2,(art.height-sh)/2,sw,sh,88,92,904,650);
  text(`LV. ${String(data.level||1).padStart(2,'0')}`,125,130,34,'#fffbee','left',3);
  text(p.label,125,183,40,'#fffbee','left',3);
  text(`@${data.username}`,940,617,24,'#fffbee','right',2,470);
  box(89,681,902,318,25,'#fffcf6',navy,3);
  text('THREADS ADVENTURER',126,723,21,p.color);
  text('戰鬥力',126,774,35,p.color);
  text(Number(data.battlePower||0).toFixed(2),952,772,58,p.color,'right');
  c.beginPath();c.moveTo(126,837);c.lineTo(954,837);c.strokeStyle='#d6cdbf';c.lineWidth=2;c.stroke();
  (data.dimensions||[]).slice(0,5).forEach((row,i)=>{
    const x=172+i*180, score=Math.max(0,Math.min(100,Number(row.score)||0));
    text(row.label,x,867,22,navy,'center');
    box(x-55,903,110,17,8,'#e8e0d2');
    if(score>0)box(x-55,903,110*score/100,17,Math.min(8,110*score/200),'#cf9641');
    text(String(Math.round(score)),x,941,25,navy,'center');
  });
  box(89,1031,902,191,25,p.pale,p.color,3);
  text(`${p.label}  ·  ${p.subtitle}`,126,1073,31,p.color);
  text(p.intro,126,1127,25,navy);
  text('每一種經營方式，都是一種厲害。',126,1177,23,muted);
  text(`公開樣本 ${data.source?.sampleCount||0} 篇  ·  THREADS`,954,1271,19,muted,'right');
}
