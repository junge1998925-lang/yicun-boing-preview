// 一寸薄冰 · 规则层（纯函数，无 DOM）。规则见 docs/SPEC.md 第 2 节。

export const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const DIR_NAMES = Object.keys(DIRS);

const WIND = { '>': 'right', '<': 'left', '^': 'up', v: 'down' };
const KNOWN = new Set(['#', '~', '.', '=', 's', '>', '<', '^', 'v', '*', 'o', 'P', 'H']);
const MAX_W = 9;
const MAX_H = 11;

export function windDir(ch) {
  return WIND[ch] || null;
}

export function isLamp(ch) {
  return ch === '*' || ch === 'o';
}

/** 离开某格之后它变成什么。 */
export function afterLeave(ch) {
  if (ch === '.' || ch === '*') return '~';
  if (ch === '=') return '.';
  return ch;
}

/** 解析关卡定义 { map: string[] } → 不可变关卡描述。非法时抛错。 */
export function parseLevel(def) {
  const map = def && def.map;
  if (!Array.isArray(map) || map.length === 0) throw new Error('关卡缺少 map');
  const h = map.length;
  const w = map[0].length;
  if (w === 0) throw new Error('关卡宽度为 0');
  if (w > MAX_W || h > MAX_H) throw new Error(`关卡过大：${w}×${h}`);
  const cells = [];
  let start = -1;
  let home = -1;
  const lamps = [];
  for (let y = 0; y < h; y++) {
    const row = map[y];
    if (typeof row !== 'string' || row.length !== w) throw new Error(`第 ${y + 1} 行长度不一致`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (!KNOWN.has(ch)) throw new Error(`未知字符 "${ch}" 位于 (${x},${y})`);
      const i = y * w + x;
      if (ch === 'P') {
        if (start !== -1) throw new Error('起点 P 不止一个');
        start = i;
      } else if (ch === 'H') {
        if (home !== -1) throw new Error('家门 H 不止一个');
        home = i;
      } else if (isLamp(ch)) {
        lamps.push(i);
      }
      cells.push(ch);
    }
  }
  if (start === -1) throw new Error('缺少起点 P');
  if (home === -1) throw new Error('缺少家门 H');
  return Object.freeze({ w, h, cells: Object.freeze(cells), start, home, lamps: Object.freeze(lamps) });
}

/** 新建一局（重开也走这里）：与上一局不共享任何可变引用。 */
export function createState(level) {
  const lit = new Array(level.cells.length).fill(false);
  return {
    level,
    cells: level.cells.slice(),
    pos: level.start,
    lit,
    litCount: 0,
    moves: 0,
    won: false,
    stuck: false,
  };
}

export function cloneState(s) {
  return { ...s, cells: s.cells.slice(), lit: s.lit.slice() };
}

export function allLit(s) {
  return s.litCount === s.level.lamps.length;
}

function step(level, i, dir) {
  const [dx, dy] = DIRS[dir];
  const x = (i % level.w) + dx;
  const y = Math.floor(i / level.w) + dy;
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return -1;
  return y * level.w + x;
}

/** 目标格当前能否进入。 */
export function canEnter(s, i) {
  if (i < 0) return false;
  const ch = s.cells[i];
  if (ch === '#' || ch === '~') return false;
  if (ch === 'H') return allLit(s);
  return true;
}

function enter(s, i) {
  s.cells[s.pos] = afterLeave(s.cells[s.pos]);
  s.pos = i;
  const ch = s.cells[i];
  if (isLamp(ch) && !s.lit[i]) {
    s.lit[i] = true;
    s.litCount++;
  }
  if (ch === 'H') s.won = true;
}

export function hasLegalMove(s) {
  return DIR_NAMES.some((d) => canEnter(s, step(s.level, s.pos, d)));
}

/**
 * 一步移动。返回 { state, result, path }。
 * result: 'illegal' | 'moved' | 'won' | 'stuck'；path 为本步经过的格子（含推送链）。
 * 不修改入参 state。
 */
export function move(state, dir) {
  if (!DIRS[dir]) throw new Error(`未知方向 ${dir}`);
  if (state.won) return { state, result: 'illegal', path: [] };
  const target = step(state.level, state.pos, dir);
  if (!canEnter(state, target)) return { state, result: 'illegal', path: [] };
  const s = cloneState(state);
  enter(s, target);
  s.moves++;
  const path = [target];
  let guard = s.cells.length;
  while (!s.won) {
    const wd = windDir(s.cells[s.pos]);
    if (!wd) break;
    const next = step(s.level, s.pos, wd);
    if (!canEnter(s, next) || guard-- <= 0) break;
    enter(s, next);
    path.push(next);
  }
  s.stuck = !s.won && !hasLegalMove(s);
  return { state: s, result: s.won ? 'won' : s.stuck ? 'stuck' : 'moved', path };
}

/** 局面哈希：位置 + 格子 + 点灯。 */
export function stateKey(s) {
  let lit = '';
  for (const i of s.level.lamps) lit += s.lit[i] ? '1' : '0';
  return s.pos + '|' + s.cells.join('') + '|' + lit;
}

export function coordsOf(level, i) {
  return { x: i % level.w, y: Math.floor(i / level.w) };
}

/** 相邻格 → 方向（不相邻返回 null）。用于点击移动。 */
export function dirTo(level, from, to) {
  for (const d of DIR_NAMES) if (step(level, from, d) === to) return d;
  return null;
}
