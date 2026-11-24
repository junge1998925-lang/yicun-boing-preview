// DOM 胶水：输入、界面状态、求助流程。规则与会话逻辑在 game.js / rules.js。
import { Game } from './game.js';
import { Renderer } from './render.js';
import { SimulatedRewardedAd, requestReward } from './ads.js';
import { DIRS, dirTo, allLit } from './rules.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AD_MS = Math.max(200, Number(params.get('adms')) || 4000);
const STEP_MS = 90;

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
      else if (s.moves === 0) tip = game.def.aha.startsWith('【教学】') ? game.def.aha.replace('【教学】', '') : '薄冰只能踩一次。点相邻的格子或滑动来走。';
    }
    $('tip').textContent = tip;
    exposeDebug();
  }

  function hintCells() {
    const cells = [];
    let st = game.state;
    let pos = st.pos;
    const lv = st.level;
    for (const d of game.hint) {
      const [dx, dy] = DIRS[d];
      pos = pos + dx + dy * lv.w;
      cells.push(pos);
    }
    return cells;
  }

  function doMove(dir) {
    if (anim || !$('ad-overlay').hidden || !$('help-panel').hidden) return;
    const from = game.state.pos;
    const { result, path } = game.move(dir);
    message = '';
    if (result === 'illegal') {
      renderer.bump();
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      return;
    }
    anim = { cells: [from, ...path], start: performance.now() };
    scheduleDeadCheck();
    updateUI();
  }

  function restart() {
    pendingDead = false;
    game.restart();
    anim = null;
    message = '';
    deadKnown = false;
    updateUI();
  }

  function loadLevel(n) {
    if (!game.load(n)) return false;
    pendingDead = false;
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
          ? (rewound ? `已退回 ${rewound} 步到还能回家的地方。` : '') + '按数字顺序走。'
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
  document.querySelectorAll('.pad button').forEach((b) => b.addEventListener('click', () => doMove(b.dataset.dir)));

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
    down = null;
    if (Math.hypot(dx, dy) >= 24) {
      doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      return;
    }
    const lv = game.state.level;
    const i = renderer.cellAt(lv, e.clientX, e.clientY);
    if (i < 0) return;
    const d = dirTo(lv, game.state.pos, i);
    if (d) doMove(d);
    else if (i !== game.state.pos) {
      // 点了远处：朝主方向走一步，方便新手
      const p = game.state.pos;
      const ddx = (i % lv.w) - (p % lv.w);
      const ddy = Math.floor(i / lv.w) - Math.floor(p / lv.w);
      doMove(Math.abs(ddx) >= Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : ddy > 0 ? 'down' : 'up');
    }
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

  // —— 主循环 ——
  function frame(t) {
    let playerPx = null;
    if (anim) {
      const cell = renderer.cell;
      const lv = game.state.level;
      const k = (t - anim.start) / STEP_MS;
      const seg = Math.floor(k);
      if (seg >= anim.cells.length - 1) {
        anim = null;
        exposeDebug();
      } else {
        const a = anim.cells[seg];
        const b = anim.cells[seg + 1];
        const f = k - seg;
        const ease = f * f * (3 - 2 * f);
        const ax = (a % lv.w) * cell, ay = Math.floor(a / lv.w) * cell;
        const bx = (b % lv.w) * cell, by = Math.floor(b / lv.w) * cell;
        playerPx = { x: ax + (bx - ax) * ease, y: ay + (by - ay) * ease };
      }
    }
    renderer.draw(game.state, { t, hintCells: anim ? [] : hintCells(), dim: game.state.stuck, playerPx });
    requestAnimationFrame(frame);
  }

  layout();
  updateUI();
  requestAnimationFrame(frame);
}

boot();
