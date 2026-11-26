// 本地存档（SPEC 第 5 节）。storage 可注入，便于单测；任何异常都回落默认值。
export const SAVE_KEY = 'yicun-boing.save.v1';

// v1 存档字段：unlocked / current / solved；parSolved（以不超过 par 的步数通关过的关卡）为后加字段，
// 旧存档没有它时视为 []（都没打到 par），不影响其余进度。版本号保持 1，新旧代码可互读。
export function defaultSave() {
  return { v: 1, unlocked: 1, current: 1, solved: [], parSolved: [] };
}

function sanitize(raw, levelCount) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return d;
  const isLv = (n) => Number.isInteger(n) && n >= 1 && n <= levelCount;
  const unlocked = isLv(raw.unlocked) ? raw.unlocked : d.unlocked;
  const current = isLv(raw.current) && raw.current <= unlocked ? raw.current : Math.min(unlocked, d.current);
  const clean = (arr) => (Array.isArray(arr) ? [...new Set(arr.filter(isLv))].sort((a, b) => a - b) : []);
  const solved = clean(raw.solved);
  const parSolved = clean(raw.parSolved).filter((n) => solved.includes(n)); // 打到 par 必然已通关
  return { v: 1, unlocked, current, solved, parSolved };
}

export function loadSave(storage, levelCount) {
  try {
    const text = storage && storage.getItem(SAVE_KEY);
    if (!text) return defaultSave();
    return sanitize(JSON.parse(text), levelCount);
  } catch {
    return defaultSave();
  }
}

export function writeSave(storage, save) {
  try {
    storage && storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

const addSorted = (arr, n) => (arr.includes(n) ? arr.slice() : [...arr, n].sort((a, b) => a - b));

/** 过关后的新存档（不修改入参）。atPar：本次步数 ≤ par。一旦打到 par 就一直保留（之后超步数通关不会取消）。 */
export function markSolved(save, levelId, levelCount, atPar = false) {
  const solved = addSorted(save.solved, levelId);
  const prevPar = save.parSolved || [];
  const parSolved = atPar ? addSorted(prevPar, levelId) : prevPar.slice();
  const unlocked = Math.min(levelCount, Math.max(save.unlocked, levelId + 1));
  return { ...save, solved, parSolved, unlocked };
}

export function setCurrent(save, levelId) {
  if (levelId < 1 || levelId > save.unlocked) return save;
  return { ...save, current: levelId };
}
