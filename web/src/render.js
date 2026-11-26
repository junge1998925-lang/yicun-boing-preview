// Canvas 像素风渲染。所有图形由代码绘制，无外部素材。
import { isLamp, windDir, allLit } from './rules.js';

const C = {
  night: '#0b1426',
  water: '#06101f',
  waterHi: '#0f2340',
  rock: '#2b3445',
  rockHi: '#3a4559',
  rockLo: '#1c2230',
  ice: '#a9d6f0',
  iceHi: '#e2f4ff',
  iceLo: '#7fb6d9',
  crack: '#5f93b8',
  thick: '#7ec0e6',
  thickHi: '#c9ecff',
  snow: '#eef3f8',
  snowLo: '#c9d4e2',
  wind: '#4b7fae',
  windArrow: '#f2fbff',
  lampOff: '#4a5568',
  lampOn: '#ffcf6b',
  glow: 'rgba(255, 207, 107, 0.28)',
  house: '#5b3a2a',
  roof: '#2c1a14',
  windowOff: '#1b2436',
  windowOn: '#ffd77a',
  coat: '#c0392b',
  face: '#f6d7b0',
  hint: 'rgba(255, 207, 107, 0.9)',
};

// 8×8 像素网格上画图：p(x,y,w,h,color)
function painter(ctx, ox, oy, size) {
  const u = size / 8;
  return (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(ox + x * u), Math.round(oy + y * u), Math.ceil(w * u), Math.ceil(h * u));
  };
}

function drawWater(p, x, y, t) {
  p(0, 0, 8, 8, C.water);
  const off = Math.floor((t / 600 + x * 3 + y * 5) % 6);
  p(off % 6, 2, 2, 1, C.waterHi);
  p((off + 3) % 6 + 1, 5, 2, 1, C.waterHi);
}

function drawRock(p) {
  p(0, 0, 8, 8, C.rock);
  p(0, 0, 8, 1, C.rockHi);
  p(0, 0, 1, 8, C.rockHi);
  p(0, 7, 8, 1, C.rockLo);
  p(7, 0, 1, 8, C.rockLo);
  p(3, 3, 2, 2, C.rockLo);
}

function drawIce(p, thick) {
  p(0, 0, 8, 8, C.water);
  p(0.25, 0.25, 7.5, 7.5, thick ? C.thick : C.ice);
  p(1, 1, 3, 1, thick ? C.thickHi : C.iceHi);
  p(1, 1, 1, 2, thick ? C.thickHi : C.iceHi);
  p(0.25, 7, 7.5, 0.75, C.iceLo);
  if (thick) {
    // 厚冰：双层边
    p(1, 6, 6, 0.6, C.iceLo);
    p(6, 1.5, 0.6, 4.5, C.iceLo);
  } else {
    p(5, 4, 1, 1, C.crack);
    p(4, 5, 1, 1, C.crack);
  }
}

function drawSnow(p) {
  p(0, 0, 8, 8, C.water);
  p(0.25, 0.25, 7.5, 7.5, C.snow);
  p(1, 5, 2, 1, C.snowLo);
  p(5, 2, 2, 1, C.snowLo);
  p(4, 6, 1, 1, C.snowLo);
}

function drawWind(p, dir, t) {
  p(0, 0, 8, 8, C.water);
  p(0.25, 0.25, 7.5, 7.5, C.wind);
  const shift = Math.floor(t / 180) % 3 - 1; // 箭头轻微流动
  const a = C.windArrow;
  // 朝右的箭头，再按方向变换坐标
  const pts = [[2, 3.5, 3, 1], [4, 2.5, 1, 3], [5, 3, 1, 2], [6, 3.5, 0.6, 1]];
  for (const [x, y, w, h] of pts) {
    let rx, ry, rw, rh;
    const sx = x + shift * 0.5;
    if (dir === 'right') [rx, ry, rw, rh] = [sx, y, w, h];
    else if (dir === 'left') [rx, ry, rw, rh] = [8 - sx - w, y, w, h];
    else if (dir === 'down') [rx, ry, rw, rh] = [y, sx, h, w];
    else [rx, ry, rw, rh] = [y, 8 - sx - w, h, w];
    p(rx, ry, rw, rh, a);
  }
}

