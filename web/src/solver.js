// BFS 求解器：用于关卡校验、死局判定与提示。
import { DIR_NAMES, move, stateKey } from './rules.js';

/**
 * 安全剪枝：把所有非墙、非窟窿的格子视为可通行做洪水填充（真实可达集合的超集）。
 * 若有未点亮的灯或家门不在其中，则必然无解。
 */
export function obviouslyDead(s) {
  const { w, h } = s.level;
  const cells = s.cells;
  const seen = new Uint8Array(cells.length);
  const stack = [s.pos];
  seen[s.pos] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    const ns = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of ns) {
      if (n < 0 || seen[n]) continue;
      const ch = cells[n];
      if (ch === '#' || ch === '~') continue;
      seen[n] = 1;
      if (ch !== 'H') stack.push(n); // 家门是终点，不经过
    }
  }
  if (!seen[s.level.home]) return true;
  for (const i of s.level.lamps) if (!s.lit[i] && !seen[i]) return true;
  return false;
}

/**
 * 从 state 出发求最短解。
 * 返回 { status: 'solved', path: dir[] } | { status: 'unsolvable' } | { status: 'unknown' }（超出预算）。
 */
export function solve(state, { budget = 200000 } = {}) {
  if (state.won) return { status: 'solved', path: [] };
  if (obviouslyDead(state)) return { status: 'unsolvable' };
  const seen = new Set([stateKey(state)]);
  // 用父指针重建路径，省内存
  const nodes = [{ s: state, parent: -1, dir: null }];
  let head = 0;
  while (head < nodes.length) {
    if (nodes.length > budget) return { status: 'unknown' };
    const cur = nodes[head];
    const curIdx = head++;
    for (const d of DIR_NAMES) {
      const { state: ns, result } = move(cur.s, d);
      if (result === 'illegal') continue;
      if (result === 'won') {
        const path = [d];
        for (let n = curIdx; n > 0; n = nodes[n].parent) path.push(nodes[n].dir);
        return { status: 'solved', path: path.reverse() };
      }
      if (result === 'stuck') continue;
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      if (obviouslyDead(ns)) continue;
      nodes.push({ s: ns, parent: curIdx, dir: d });
    }
    cur.s = curIdx === 0 ? cur.s : null; // 释放已展开节点
  }
  return { status: 'unsolvable' };
}

/** 统计所有不同的最短解数量上限（用于关卡分析工具），超过 cap 停止。 */
export function countSolutions(state, { cap = 50, maxDepth = 80, maxNodes = 300000 } = {}) {
  let count = 0;
  let nodes = 0;
  const seen = new Set();
  function dfs(s, depth) {
    if (count >= cap || depth > maxDepth || ++nodes > maxNodes) return;
    for (const d of DIR_NAMES) {
      const { state: ns, result } = move(s, d);
      if (result === 'illegal' || result === 'stuck') continue;
      if (result === 'won') { count++; continue; }
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      dfs(ns, depth + 1);
      seen.delete(k);
    }
  }
  dfs(state, 0);
  return count;
}
