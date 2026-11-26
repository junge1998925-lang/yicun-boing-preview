// 会话控制器：当前关、历史、重开、求助可用性、提示、悔一步、存档。无 DOM。
import { parseLevel, createState, move, stateKey } from './rules.js';
import { solve } from './solver.js';
import { loadSave, writeSave, markSolved, setCurrent } from './save.js';

export const HINT_STEPS = 3;

export class Game {
  /**
   * @param {object[]} levelDefs levels.json 中的 levels 数组
   * @param {object} [opt] { storage, solveBudget }
   */
  constructor(levelDefs, { storage = null, solveBudget = 60000 } = {}) {
    this.defs = levelDefs;
    this.levels = levelDefs.map((d) => parseLevel(d));
    this.storage = storage;
    this.solveBudget = solveBudget;
    this.save = loadSave(storage, this.levels.length);
    this._solveCache = new Map();
    this.load(this.save.current);
  }

  get count() {
    return this.levels.length;
  }
  get def() {
    return this.defs[this.levelId - 1];
  }

  load(levelId) {
    if (levelId < 1 || levelId > this.count) return false;
    if (levelId > this.save.unlocked) return false;
    this.levelId = levelId;
    this.state = createState(this.levels[levelId - 1]);
    this.history = [];
    this.restarts = 0;
    this.hint = [];
    this.lastResult = null;
    this.save = setCurrent(this.save, levelId);
    writeSave(this.storage, this.save);
    return true;
  }

  restart() {
    this.state = createState(this.levels[this.levelId - 1]);
    this.history = [];
    this.restarts++;
    this.hint = [];
    this.lastResult = null;
  }

  next() {
    if (this.levelId < this.count) return this.load(this.levelId + 1);
    return false;
  }

  /** 玩家一步。返回 result。 */
  move(dir) {
    const { state, result, path } = move(this.state, dir);
    this.lastResult = result;
    if (result === 'illegal') return { result, path };
    this.history.push(this.state);
    this.state = state;
    if (this.hint.length) {
      this.hint = this.hint[0] === dir ? this.hint.slice(1) : [];
    }
    if (result === 'won') {
      this.lastWin = this.stepResult();
      this.save = markSolved(this.save, this.levelId, this.count, this.lastWin.atPar);
      writeSave(this.storage, this.save);
    }
    return { result, path };
  }

  /** 本关目标步数结果：{ par, moves, atPar }。par 来自 levels.json（按滑行规则由求解器算出）。 */
  stepResult() {
    const par = this.def.par;
    const moves = this.state.moves;
    return { par, moves, atPar: Number.isInteger(par) && moves <= par };
  }

  solveFrom(state) {
    const k = this.levelId + ':' + stateKey(state);
    if (!this._solveCache.has(k)) {
      if (this._solveCache.size > 2000) this._solveCache.clear();
      this._solveCache.set(k, solve(state, { budget: this.solveBudget }));
    }
    return this._solveCache.get(k);
  }

  /** 当前局面是否已被证明死局（困死或求解器证明无解）。 */
  isDead() {
    if (this.state.won) return false;
    if (this.state.stuck) return true;
    return this.solveFrom(this.state).status === 'unsolvable';
  }

  /** 求助可用：重开过、或困死、或已证明死局。开局不可用。 */
  helpAvailable() {
    if (this.state.won) return false;
    return this.restarts >= 1 || this.isDead();
  }

  canUndo() {
    return this.history.length > 0 && !this.state.won;
  }

  /** 奖励：悔一步。 */
  undo() {
    if (!this.canUndo()) return false;
    this.state = this.history.pop();
    this.hint = [];
    this.lastResult = null;
    return true;
  }

  /**
   * 奖励：提示。若当前死局，先回退到最近可解局面。
   * 返回 { steps, rewound }；steps 为空表示求解超预算（极少见）。
   */
  giveHint() {
    let rewound = 0;
    let r = this.solveFrom(this.state);
    while (r.status === 'unsolvable' && this.history.length) {
      this.state = this.history.pop();
      rewound++;
      r = this.solveFrom(this.state);
    }
    if (r.status !== 'solved') {
      // 预算不足或退到开局仍无解（关卡校验保证不会）：从头开始提示
      this.state = createState(this.levels[this.levelId - 1]);
      this.history = [];
      r = this.solveFrom(this.state);
    }
    this.hint = r.status === 'solved' ? r.path.slice(0, HINT_STEPS) : [];
    this.lastResult = null;
    return { steps: this.hint.slice(), rewound };
  }
}