function drawLamp(p, on, base, ctx, cx, cy, size) {
  if (base === 'snow') drawSnow(p);
  else drawIce(p, false);
  if (on) {
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 0.75);
    g.addColorStop(0, 'rgba(255, 207, 107, 0.55)');
    g.addColorStop(1, 'rgba(255, 207, 107, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  }
  p(3.5, 3, 1, 4, '#2a2f3a'); // 杆
  p(2.5, 7, 3, 0.6, '#2a2f3a');
  p(2.5, 1, 3, 2.2, on ? C.lampOn : C.lampOff); // 灯罩
  p(2.2, 0.6, 3.6, 0.6, '#2a2f3a');
}

function drawHouse(p, lit, ctx, cx, cy, size) {
  drawSnow(p);
  if (lit) {
    ctx.fillStyle = C.glow;
    ctx.fillRect(cx - size * 0.7, cy - size * 0.7, size * 1.4, size * 1.4);
  }
  p(1, 3, 6, 5, C.house);
  p(0, 2, 8, 1.2, C.roof);
  p(1, 1, 6, 1, C.roof);
  p(2, 0, 4, 1, C.roof);
  p(2, 4, 2, 2, lit ? C.windowOn : C.windowOff); // 窗
  p(5, 5, 1.6, 3, lit ? '#b8792e' : '#3a2519'); // 门
}

function drawPlayer(p, t, won) {
  const bob = won ? 0 : Math.round(Math.sin(t / 260) * 0.4 * 2) / 2;
  p(2.5, 6.6, 3, 0.8, 'rgba(0,0,0,0.25)');
  p(2.5, 3.5 + bob, 3, 3.2, C.coat); // 身体
  p(3, 1.5 + bob, 2, 2, C.face); // 头
  p(2.8, 1.1 + bob, 2.4, 0.8, '#3b2b25'); // 帽
  p(3.2, 2.2 + bob, 0.5, 0.5, '#222'); // 眼
  p(4.3, 2.2 + bob, 0.5, 0.5, '#222');
  // 提灯
  p(5.6, 4 + bob, 0.4, 1, '#2a2f3a');
  p(5.3, 5 + bob, 1.2, 1.2, C.lampOn);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = 40;
    this.shake = 0;
    this.flash = 0;
  }

  /** 按容器尺寸计算格子大小并设置 DPR 清晰度。 */
  resize(level, maxW, maxH) {
    const cell = Math.max(20, Math.floor(Math.min(maxW / level.w, maxH / level.h, 72)));
    this.cell = cell;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = cell * level.w;
    const h = cell * level.h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  bump(strength = 1) {
    this.shake = Math.max(this.shake, strength);
  }

  /**
   * 撞停 / 顶墙反馈：玩家朝 dir 方向挤一下再弹回，挡住的格子闪一下。
   * illegal=true（第一格就进不去）时闪红，否则闪白。
   */
  impact(dir, cell, { strength = 1, illegal = false } = {}) {
    this.hit = { dir, cell, strength, illegal, start: performance.now() };
  }

  /** 当前撞停动画进度：返回 { dx, dy, flash } 或 null。 */
  _hitState(now) {
    const h = this.hit;
    if (!h) return null;
    const k = (now - h.start) / (h.illegal ? 220 : 180);
    if (k >= 1) { this.hit = null; return null; }
    // 先快速挤压（前 30%）再弹回，带一点回弹
    const push = k < 0.3 ? k / 0.3 : Math.max(0, 1 - (k - 0.3) / 0.7) * Math.cos((k - 0.3) * 9);
    const amp = this.cell * (h.illegal ? 0.16 : 0.12) * h.strength * push;
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[h.dir];
    return { dx: v[0] * amp, dy: v[1] * amp, flash: Math.max(0, 1 - k * 1.4), cell: h.cell, illegal: h.illegal };
  }

  /** 落点预览：沿途淡色虚线 + 落点描边（胜利为暖黄、困死为红、普通为白）；非法为挡住格的红叉。 */
  _drawPreview(lv, p, t) {
    const { ctx, cell } = this;
    const cx = (i) => (i % lv.w) * cell + cell / 2;
    const cy = (i) => Math.floor(i / lv.w) * cell + cell / 2;
    ctx.save();
    if (!p.legal) {
      if (p.end >= 0) {
        const x = (p.end % lv.w) * cell, y = Math.floor(p.end / lv.w) * cell;
        ctx.strokeStyle = 'rgba(255, 110, 110, 0.9)';
        ctx.lineWidth = Math.max(2, cell / 14);
        const m = cell * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + m, y + m); ctx.lineTo(x + cell - m, y + cell - m);
        ctx.moveTo(x + cell - m, y + m); ctx.lineTo(x + m, y + cell - m);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const color = p.won ? 'rgba(255, 207, 107, 0.95)' : p.stuck ? 'rgba(255, 120, 120, 0.9)' : 'rgba(235, 248, 255, 0.9)';
    // 沿途小点：深色描边 + 亮色填充，冰面/雪地/风冰上都看得清
    const r = Math.max(2.5, cell / 10);
    for (const i of p.path.slice(0, -1)) {
      ctx.beginPath();
      ctx.arc(cx(i), cy(i), r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, cell / 24);
      ctx.strokeStyle = 'rgba(11, 20, 38, 0.85)';
      ctx.stroke();
    }
    // 落点：呼吸的描边方框 + 脚印
    const x = (p.end % lv.w) * cell, y = Math.floor(p.end / lv.w) * cell;
    const pulse = 0.5 + 0.5 * Math.sin(t / 140);
    const inset0 = 3 + pulse * 2;
    ctx.strokeStyle = 'rgba(11, 20, 38, 0.85)'; // 深色底框，保证在浅色冰面上也醒目
    ctx.lineWidth = Math.max(4, cell / 7);
    ctx.strokeRect(x + inset0, y + inset0, cell - inset0 * 2, cell - inset0 * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell / 12);
    ctx.setLineDash([cell / 5, cell / 10]);
    ctx.lineDashOffset = -t / 50;
    const inset = 3 + pulse * 2;
    ctx.strokeRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25 + 0.15 * pulse;
    ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
    ctx.restore();
  }

  draw(state, { t = 0, hint = [], hintCells = [], dim = false, playerPx = null, preview = null } = {}) {
    const { ctx, cell } = this;
    const lv = state.level;
    ctx.save();
    let sx = 0;
    if (this.shake > 0) {
      sx = Math.sin(t / 20) * 3 * this.shake;
      this.shake = Math.max(0, this.shake - 0.08);
    }
    ctx.translate(sx, 0);
    ctx.fillStyle = C.night;
    ctx.fillRect(-4, 0, cell * lv.w + 8, cell * lv.h);
    const lit = allLit(state);
    for (let i = 0; i < state.cells.length; i++) {
      const x = i % lv.w;
      const y = Math.floor(i / lv.w);
      const ox = x * cell;
      const oy = y * cell;
      const p = painter(ctx, ox, oy, cell);
      const ch = state.cells[i];
      const cx = ox + cell / 2;
      const cy = oy + cell / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cell, cell);
      ctx.clip();
      if (ch === '#') drawRock(p);
      else if (ch === '~') drawWater(p, x, y, t);
      else if (ch === '.') drawIce(p, false);
      else if (ch === '=') drawIce(p, true);
      else if (ch === 's' || ch === 'P') drawSnow(p);
      else if (windDir(ch)) drawWind(p, windDir(ch), t);
      else if (isLamp(ch)) drawLamp(p, state.lit[i], ch === 'o' ? 'snow' : 'ice', ctx, cx, cy, cell);
      else if (ch === 'H') drawHouse(p, lit, ctx, cx, cy, cell);
      ctx.restore();
    }
    const hit = this._hitState(performance.now());
    // 挡住的格子闪一下（非法顶墙为红，撞停为白）
    if (hit && hit.cell >= 0 && hit.flash > 0) {
      const x = (hit.cell % lv.w) * cell, y = Math.floor(hit.cell / lv.w) * cell;
      ctx.fillStyle = hit.illegal ? `rgba(255, 90, 90, ${0.45 * hit.flash})` : `rgba(255, 255, 255, ${0.35 * hit.flash})`;
      ctx.fillRect(x, y, cell, cell);
    }
    if (preview) this._drawPreview(lv, preview, t);
    // 提示路径
    if (hintCells.length) {
      ctx.lineWidth = Math.max(2, cell / 12);
      ctx.strokeStyle = C.hint;
      ctx.setLineDash([cell / 6, cell / 8]);
      ctx.lineDashOffset = -t / 40;
      hintCells.forEach((i, k) => {
        const x = (i % lv.w) * cell;
        const y = Math.floor(i / lv.w) * cell;
        ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.fillStyle = C.hint;
        ctx.font = `bold ${Math.floor(cell / 3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(k + 1), x + cell / 2, y + cell / 2);
      });
      ctx.setLineDash([]);
    }
    // 玩家
    const base = playerPx || { x: (state.pos % lv.w) * cell, y: Math.floor(state.pos / lv.w) * cell };
    const pp = hit ? { x: base.x + hit.dx, y: base.y + hit.dy } : base;
    drawPlayer(painter(ctx, pp.x, pp.y, cell), t, state.won);
    if (dim) {
      ctx.fillStyle = 'rgba(3, 7, 15, 0.45)';
      ctx.fillRect(-4, 0, cell * lv.w + 8, cell * lv.h);
    }
    ctx.restore();
  }
}
