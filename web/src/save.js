// 本地存档（SPEC 第 5 节）。storage 可注入，便于单测；任何异常都回落默认值。
export const SAVE_KEY = 'yicun-boing.save.v1';

export function defaultSave() {
  return { v: 1, unlocked: 1, current: 1, solved: [] };
}

function sanitize(raw, levelCount) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return d;
  const isLv = (n) => Number.isInteger(n) && n >= 1 && n <= levelCount;
  const unlocked = isLv(raw.unlocked) ? raw.unlocked : d.unlocked;
  const current = isLv(raw.current) && raw.current <= unlocked ? raw.current : Math.min(unlocked, d.current);
  const solved = Array.isArray(raw.solved) ? [...new Set(raw.solved.filter(isLv))].sort((a, b) => a - b) : [];
  return { v: 1, unlocked, current, solved };
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

/** 过关后的新存档（不修改入参）。 */
export function markSolved(save, levelId, levelCount) {
  const solved = save.solved.includes(levelId) ? save.solved.slice() : [...save.solved, levelId].sort((a, b) => a - b);
  const unlocked = Math.min(levelCount, Math.max(save.unlocked, levelId + 1));
  return { ...save, solved, unlocked };
}

export function setCurrent(save, levelId) {
  if (levelId < 1 || levelId > save.unlocked) return save;
  return { ...save, current: levelId };
}
