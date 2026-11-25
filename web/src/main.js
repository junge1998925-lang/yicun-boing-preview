// DOM 胶水：输入、界面状态、求助流程。规则与会话逻辑在 game.js / rules.js。
import { Game } from './game.js';
import { Renderer } from './render.js';
import { SimulatedRewardedAd, requestReward } from './ads.js';
import { allLit, move as slide, afterLeave, isLamp } from './rules.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AD_MS = Math.max(200, Number(params.get('adms')) || 4000);
const CELL_MS = 55; // 滑行动画：每格耗时
const SWIPE_PX = 18; // 轻扫判定阈值

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
    if (game.restarts >= 1 || game.state.stuck) return true;
    return deadKnown;
  }

  function scheduleDeadCheck() {
    deadKnown = false;
    if (game.state.won || game.state.stuck || game.restarts >= 1) return;
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
      $('btn-next').hidden = last;
      $('btn-banner-restart').hidden = true;
    } else if (s.stuck) {
      banner.hidden = false;
      $('banner-text').textContent = '这局走不通了';
      $('btn-next').hidden = true;
      $('btn-banner-restart').hidden = false;
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
    exposeDebug();
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
  function doMove(dir) {
    if (!$('ad-overlay').hidden || !$('help-panel').hidden || !$('levels-panel').hidden) return;
    if (anim) { queued = dir; return; }
    const from = game.state.pos;
    const prev = game.state;
    const { result, path } = game.move(dir);
    message = '';
    if (result === 'illegal') {
      renderer.bump();
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      return;
    }
    anim = { cells: [from, ...path], prev, start: performance.now(), ms: Math.min(900, 90 + CELL_MS * path.length) };
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
    $('help-panel').hidden = false;
  }
  async function reward(kind) {
    $('help-panel').hidden = true;
    const ok = await requestReward(ad, () => {
      if (kind === 'hint') {
        const { steps, rewound } = game.giveHint();
        message = steps.length
          ? (rewound ? `已退回 ${rewound} 步到还能回家的地方。` : '') + '按数字顺序滑（数字是每次滑行停下的位置）。'
          : '这关有点绕，先重开试试。';
      } else {
        game.undo();
        message = '已悔一步。';
      }
      deadKnown = false;
      anim = null;
      scheduleDeadCheck();
    });
    if (!ok) message = '广告没看完，没有获得奖励。';
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
      if (game.save.solved.includes(i)) b.classList.add('solved');
      if (i === game.levelId) b.classList.add('current');
      b.title = i > game.save.unlocked ? '未解锁' : defs[i - 1].name;
      b.addEventListener('click', () => { $('levels-panel').hidden = true; loadLevel(i); });
      grid.appendChild(b);
    }
    $('levels-panel').hidden = false;
  }

  // —— 输入 ——
  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.key]) { e.preventDefault(); doMove(KEYMAP[e.key]); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'Enter' && game.state.won && game.levelId < game.count) loadLevel(game.levelId + 1);
  });
  // 屏幕方向键：按下即滑（触摸手势后浏览器可能不合成 click，不能依赖 click）。
  // click 只处理键盘激活（Tab 聚焦后按空格/回车，detail === 0），避免与 pointerdown 重复。
  document.querySelectorAll('.pad button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      doMove(b.dataset.dir);
    });
    b.addEventListener('click', (e) => { if (e.detail === 0) doMove(b.dataset.dir); });
  });

  const canvas = $('board');
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const fired = down.fired;
    down = null;
    if (fired) return;
    if (Math.hypot(dx, dy) >= SWIPE_PX) {
      doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }
    // 轻点：按点击位置相对玩家的主方向，发起同一套整段滑行（不是走一格）
    const lv = game.state.level;
    const i = renderer.cellAt(lv, e.clientX, e.clientY);
    if (i < 0 || i === game.state.pos) return;
    const p = game.state.pos;
    const ddx = (i % lv.w) - (p % lv.w);
    const ddy = Math.floor(i / lv.w) - Math.floor(p / lv.w);
    doMove(Math.abs(ddx) >= Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : ddy > 0 ? 'down' : 'up');
  });
  // 拖动中途一旦超过阈值就立即出发，手感更跟手
  canvas.addEventListener('pointermove', (e) => {
    if (!down || down.fired) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) < SWIPE_PX * 1.6) return;
    down.fired = true;
    doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

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
  window.addEventListener('resize', layout);

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
      hint: game.hint.slice(),
      helpEnabled: !$('btn-help').disabled,
      save: { ...game.save, solved: game.save.solved.slice() },
      get animating() { return !!anim; },
      par: game.def.par,
      solution: () => game.solveFrom(game.state).path || null,
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
        anim = null;
        if (n > 1) renderer.bump(0.35); // 撞停的轻微震动
        exposeDebug();
        if (queued) { const q = queued; queued = null; doMove(q); }
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
    renderer.draw(view, { t, hintCells: anim ? [] : hintCells(), dim: !anim && game.state.stuck, playerPx });
    requestAnimationFrame(frame);
  }

  layout();
  updateUI();
  requestAnimationFrame(frame);
}

boot();
