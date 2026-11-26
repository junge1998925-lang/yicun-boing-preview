// 轻扫判定与反馈计算（纯函数，无 DOM）。移动只有轻扫一种方式，见 docs/SPEC.md 第 3 节。
import { move, DIRS, windDir } from './rules.js';

export const SWIPE_PX = 18; // 松手时位移 ≥ 该值才算一次轻扫；拖动中 ≥ 该值时显示落点预览

/** 位移 → 方向；位移不足阈值（轻点）返回 null。取位移较大的轴。 */
export function swipeDir(dx, dy, threshold = SWIPE_PX) {
  if (Math.hypot(dx, dy) < threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * 轻扫落点预览：按当前拖动位移，算出松手后这次滑行会经过哪些格、停在哪。
 * 直接调用规则层 move()（纯函数，不改状态），不另造移动规则。
 * 返回 null（位移不足 / 已胜利）或 { dir, legal, path, end, won, stuck }。
 * legal=false 表示第一格就进不去：end 为被挡住的那一格（越界时为 -1）。
 */
export function previewSwipe(state, dx, dy) {
  if (state.won) return null;
  const dir = swipeDir(dx, dy);
  if (!dir) return null;
  const r = move(state, dir);
  if (r.result === 'illegal') {
    return { dir, legal: false, path: [], end: neighbor(state.level, state.pos, dir), won: false, stuck: false };
  }
  return { dir, legal: true, path: r.path, end: r.state.pos, won: r.result === 'won', stuck: r.result === 'stuck' };
}

function neighbor(level, i, dir) {
  const [dx, dy] = DIRS[dir];
  const x = (i % level.w) + dx;
  const y = Math.floor(i / level.w) + dy;
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return -1;
  return y * level.w + x;
}

/**
 * 撞停信息：一段滑行停下时，是被哪一格、朝哪个方向挡住的（用于撞停反馈）。
 * @param state 滑行结束后的局面
 * @param cells [起点, ...path]
 * 最终方向 = 最后一段的方向；若停在风冰上，则为风冰箭头方向（被箭头前方挡住）。
 * 返回 null（胜利，没有撞停）或 { dir, cell, kind }，kind ∈ wall | hole | door | edge。
 */
export function impactOf(state, cells) {
  if (state.won || cells.length < 2) return null;
  const end = cells[cells.length - 1];
  let dir = windDir(state.cells[end]);
  if (!dir) {
    const prev = cells[cells.length - 2];
    const d = end - prev;
    const w = state.level.w;
    dir = d === 1 ? 'right' : d === -1 ? 'left' : d === w ? 'down' : 'up';
  }
  const cell = neighbor(state.level, end, dir);
  const kind = cell < 0 ? 'edge' : state.cells[cell] === '#' ? 'wall' : state.cells[cell] === '~' ? 'hole' : state.cells[cell] === 'H' ? 'door' : 'wall';
  return { dir, cell, kind };
}
