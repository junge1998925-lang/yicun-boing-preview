// DOM 胶水：输入、界面状态、求助流程。规则与会话逻辑在 game.js / rules.js。
import { Game } from './game.js';
import { Renderer } from './render.js';
import { SimulatedRewardedAd, requestReward } from './ads.js';
import { allLit, move as slide, afterLeave, isLamp } from './rules.js';
import { swipeDir, previewSwipe, impactOf } from './input.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AD_MS = Math.max(200, Number(params.get('adms')) || 4000);
const CELL_MS = 55; // 滑行动画：每格耗时
const IMPACT_PAUSE_MS = 70; // 撞停后的短暂停顿（缓存的下一次轻扫在停顿后执行）

function storage() {
  try {
    const k = '__yicun_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

async function boot() {
  let defs;
  try {
    const res = await fetch('../levels/levels.json', { cache: 'no-store' });
    defs = (await res.json()).levels;
  } catch (e) {
    $('tip').textContent = '关卡加载失败，请用 npm start 启动后再打开。';
    throw e;
  }
  const game = new Game(defs, { storage: storage() });
  const renderer = new Renderer($('board'));
  const ad = new SimulatedRewardedAd({
    durationMs: AD_MS,
    ui: {
      open: (sec) => { $('ad-count').textContent = String(sec); $('ad-overlay').hidden = false; },
      tick: (sec) => { $('ad-count').textContent = String(sec); },
      close: () => { $('ad-overlay').hidden = true; },
    },
  });

  // 移动动画：沿 path 逐格插值
  let anim = null; // { cells:[...], from, start }
  let pendingDead = false; // 死局检测是否已计算
  let deadKnown = false;
  let message = '';

  function layout() {
    const wrap = $('board-wrap');
    renderer.resize(game.state.level, wrap.clientWidth, wrap.clientHeight);
  }

  function helpReady() {
    if (game.state.won) return false;
    if (game.helpUnlocked || game.restarts >= 1 || game.state.stuck) return true;
    return deadKnown;
  }

  function scheduleDeadCheck() {
    deadKnown = false;
    if (game.state.won || game.state.stuck || game.restarts >= 1 || game.helpUnlocked) return;
    pendingDead = true;
    // 求解放到空闲时，不阻塞输入
    setTimeout(() => {
      if (!pendingDead) return;
      pendingDead = false;
      deadKnown = game.isDead();
      if (deadKnown) message = '这条路已经回不了家了。可以重开，或者求助。';
      updateUI();
    }, 120);
  }

  function updateUI() {
    const s = game.state;
    const lv = s.level;
    $('level-label').textContent = `第 ${game.levelId} 关 · ${game.def.name}`;
    $('lamp-label').textContent = `灯 ${s.litCount}/${lv.lamps.length}`;
    const help = $('btn-help');
    const ready = helpReady();
    help.disabled = !ready;
    help.title = ready ? '看一段模拟广告换取提示或悔一步' : '重开一次后可求助';
    help.classList.toggle('pulse', ready && (s.stuck || deadKnown));
    $('btn-restart').classList.toggle('pulse', s.stuck || deadKnown);
    const banner = $('banner');
    if (s.won) {
      banner.hidden = false;
      const last = game.levelId === game.count;
      $('banner-text').textContent = last ? '到家了。窗里的灯，一直为你亮着。' : '到家了！';
      const r = game.stepResult();
      const steps = $('banner-steps');
      steps.hidden = false;
      steps.textContent = `本关最少 ${r.par} 步，你用了 ${r.moves} 步` + (r.atPar ? '。漂亮！' : '');
      steps.classList.toggle('over', !r.atPar);
      $('btn-next').hidden = last;
      // 没打到最少步数时给一个「再试一次」，方便回头挑战
      $('btn-banner-restart').hidden = r.atPar;
      $('btn-banner-restart').textContent = '再试一次';
    } else if (s.stuck) {
      banner.hidden = false;
      $('banner-text').textContent = '这局走不通了';
      $('banner-steps').hidden = true;
      $('btn-next').hidden = true;
      $('btn-banner-restart').hidden = false;
      $('btn-banner-restart').textContent = '重开';
    } else {
      banner.hidden = true;
    }
    let tip = message;
    if (!tip) {
      if (game.hint.length) tip = '提示：按数字顺序走。';
      else if (s.stuck) tip = '无路可走。重开，或者点「求助」。';
      else if (allLit(s) && lv.lamps.length) tip = '灯都亮了，回家吧。';
      else if (s.moves === 0) tip = game.def.aha.startsWith('【教学】') ? game.def.aha.replace('【教学】', '') : '轻扫冰面：人会一路滑到撞上阻挡才停。薄冰只能踩一次。';
    }
    $('tip').textContent = tip;
    updateGuide();
    exposeDebug();
  }

  // —— 轻扫引导（前 3 关，第一次有效轻扫后永久消失；纯展示，不是方向键） ——
  let guideDir = null;
  function updateGuide() {
    const el = $('swipe-guide');
    // 正在按住拖动（看落点预览）或滑行动画中时先藏起来，免得挡视线；条件满足时再出现
    const show = game.showGuide() && !anim && !down;
    el.hidden = !show;
    if (!show) return;
    guideDir = game.guideDir();
    const lv = game.state.level;
    const cvs = $('board');
    const cell = renderer.cell;
    const track = el.querySelector('.guide-track');
    track.dataset.guide = guideDir;
    track.style.left = cvs.offsetLeft + ((game.state.pos % lv.w) + 0.5) * cell + 'px';
    track.style.top = cvs.offsetTop + (Math.floor(game.state.pos / lv.w) + 0.5) * cell + 'px';
    track.style.setProperty('--len', Math.round(Math.max(60, Math.min(cell * 1.8, 120))) + 'px');
  }

  /** 提示：每次滑行的落点（按顺序）。 */
  function hintCells() {
    const cells = [];
    let st = game.state;
    for (const d of game.hint) {
      const r = slide(st, d);
      if (r.result === 'illegal') break;
      st = r.state;
      cells.push(st.pos);
    }
    return cells;
  }

  let queued = null; // 动画中缓存 1 次输入
  let preview = null; // 拖动中的落点预览（input.previewSwipe 的结果）
  let lastImpact = null; // 最近一次撞停 / 非法顶墙（供 e2e 断言）
  const dirVec = (d) => ({ up: [0, -40], down: [0, 40], left: [-40, 0], right: [40, 0] })[d];
  const vibrate = (ms) => { if (navigator.vibrate) try { navigator.vibrate(ms); } catch {} };
  function doMove(dir) {
    if (!$('ad-overlay').hidden || !$('help-panel').hidden || !$('levels-panel').hidden) return;
    if (anim) { queued = dir; return; }
    const from = game.state.pos;
    const prev = game.state;
    const { result, path } = game.move(dir);
    message = '';
    if (result === 'illegal') {
      // 第一格就进不去：朝该方向顶一下再弹回，并把挡住的那格描红一下
      const pv = previewSwipe(prev, ...dirVec(dir));
      lastImpact = { dir, cell: pv ? pv.end : -1, kind: 'blocked', illegal: true, at: performance.now() };
      renderer.impact(dir, lastImpact.cell, { strength: 1, illegal: true });
      vibrate(20);
      exposeDebug();
      return;
    }
    anim = { cells: [from, ...path], prev, start: performance.now(), ms: Math.min(900, 90 + CELL_MS * path.length) };
    updateGuide(); // 有效轻扫：game.move 已记下 tutorialDone，引导立即消失
    scheduleDeadCheck();
    updateUI();
  }

  function restart() {
    pendingDead = false;
    queued = null;
    game.restart();
    anim = null;
    message = '';
    deadKnown = false;
    updateUI();
  }

  function loadLevel(n) {
    if (!game.load(n)) return false;
    pendingDead = false;
    queued = null;
    deadKnown = false;
    anim = null;
    message = '';
    layout();
    updateUI();
    return true;
  }

  // —— 求助 ——
  function openHelp() {
    if (!helpReady()) return;
    $('btn-undo').disabled = !game.canUndo();
    // 本关看过一次广告后：直接给，不再看广告
    $('help-note').textContent = game.helpUnlocked ? '本关已看过广告，提示和悔一步可以直接用。' : '看一段短广告（模拟），播完后本关的提示和悔一步都可以直接用。';
    const n = game.nextHintSteps();
    $('btn-hint').textContent = game.helpUnlocked ? `看提示（下 ${n} 步）` : `看广告 · 看提示（接下来 ${n} 步）`;
    $('btn-undo').textContent = game.helpUnlocked ? '悔一步' : '看广告 · 悔一步';
    $('help-panel').hidden = false;
  }
  async function reward(kind) {
    $('help-panel').hidden = true;
    const grant = () => {
      const n = game.nextHintSteps(); // 先取步数：看广告这次给 3 步，之后常亮免费的每次 1 步
      game.unlockHelp();
      if (kind === 'hint') {
        const { steps, rewound } = game.giveHint(n);
        message = steps.length
          ? (rewound ? `已退回 ${rewound} 步到还能回家的地方。` : '') + (steps.length > 1 ? '按数字顺序滑（数字是每次滑行停下的位置）。' : '朝数字 1 那格滑一次。')
          : '这关有点绕，先重开试试。';
      } else {
        game.undo();
        message = '已悔一步。';
      }
      deadKnown = false;
      anim = null;
      scheduleDeadCheck();
    };
    if (game.helpUnlocked) {
      grant();
    } else {
      const ok = await requestReward(ad, grant);
      if (!ok) message = '广告没看完，没有获得奖励。';
    }
    updateUI();
  }

  // —— 选关 ——
  function openLevels() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= game.count; i++) {
      const b = document.createElement('button');
      b.textContent = String(i);
      b.dataset.level = String(i);
      b.disabled = i > game.save.unlocked;
      const atPar = game.save.parSolved.includes(i);
      const noHint = game.save.noHintSolved.includes(i);
      if (atPar) b.classList.add('par');
      else if (game.save.solved.includes(i)) b.classList.add('solved');
      if (noHint) b.classList.add('nohint');
      // 两个角标并列：右上「最少」、左上「独立」（没用提示通关）
      if (atPar) {
        const badge = document.createElement('span');
        badge.className = 'par-badge';
        badge.textContent = '最少';
        b.appendChild(badge);
      }
      if (noHint) {
        const badge = document.createElement('span');
        badge.className = 'nohint-badge';
        badge.textContent = '独立';
        b.appendChild(badge);
      }
      if (i === game.levelId) b.classList.add('current');
      const marks = [atPar && '已以最少步数通关', noHint && '没用提示通关'].filter(Boolean);
      b.title = i > game.save.unlocked ? '未解锁' : `${defs[i - 1].name}` + (marks.length ? `（${marks.join('，')}）` : game.save.solved.includes(i) ? '（已通关）' : '');
      b.addEventListener('click', () => { $('levels-panel').hidden = true; loadLevel(i); });
      grid.appendChild(b);
    }
    $('levels-panel').hidden = false;
  }

  // —— 输入 ——
  // 移动只有一种方式：在画布上轻扫（鼠标拖拽 / 触摸）。没有方向键、没有 WASD、没有「轻点某侧滑行」。
  // 键盘只保留与移动无关的快捷键：R 重开，过关后 Enter 进下一关。
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'Enter' && game.state.won && game.levelId < game.count) loadLevel(game.levelId + 1);
  });

  // 轻扫区域 = 整个游戏区（画布及其四周空白），手机上不必精确按在小画布上
  const canvas = $('board-wrap');
  let down = null;
  // 按下 → 拖动时预览落点（随手指方向实时更新，拖回原点即取消）→ 松手才真正滑行。
  // 预览只是反馈：不移动、不计步。轻点（位移不足阈值）什么都不做。
  const busy = () => !$('ad-overlay').hidden || !$('help-panel').hidden || !$('levels-panel').hidden;
  function setPreview(p) {
    const same = (a, b) => (a && b ? a.dir === b.dir && a.end === b.end && a.legal === b.legal : a === b);
    if (same(preview, p)) return;
    preview = p;
    exposeDebug();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // 过关/困死横幅上的按钮照常点击
    down = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    updateGuide();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    // 动画中不预览（局面还在变）；松手时的输入会照常排队
    setPreview(anim || busy() ? null : previewSwipe(game.state, e.clientX - down.x, e.clientY - down.y, { revealStuck: game.revealStuckInPreview() }));
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dir = swipeDir(e.clientX - down.x, e.clientY - down.y);
    down = null;
    setPreview(null);
    if (dir) doMove(dir);
    updateGuide(); // 轻点、拖回取消、撞墙（非法）都不算学会：引导回来；有效轻扫则已永久关闭
  });
  canvas.addEventListener('pointercancel', () => { down = null; setPreview(null); updateGuide(); });

  $('btn-restart').addEventListener('click', restart);
  $('btn-banner-restart').addEventListener('click', restart);
  $('btn-next').addEventListener('click', () => loadLevel(game.levelId + 1));
  $('btn-help').addEventListener('click', openHelp);
  $('btn-help-cancel').addEventListener('click', () => { $('help-panel').hidden = true; });
  $('btn-hint').addEventListener('click', () => reward('hint'));
  $('btn-undo').addEventListener('click', () => reward('undo'));
  $('btn-ad-close').addEventListener('click', () => ad.abort());
  $('btn-levels').addEventListener('click', openLevels);
  $('btn-levels-close').addEventListener('click', () => { $('levels-panel').hidden = true; });
  window.addEventListener('resize', () => { layout(); updateGuide(); });

  // —— 调试钩子（e2e 用，只读快照 + 有限操作） ——
  function exposeDebug() {
    const s = game.state;
    window.__yicun = {
      // 快照字段在每次界面更新时刷新；animating 为实时 getter
      ready: true,
      levelId: game.levelId,
      count: game.count,
      pos: s.pos,
      moves: s.moves,
      won: s.won,
      stuck: s.stuck,
      litCount: s.litCount,
      cells: s.cells.join(''),
      w: s.level.w,
      restarts: game.restarts,
      helpUnlocked: game.helpUnlocked,
      hintUsed: game.hintUsed,
      revealStuck: game.revealStuckInPreview(),
      hint: game.hint.slice(),
      helpEnabled: !$('btn-help').disabled,
      save: JSON.parse(JSON.stringify(game.save)),
      get animating() { return !!anim; },
      par: game.def.par,
      solution: () => game.solveFrom(game.state).path || null,
      guide: !$('swipe-guide').hidden,
      guideDir: $('swipe-guide').hidden ? null : guideDir,
      preview: preview ? { dir: preview.dir, legal: preview.legal, end: preview.end, path: preview.path.slice(), won: preview.won, stuck: preview.stuck } : null,
      lastImpact: lastImpact ? { dir: lastImpact.dir, cell: lastImpact.cell, kind: lastImpact.kind, illegal: lastImpact.illegal, at: lastImpact.at } : null,
      loadLevel,
    };
  }

  /** 动画中的显示局面：从滑行前的局面按规则重放到第 seg 格（已离开的格子碎、已到达的灯亮）。 */
  function displayState(seg) {
    const prev = anim.prev;
    const cells = prev.cells.slice();
    const lit = prev.lit.slice();
    let litCount = prev.litCount;
    for (let j = 1; j <= seg; j++) {
      const from = anim.cells[j - 1];
      const to = anim.cells[j];
      cells[from] = afterLeave(cells[from]);
      if (isLamp(cells[to]) && !lit[to]) { lit[to] = true; litCount++; }
    }
    return { ...game.state, cells, lit, litCount, won: false, stuck: false };
  }

  // —— 主循环 ——
  function frame(t) {
    let playerPx = null;
    let view = game.state;
    if (anim) {
      const cell = renderer.cell;
      const lv = game.state.level;
      const n = anim.cells.length - 1;
      const f = Math.min(1, (t - anim.start) / anim.ms);
      if (f >= 1) {
        const cells = anim.cells;
        anim = null;
        // 撞停反馈：朝被挡方向挤一下再弹回 + 挡住的那格闪一下 + 短暂停顿（停顿期间缓存的下一次轻扫稍后执行）
        const hit = impactOf(game.state, cells);
        if (hit) {
          lastImpact = { ...hit, illegal: false, at: t };
          renderer.impact(hit.dir, hit.cell, { strength: Math.min(1, 0.45 + n * 0.08) });
          vibrate(12);
        }
        updateGuide();
        exposeDebug();
        if (queued) {
          const q = queued;
          queued = null;
          if (hit) setTimeout(() => doMove(q), IMPACT_PAUSE_MS);
          else doMove(q);
        }
      } else {
        // 整段一次缓动：起步快、到头减速（ease-out），像在冰上滑
        const e = 1 - Math.pow(1 - f, 2.2);
        const k = e * n;
        const seg = Math.min(n - 1, Math.floor(k));
        const a = anim.cells[seg];
        const b = anim.cells[seg + 1];
        const g = k - seg;
        const ax = (a % lv.w) * cell, ay = Math.floor(a / lv.w) * cell;
        const bx = (b % lv.w) * cell, by = Math.floor(b / lv.w) * cell;
        playerPx = { x: ax + (bx - ax) * g, y: ay + (by - ay) * g };
        view = displayState(Math.round(k));
      }
    }
    renderer.draw(view, { t, hintCells: anim || preview ? [] : hintCells(), dim: !anim && game.state.stuck, playerPx, preview: anim ? null : preview });
    requestAnimationFrame(frame);
  }

  layout();
  updateUI();
  requestAnimationFrame(frame);
}

boot();
