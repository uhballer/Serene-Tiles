/* =============================================================
 * Serene Tiles — 堆叠消除（Tile Match）
 * 开发：阿尔曼江
 *
 * 核心算法：可解性保证的关卡生成
 *   朴素做法是随机撒方块再随机分配图案，但这会大量生成死局
 *   （想要的方块被永久压住）。本作改用「逆向模拟法」：
 *     1. 先生成堆叠布局（位置 + 层）
 *     2. 模拟一遍玩家的消除过程：每步从"当前可点"的方块里取 3 个
 *     3. 用模拟出的消除序列，反推每个方块该分配什么图案
 *   因为序列本身就是在真实遮挡规则下模拟出来的，所以按该序列
 *   消除必定能通关 —— 关卡在数学上保证有解。
 *   而 interleave 参数控制同一图案在序列上的分散程度，
 *   用来精确制造"槽内占位压力"（即 Tile Explorer 的 4 步消除）。
 * ============================================================= */

(function () {
  'use strict';

  var LAYER_OFFSET = 0.08;   // 每层视觉偏移（网格单位）
  var JITTER = 0.02;         // 位置抖动，避免过于整齐
  var COVER_THRESHOLD = 0.55;// 遮挡判定阈值（网格单位）
  var COMBO_WINDOW = 3500;   // 连击判定窗口（毫秒）；休闲玩家手速慢，窗口给得宽
  var SCORE_BASE = 100;      // 单次消除基础分，连击时按倍率放大

  /* ---------- 工具：可复现随机数 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 遮挡判定：a 是否压住 b ---------- */
  function covers(a, b) {
    if (a.layer <= b.layer) return false;
    return Math.abs(a.px - b.px) < COVER_THRESHOLD &&
           Math.abs(a.py - b.py) < COVER_THRESHOLD;
  }

  /* ---------- 布局生成 ---------- */
  function buildLayout(rng, cfg) {
    var total = cfg.tiles, layers = cfg.layers, gw = cfg.grid, gh = cfg.grid;

    // 每层方块数：底层多、顶层少，形成金字塔式堆叠
    var weights = [];
    for (var z = 0; z < layers; z++) weights.push(layers - z + 0.5);
    var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
    var counts = weights.map(function (w) {
      return Math.max(1, Math.round(total * w / wsum));
    });
    // 修正取整误差，保证总数精确
    var diff = total - counts.reduce(function (a, b) { return a + b; }, 0);
    var i = 0;
    while (diff !== 0 && i < 500) {
      var idx = i % layers;
      if (diff > 0) { counts[idx]++; diff--; }
      else if (counts[idx] > 1) { counts[idx]--; diff++; }
      i++;
    }

    var occupied = {};   // "cx,cy" -> 已占用的层集合
    var tiles = [];

    for (var z2 = 0; z2 < layers; z2++) {
      // 候选格：已被下层占用的格子权重更高（更容易形成堆叠）
      var cells = [];
      for (var cx = 0; cx < gw; cx++) {
        for (var cy = 0; cy < gh; cy++) {
          var key = cx + ',' + cy;
          var stacked = !!occupied[key];
          cells.push({ cx: cx, cy: cy, w: z2 === 0 ? 1 : (stacked ? 3 : 1) });
        }
      }
      // 按权重无放回抽样
      var need = counts[z2];
      var picked = [];
      var pool = cells.slice();
      while (picked.length < need && pool.length) {
        var tw = pool.reduce(function (a, c) { return a + c.w; }, 0);
        var r = rng() * tw, acc = 0, hit = 0;
        for (var p = 0; p < pool.length; p++) {
          acc += pool[p].w;
          if (r <= acc) { hit = p; break; }
        }
        var cell = pool.splice(hit, 1)[0];
        picked.push(cell);
        occupied[cell.cx + ',' + cell.cy] = true;
      }

      for (var q = 0; q < picked.length; q++) {
        var c = picked[q];
        tiles.push({
          id: tiles.length,
          cx: c.cx, cy: c.cy, layer: z2,
          px: c.cx + (rng() - 0.5) * 2 * JITTER + z2 * LAYER_OFFSET,
          py: c.cy + (rng() - 0.5) * 2 * JITTER - z2 * LAYER_OFFSET,
          symbol: '', removed: false, inTray: false
        });
      }
    }
    return tiles;
  }

  /* ---------- 模拟消除过程，产出保证有解的消除序列 ---------- */
  function simulateClear(tiles, rng) {
    var n = tiles.length;
    var coveredBy = [];
    for (var i = 0; i < n; i++) coveredBy.push([]);
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        if (a !== b && covers(tiles[a], tiles[b])) coveredBy[b].push(a);
      }
    }

    var removed = new Array(n).fill(false);
    var remaining = n;
    var order = [];

    while (remaining > 0) {
      var free = [];
      for (var i2 = 0; i2 < n; i2++) {
        if (removed[i2]) continue;
        var blocked = false;
        for (var u = 0; u < coveredBy[i2].length; u++) {
          if (!removed[coveredBy[i2][u]]) { blocked = true; break; }
        }
        if (!blocked) free.push(i2);
      }
      if (free.length < 3) return null; // 布局不合格，需重新生成
      shuffle(free, rng);
      var pick = free.slice(0, 3);
      for (var k = 0; k < 3; k++) removed[pick[k]] = true;
      order.push(pick);
      remaining -= 3;
    }
    return order;
  }

  /* ---------- 图案分配：interleave 控制分散度 ---------- */
  function assignSymbols(tiles, order, cfg, rng) {
    var S = cfg.symbols, R = cfg.rounds, k = order.length;

    var pool = SYMBOLS.slice();
    shuffle(pool, rng);
    var chosen = pool.slice(0, S);

    // 分块轮转：块大小 c 越小 → 同一图案在消除序列上越分散 → 槽内压力越大
    var c = Math.max(1, Math.round(R * (1 - cfg.interleave)));
    var remain = new Array(S).fill(R);
    var seq = [];
    var guard = 0;
    while (seq.length < k && guard++ < 1000) {
      var progressed = false;
      for (var s = 0; s < S; s++) {
        var take = Math.min(c, remain[s]);
        for (var t = 0; t < take; t++) seq.push(s);
        remain[s] -= take;
        if (take > 0) progressed = true;
      }
      if (!progressed) break;
    }
    for (var s2 = 0; s2 < S; s2++) {
      while (remain[s2] > 0 && seq.length < k) { seq.push(s2); remain[s2]--; }
    }

    for (var idx = 0; idx < order.length; idx++) {
      var sym = chosen[seq[idx] || 0];
      // 同时记下图案在 SYMBOLS 中的下标：渲染层据此给瓷砖上色，
      // 让每种图案有稳定配色（玩家可用颜色辅助识别，降低认知负荷）
      var symIdx = SYMBOLS.indexOf(sym);
      for (var m = 0; m < order[idx].length; m++) {
        tiles[order[idx][m]].symbol = sym;
        tiles[order[idx][m]].symIdx = symIdx;
      }
    }
  }

  /* ---------- 生成一关（带重试，保证成功） ---------- */
  function generateLevel(cfg, seedBase) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var rng = mulberry32(seedBase + attempt * 7919);
      var tiles = buildLayout(rng, cfg);
      if (tiles.length !== cfg.tiles) continue;
      var order = simulateClear(tiles, rng);
      if (!order) continue;
      assignSymbols(tiles, order, cfg, rng);
      return { tiles: tiles, solution: order };
    }
    // 极端兜底：降规模重生成
    var fallback = Object.assign({}, cfg, { tiles: Math.floor(cfg.tiles * 0.7 / 3) * 3 });
    fallback.triples = fallback.tiles / 3;
    fallback.rounds = Math.max(1, Math.floor(fallback.triples / cfg.symbols));
    return generateLevel(fallback, seedBase + 104729);
  }

  /* =========================================================
   *  游戏状态与交互
   * ========================================================= */
  var state = null;
  var el = {};

  function $(id) { return document.getElementById(id); }

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem('sereneTiles.progress') || '{}');
    } catch (e) { return {}; }
  }
  function saveProgress() {
    try {
      localStorage.setItem('sereneTiles.progress', JSON.stringify(state.progress));
    } catch (e) {}
  }

  function startLevel(lv) {
    var cfg = LEVEL_CURVE[lv - 1];
    var gen = generateLevel(cfg, lv * 1000 + 7);
    state.level = lv;
    state.cfg = cfg;
    state.tiles = gen.tiles;
    state.solution = gen.solution;
    state.tray = [];
    state.items = Object.assign({}, ITEM_LOADOUT);
    state.undoStack = [];
    state.finished = false;
    state.startTime = Date.now();
    state.moves = 0;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastMatchTime = 0;
    state.itemsUsed = 0;
    state.lastMatchTiles = null;
    state.justLanded = null;
    el.levelNum.textContent = lv;
    renderScore();
    el.levelTag.textContent = cfg.tag === 'breather' ? 'BREATHER' :
                              cfg.tag === 'milestone' ? 'MILESTONE' :
                              cfg.tag === 'tutorial' ? 'TUTORIAL' : 'NORMAL';
    el.levelTag.className = 'tag tag-' + cfg.tag;
    showScreen('game');
    buildBoard();
    renderAll();
  }

  function buildBoard() {
    var cfg = state.cfg;
    var board = el.board;
    board.innerHTML = '';
    var availW = board.parentElement.clientWidth - 24;
    var boardW = Math.min(availW, 470);
    var pad = 0.08 * (cfg.layers - 1);
    var cell = boardW / (cfg.grid + 0.12);
    var boardH = cell * (cfg.grid + pad + 0.12);
    board.style.width = boardW + 'px';
    board.style.height = boardH + 'px';
    state.cell = cell;
    state.padY = pad;

    for (var i = 0; i < state.tiles.length; i++) {
      var t = state.tiles[i];
      var d = document.createElement('div');
      // k0~k9：按图案下标取配色，10 组循环
      d.className = 'tile k' + ((t.symIdx || 0) % 10);
      d.style.width = (cell * 0.94) + 'px';
      d.style.height = (cell * 0.94) + 'px';
      d.style.fontSize = (cell * 0.46) + 'px';
      d.style.zIndex = 10 + t.layer * 10;
      d.textContent = t.symbol;
      d.dataset.id = t.id;
      // 开场：瓷砖按索引依次弹出（用独立 scale 属性，避免覆盖内联 transform 的位移）
      d.classList.add('dealing');
      if (d.style.setProperty) d.style.setProperty('--i', i);
      d.addEventListener('click', onTileClick);
      t.el = d;
      t.flying = false;
      board.appendChild(d);
    }
  }

  function placeTile(t) {
    var x = (t.px + 0.06) * state.cell;
    var y = (t.py + state.padY + 0.06) * state.cell;
    var hidden = t.removed || (t.inTray && !t.flying);
    t.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    t.el.style.opacity = hidden ? '0' : '1';
    t.el.style.pointerEvents = t.removed ? 'none' : 'auto';
    t.el.classList.toggle('blocked', !t.removed && !t.inTray && isBlocked(t));
  }

  function renderScore() {
    if (el.scoreVal) el.scoreVal.textContent = state.score;
  }

  function isBlocked(t) {
    if (t.removed || t.inTray) return false;
    for (var i = 0; i < state.tiles.length; i++) {
      var o = state.tiles[i];
      if (o === t || o.removed || o.inTray) continue;
      if (covers(o, t)) return true;
    }
    return false;
  }

  function renderAll() {
    for (var i = 0; i < state.tiles.length; i++) placeTile(state.tiles[i]);
    renderTray();
    renderItems();
    var left = state.tiles.filter(function (t) { return !t.removed; }).length;
    el.tilesLeft.textContent = left;
  }

  function renderTray() {
    el.tray.innerHTML = '';
    for (var i = 0; i < TRAY_SIZE; i++) {
      var s = document.createElement('div');
      s.className = 'slot';
      if (i < state.tray.length) {
        s.classList.add('filled', 'k' + ((state.tray[i].symIdx || 0) % 10));
        var inner = document.createElement('span');
        inner.textContent = state.tray[i].symbol;
        s.appendChild(inner);
      }
      el.tray.appendChild(s);
    }
    // 只给"刚飞进来"的那个槽位播落地动画，避免每次重绘整排都在弹
    if (state.justLanded != null && el.tray.children[state.justLanded]) {
      el.tray.children[state.justLanded].classList.add('landing');
    }
    // 槽位将满 → 危险提示（对标 Tile Explorer 的 "Challenge" 提示）
    var danger = TRAY_SIZE - state.tray.length;
    el.trayHint.textContent = danger === 0 ? 'Tray full!' :
      danger <= 2 ? 'Careful — ' + danger + ' slot(s) left' : '';
    el.trayHint.className = danger <= 2 ? 'tray-hint danger' : 'tray-hint';
    el.tray.classList.toggle('tense', danger <= 2 && !state.finished);
  }

  /* ---------- 飞行动画：方块从棋盘飞进槽位 ---------- */
  function flyToSlot(t, slotIndex) {
    var tileEl = t.el;
    var slotEl = el.tray.children ? el.tray.children[slotIndex] : null;
    var hasRect = tileEl && tileEl.getBoundingClientRect && slotEl && slotEl.getBoundingClientRect;
    if (!hasRect) { t.inTray = true; placeTile(t); return; }

    var a = tileEl.getBoundingClientRect();
    var b = slotEl.getBoundingClientRect();
    if (!a || !b) { placeTile(t); return; }

    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var baseX = (t.px + 0.06) * state.cell;
    var baseY = (t.py + state.padY + 0.06) * state.cell;

    t.flying = true;
    tileEl.style.transition = 'transform .28s cubic-bezier(.3,.85,.35,1), opacity .12s .16s';
    tileEl.style.zIndex = '999';
    tileEl.style.transform =
      'translate(' + (baseX + dx) + 'px,' + (baseY + dy) + 'px) scale(.60)';
    tileEl.style.opacity = '0';

    setTimeout(function () {
      t.flying = false;
      if (!tileEl) return;
      tileEl.style.transition = '';
      tileEl.style.zIndex = '';
      placeTile(t);
    }, 300);
  }

  /* ---------- 粒子：三消成立时在三个方块的原位置爆开 ---------- */
  function burstAt(t) {
    if (!el.fxLayer || !t.el || !t.el.getBoundingClientRect) return;
    var r = t.el.getBoundingClientRect();
    if (!r || !r.width) return;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var colors = ['#e8a33d', '#1f6f63', '#5dcaa5', '#f0c26b', '#7fd0bd'];
    for (var i = 0; i < 9; i++) {
      var p = document.createElement('div');
      p.className = 'particle';
      var ang = (Math.PI * 2 * i) / 9 + Math.random() * 0.6;
      var dist = 26 + Math.random() * 30;
      var size = 5 + Math.random() * 5;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = (cx - size / 2) + 'px';
      p.style.top = (cy - size / 2) + 'px';
      p.style.background = colors[i % colors.length];
      if (p.style.setProperty) {
        p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      }
      el.fxLayer.appendChild(p);
      removeLater(p, 660);
    }
  }
  function removeLater(node, ms) {
    setTimeout(function () {
      if (node.parentElement && node.parentElement.removeChild) {
        node.parentElement.removeChild(node);
      }
    }, ms);
  }

  /* ---------- 连击 ---------- */
  function showCombo(n, gain) {
    if (!el.comboBadge) return;
    el.comboBadge.textContent = 'COMBO ×' + n + '   +' + gain;
    el.comboBadge.classList.remove('show');
    void el.comboBadge.offsetWidth;
    el.comboBadge.classList.add('show');
  }

  function renderItems() {
    el.itemUndo.textContent = state.items.undo;
    el.itemHint.textContent = state.items.hint;
    el.itemRecall.textContent = state.items.recall;
    [['undo', el.btnUndo], ['hint', el.btnHint], ['recall', el.btnRecall]].forEach(function (p) {
      p[1].disabled = state.items[p[0]] <= 0 || state.finished;
    });
  }

  function onTileClick(e) {
    if (state.finished) return;
    var id = parseInt(e.currentTarget.dataset.id, 10);
    var t = state.tiles[id];
    if (t.removed || t.inTray) return;
    if (isBlocked(t)) {
      t.el.classList.remove('shake');
      void t.el.offsetWidth;
      t.el.classList.add('shake');
      return;
    }
    t.inTray = true;
    state.tray.push(t);
    state.undoStack.push(t);
    state.moves++;
    var slotIndex = state.tray.length - 1;
    state.justLanded = slotIndex;

    var matched = resolveTray();

    if (matched) {
      // 三消成立：在三个方块原来的位置爆出粒子
      if (state.lastMatchTiles) {
        state.lastMatchTiles.forEach(function (m) { burstAt(m); });
        state.lastMatchTiles = null;
      }
      state.justLanded = null;
    } else if (!state.finished) {
      // 未凑齐：让方块飞进槽位
      flyToSlot(t, slotIndex);
    }
  }

  function resolveTray() {
    // 检查是否有 3 个相同
    var counts = {};
    state.tray.forEach(function (t) {
      counts[t.symbol] = (counts[t.symbol] || 0) + 1;
    });
    var matched = null;
    for (var k in counts) if (counts[k] >= 3) { matched = k; break; }

    if (matched) {
      var toRemove = [];
      for (var i = 0; i < state.tray.length && toRemove.length < 3; i++) {
        if (state.tray[i].symbol === matched) toRemove.push(state.tray[i]);
      }
      toRemove.forEach(function (t) { t.removed = true; t.inTray = false; t.flying = false; });
      state.tray = state.tray.filter(function (t) { return toRemove.indexOf(t) < 0; });
      state.undoStack = [];
      state.lastMatchTiles = toRemove;

      // 连击判定：距上次消除在窗口内则累加，否则重新计数
      var now = Date.now();
      state.combo = (now - state.lastMatchTime < COMBO_WINDOW) ? state.combo + 1 : 1;
      state.lastMatchTime = now;
      if (state.combo > state.maxCombo) state.maxCombo = state.combo;

      var gain = SCORE_BASE * state.combo;
      state.score += gain;
      if (state.combo >= 2) showCombo(state.combo, gain);
      else flashMessage('+' + gain, 'good');
    }

    renderAll();
    renderScore();

    // 判负：槽位塞满且无法消除
    if (state.tray.length >= TRAY_SIZE) { endGame(false); return matched; }
    // 判胜：全部清空
    var left = state.tiles.filter(function (t) { return !t.removed; }).length;
    if (left === 0) endGame(true);
    return matched;
  }

  function flashMessage(text, kind) {
    el.flash.textContent = text;
    el.flash.className = 'flash ' + (kind || '') + ' show';
    setTimeout(function () { el.flash.className = 'flash'; }, 900);
  }

  /* 星级：不用道具 3★，用 ≤2 个 2★，其余 1★ */
  function starHtml(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<span class="s' + (i < n ? ' on' : '') + '">★</span>';
    return s;
  }
  function starText(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += (i < n ? '★' : '☆');
    return s;
  }

  /* ---------- 道具 ---------- */
  function useUndo() {
    if (state.items.undo <= 0 || !state.tray.length) return;
    var t = state.tray.pop();
    t.inTray = false;
    t.flying = false;
    state.items.undo--;
    state.itemsUsed++;
    state.undoStack.pop();
    state.justLanded = null;
    renderAll();
    renderItems();
    flashMessage('Undo', '');
  }
  function useHint() {
    if (state.items.hint <= 0) return;
    // 找一组当前可点且同图案的方块
    var bySym = {};
    state.tiles.forEach(function (t) {
      if (t.removed || t.inTray || isBlocked(t)) return;
      (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
    });
    var found = null;
    // 优先补齐槽内已有 2 个的图案
    var trayCount = {};
    state.tray.forEach(function (t) { trayCount[t.symbol] = (trayCount[t.symbol] || 0) + 1; });
    var cands = Object.keys(bySym).filter(function (s) { return bySym[s].length + (trayCount[s] || 0) >= 3; });
    cands.sort(function (a, b) { return (trayCount[b] || 0) - (trayCount[a] || 0); });
    if (cands.length) found = bySym[cands[0]].slice(0, 3 - (trayCount[cands[0]] || 0));
    else {
      var any = Object.keys(bySym).filter(function (s) { return bySym[s].length >= 3; });
      if (any.length) found = bySym[any[0]].slice(0, 3);
    }
    if (!found) { flashMessage('No move found', ''); return; }
    state.items.hint--;
    state.itemsUsed++;
    found.forEach(function (t) {
      t.el.classList.add('hint');
      setTimeout(function () { t.el.classList.remove('hint'); }, 1600);
    });
    renderItems();
  }
  function useRecall() {
    if (state.items.recall <= 0 || !state.tray.length) return;
    state.tray.forEach(function (t) { t.inTray = false; t.flying = false; });
    state.tray = [];
    state.items.recall--;
    state.itemsUsed++;
    state.justLanded = null;
    state.undoStack = [];
    renderAll();
    renderItems();
    flashMessage('Recalled', '');
  }

  /* ---------- 结算 ---------- */
  function endGame(win) {
    state.finished = true;
    renderItems();
    var secs = Math.round((Date.now() - state.startTime) / 1000);
    var stars = state.itemsUsed === 0 ? 3 : (state.itemsUsed <= 2 ? 2 : 1);
    var perfect = state.itemsUsed === 0 && state.maxCombo >= 3;

    if (win) {
      var p = state.progress;
      if (!p.unlocked || p.unlocked < state.level + 1) {
        p.unlocked = Math.min(state.level + 1, LEVEL_CURVE.length);
      }
      p.cleared = p.cleared || {};
      p.cleared[state.level] = true;
      p.stars = p.stars || {};
      if (!p.stars[state.level] || p.stars[state.level] < stars) p.stars[state.level] = stars;
      saveProgress();
      el.resultTitle.textContent = 'Level Clear!';
      el.resultBody.innerHTML =
        '<div class="stars">' + starHtml(stars) + '</div>' +
        (perfect ? '<div class="perfect-tag">PERFECT</div>' : '') +
        '<p>得分 <b>' + state.score + '</b> · 最高连击 ×' + state.maxCombo +
        ' · 用时 ' + secs + ' 秒 · ' + state.moves + ' 次点击</p>' +
        '<p class="dn"><strong>本关设计意图：</strong>' + state.cfg.note + '</p>';
      el.btnNext.style.display = state.level < LEVEL_CURVE.length ? '' : 'none';
    } else {
      el.resultTitle.textContent = 'Tray Full';
      el.resultBody.innerHTML =
        '<p>槽位已被 ' + TRAY_SIZE + ' 种不同图案占满 · 得分 ' + state.score + '</p>' +
        '<p class="dn"><strong>本关设计意图：</strong>' + state.cfg.note + '</p>';
      el.btnNext.style.display = 'none';
    }
    el.result.classList.add('show');
  }

  /* ---------- 界面 ---------- */
  function showScreen(name) {
    el.menu.classList.toggle('hidden', name !== 'menu');
    el.game.classList.toggle('hidden', name !== 'game');
  }

  function buildMenu() {
    var p = state.progress;
    el.levelGrid.innerHTML = '';
    LEVEL_CURVE.forEach(function (cfg) {
      var b = document.createElement('button');
      var unlocked = cfg.lv <= (p.unlocked || 1);
      var cleared = p.cleared && p.cleared[cfg.lv];
      b.className = 'lvl' + (unlocked ? '' : ' locked') + (cleared ? ' cleared' : '');
      var got = (p.stars && p.stars[cfg.lv]) || 0;
      b.innerHTML = '<span class="n">' + cfg.lv + '</span>' +
        (cleared ? '<span class="st">' + starText(got) + '</span>' : '') +
        (cfg.tag === 'milestone' ? '<span class="ms">★</span>' :
         cfg.tag === 'breather' ? '<span class="br">~</span>' : '');
      b.title = cfg.note;
      b.disabled = !unlocked;
      b.addEventListener('click', function () { startLevel(cfg.lv); });
      el.levelGrid.appendChild(b);
    });
  }

  function init() {
    el = {
      menu: $('screen-menu'), game: $('screen-game'),
      levelGrid: $('level-grid'), board: $('board'), tray: $('tray'),
      trayHint: $('tray-hint'), tilesLeft: $('tiles-left'),
      levelNum: $('level-num'), levelTag: $('level-tag'),
      itemUndo: $('item-undo'), itemHint: $('item-hint'), itemRecall: $('item-recall'),
      btnUndo: $('btn-undo'), btnHint: $('btn-hint'), btnRecall: $('btn-recall'),
      flash: $('flash'), result: $('result'), resultTitle: $('result-title'),
      resultBody: $('result-body'), btnNext: $('btn-next'),
      designNote: $('design-note'), designText: $('design-text'),
      scoreVal: $('score-val'), comboBadge: $('combo-badge'), fxLayer: $('fx-layer')
    };
    state = { progress: loadProgress() };

    buildMenu();
    showScreen('menu');

    $('btn-back').addEventListener('click', function () {
      buildMenu(); showScreen('menu');
    });
    function restart() {
      el.result.classList.remove('show');
      startLevel(state.level);
    }
    $('btn-restart').addEventListener('click', restart);
    $('btn-restart-2').addEventListener('click', restart);
    el.btnNext.addEventListener('click', function () {
      el.result.classList.remove('show');
      startLevel(Math.min(state.level + 1, LEVEL_CURVE.length));
    });
    $('btn-result-close').addEventListener('click', function () {
      el.result.classList.remove('show');
    });
    el.btnUndo.addEventListener('click', useUndo);
    el.btnHint.addEventListener('click', useHint);
    el.btnRecall.addEventListener('click', useRecall);
    $('btn-note').addEventListener('click', function () {
      el.designText.textContent = state.cfg ? state.cfg.note : '';
      el.designNote.classList.toggle('show');
    });
    $('btn-reset-progress').addEventListener('click', function () {
      state.progress = {};
      saveProgress();
      buildMenu();
    });

    window.addEventListener('resize', function () {
      if (state && state.cfg && !el.game.classList.contains('hidden')) buildBoard(), renderAll();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // 暴露生成器以便自动化测试可解性（test/generate-check.js）
  if (typeof window !== 'undefined') {
    window.SereneTiles = {
      generateLevel: generateLevel,
      simulateClear: simulateClear,
      covers: covers,
      LEVEL_CURVE: LEVEL_CURVE,
      // 注意：levels.js 用 const 声明的顶层变量不会挂到 globalThis 上，
      // 外部脚本（如测试）直接取 sandbox.TRAY_SIZE 会得到 undefined。
      // 这里显式导出，避免测试里的判负条件静默失效。
      TRAY_SIZE: TRAY_SIZE,
      ITEM_LOADOUT: ITEM_LOADOUT
    };
  }
})();
