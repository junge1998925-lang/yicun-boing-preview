// 会话控制器：当前关、历史、重开、求助可用性、提示、悔一步、存档。无 DOM。
import { parseLevel, createState, move, stateKey } from './rules.js';
import { solve } from './solver.js';
import { loadSave, writeSave, markSolved, setCurrent, markTutorialDone } from './save.js';

/** 显示轻扫引导的关卡（教学关 1、2 与第一道思考题 3）。 */
export const GUIDE_LEVELS = [1, 2, 3];

/** 看广告换来的提示：画出接下来 3 次滑行的落点。 */
export const HINT_STEPS = 3;
/** 本关求助常亮后免费的提示：每次只画接下来 1 次滑行的落点（P13）。 */
export const FREE_HINT_STEPS = 1;
/** 落点预览用红色标出「这一下会困死」的最后一关（P13）：之后只显示落点，不剧透。 */
export const STUCK_PREVIEW_MAX_LEVEL = 5;

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
    this.helpUnlocked = false; // 换关：按原规则重新计算
    this.hintUsed = false; // 本次进关后是否用过提示（重开不清零，换关清零）
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
    // 第一次有效轻扫（真的滑出去了）：轻扫引导永久关闭
    if (!this.save.tutorialDone) {
      this.save = markTutorialDone(this.save);
      writeSave(this.storage, this.save);
    }
    this.history.push(this.state);
    this.state = state;
    if (this.hint.length) {
      this.hint = this.hint[0] === dir ? this.hint.slice(1) : [];
    }
    if (result === 'won') {
      this.lastWin = this.stepResult();
      this.save = markSolved(this.save, this.levelId, this.count, this.lastWin.atPar, !this.hintUsed);
      writeSave(this.storage, this.save);
    }
    return { result, path };
  }

  /** 是否显示轻扫引导：前 3 关、还没有过一次有效轻扫、本局未结束。 */
  showGuide() {
    return !this.save.tutorialDone && GUIDE_LEVELS.includes(this.levelId) && !this.state.won && !this.state.stuck;
  }

  /** 引导演示的方向：本关解法的第一步（保证是一条合理、不会走死的方向）；求不出时取第一个合法方向。 */
  guideDir() {
    const r = this.solveFrom(this.state);
    if (r.status === 'solved' && r.path.length) return r.path[0];
    return ['right', 'down', 'left', 'up'].find((d) => move(this.state, d).result !== 'illegal') || 'right';
  }

  /** 落点预览是否标出「这一下会困死」：只在前几关（教学期）标红。 */
  revealStuckInPreview() {
    return this.levelId <= STUCK_PREVIEW_MAX_LEVEL;
  }

  /** 下一次「看提示」会给几步：本关已看过广告（常亮）则 1 步，否则（要看广告）3 步。 */
  nextHintSteps() {
    return this.helpUnlocked ? FREE_HINT_STEPS : HINT_STEPS;
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

  /**
   * 求助可用：本关已看过一次完整广告（常亮）、或重开过、或困死、或已证明死局。开局不可用。
   * 看过一次后本关剩下的时间里一直可用，重开也保留；换关（load）后清零。
   */
  helpAvailable() {
    if (this.state.won) return false;
    return this.helpUnlocked || this.restarts >= 1 || this.isDead();
  }

  /** 本关看完一次激励视频后调用：本关剩下的时间里求助常亮，之后的提示 / 悔一步不再需要看广告。 */
  unlockHelp() {
    this.helpUnlocked = true;
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
   * n：画出接下来几次滑行（看广告 = HINT_STEPS，常亮后免费 = FREE_HINT_STEPS）。
   * 返回 { steps, rewound }；steps 为空表示求解超预算（极少见）。
   */
  giveHint(n = HINT_STEPS) {
    this.hintUsed = true;
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
    this.hint = r.status === 'solved' ? r.path.slice(0, n) : [];
    this.lastResult = null;
    return { steps: this.hint.slice(), rewound };
  }
}
