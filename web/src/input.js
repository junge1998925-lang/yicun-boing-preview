// 轻扫判定（纯函数，无 DOM）。移动只有轻扫一种方式，见 docs/SPEC.md 第 3 节。
export const SWIPE_PX = 18; // 抬手时的判定阈值
export const SWIPE_EARLY_PX = 29; // 拖动中途提前出发的阈值

/** 位移 → 方向；位移不足阈值（轻点）返回 null。取位移较大的轴。 */
export function swipeDir(dx, dy, threshold = SWIPE_PX) {
  if (Math.hypot(dx, dy) < threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
