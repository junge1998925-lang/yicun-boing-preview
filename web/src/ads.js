// 模拟激励视频（SPEC 第 4 节）。
// 迁微信小游戏时，把 SimulatedRewardedAd 换成包装 wx.createRewardedVideoAd 的同接口对象：
//   show() → Promise<{ isEnded: boolean }>
// 调用方只使用 requestReward()，奖励只在 isEnded 为真时发放。

export class SimulatedRewardedAd {
  /**
   * @param {object} opt
   * @param {number} opt.durationMs 播放时长
   * @param {object} [opt.ui] { open(totalSec), tick(remainSec), close() }
   * @param {Function} [opt.setTimer] 注入计时器（单测用），签名同 setTimeout
   * @param {Function} [opt.clearTimer]
   */
  constructor({ durationMs = 4000, ui = null, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this.durationMs = durationMs;
    this.ui = ui;
    // 存成闭包而非方法，避免浏览器里 setTimeout 以错误的 this 调用（Illegal invocation）
    this._set = setTimer;
    this._clear = clearTimer;
    this.playing = false;
    this._finish = null;
  }

  show() {
    if (this.playing) return Promise.reject(new Error('广告正在播放'));
    this.playing = true;
    return new Promise((resolve) => {
      const tickMs = 250;
      let elapsed = 0;
      let timer = null;
      const done = (isEnded) => {
        if (!this.playing) return;
        this.playing = false;
        this._finish = null;
        if (timer !== null) (0, this._clear)(timer);
        this.ui && this.ui.close();
        resolve({ isEnded });
      };
      this._finish = done;
      this.ui && this.ui.open(Math.ceil(this.durationMs / 1000));
      const tick = () => {
        elapsed += tickMs;
        if (elapsed >= this.durationMs) return done(true);
        this.ui && this.ui.tick(Math.ceil((this.durationMs - elapsed) / 1000));
        timer = (0, this._set)(tick, tickMs);
      };
      timer = (0, this._set)(tick, Math.min(tickMs, this.durationMs));
    });
  }

  /** 用户中途关闭：不发奖励。 */
  abort() {
    if (this._finish) this._finish(false);
  }
}

/** 播放广告；仅在完整播完时调用 onReward（至多一次）。返回是否发放了奖励。 */
export async function requestReward(ad, onReward) {
  let res;
  try {
    res = await ad.show();
  } catch {
    return false;
  }
  if (res && res.isEnded === true) {
    onReward();
    return true;
  }
  return false;
}
