/* =============================================================
 * Serene Tiles — 关卡难度曲线配置 (Level Difficulty Curve)
 * 设计者：阿尔曼江
 *
 * 设计说明（详见 docs/level-design.md）：
 * 本作对标 Tile Explorer 的关卡节奏，核心难度由 4 个旋钮控制：
 *   symbols    图案种类数 —— 种类越多，槽内凑齐 3 个越难，槽位压力越大
 *   rounds     每种图案的组数（每组 3 个）—— 决定关卡时长
 *   layers     堆叠层数 —— 层数越深，"被压住"的方块越多
 *   interleave 图案交错度 0~1 —— 关键旋钮，见下
 *
 * 【interleave 是核心设计机制】
 * interleave 控制同一图案的方块在"消除序列"上是集中还是分散：
 *   0 = 集中：某图案的全部方块集中在一小段消除序列内，玩家可一口气清完
 *   1 = 分散：同一图案的方块散落在整条序列上，玩家点掉 1 个后，
 *            剩下 2 个被压在深层取不出，只能长期占着槽位
 * 后者正是 Tile Explorer 的"4 步消除"机制 —— 通过打断 Combo、
 * 制造槽内占位压力来产生难度。本作用 interleave 将其参数化。
 *
 * 【喘息关 Breather】
 * 标记为 breather 的关卡会主动回落难度。参照 Tile Explorer
 * "成就感 → 不难 → 放松" 的体验闭环，每 3~4 关插入一次喘息，
 * 避免难度单调上升导致的流失。
 * ============================================================= */

// 出海欧美向：选用辨识度高、无文化门槛的日常图案（水果/动物/甜点）
const SYMBOLS = [
  '🍎', '🍋', '🍇', '🥝', '🍒', '🥥',
  '🍍', '🍓', '🌻', '🐟', '🦋', '🍩',
  '🧁', '🎈', '⭐', '🔔'
];

const TRAY_SIZE = 7; // 槽位数，对标 Tile Explorer

const LEVEL_CURVE = [
  // ── 第一阶段 L1-3：教学期 ──────────────────────────────
  { lv: 1,  symbols: 3, rounds: 2, layers: 2, interleave: 0.10, grid: 6, tag: 'tutorial',
    note: '首次接触。仅 3 种图案、2 层，让玩家在无压力状态下理解「点 3 个相同 → 消除」的闭环。' },
  { lv: 2,  symbols: 4, rounds: 2, layers: 2, interleave: 0.15, grid: 6, tag: 'tutorial',
    note: '引入第 4 种图案，槽位压力首次出现但仍可控。' },
  { lv: 3,  symbols: 4, rounds: 3, layers: 2, interleave: 0.20, grid: 6, tag: 'normal',
    note: '关卡时长拉长（组数 2→3），建立「一局约 60-90 秒」的节奏认知。' },

  // ── 第二阶段 L4-8：成长期 ──────────────────────────────
  { lv: 4,  symbols: 5, rounds: 3, layers: 3, interleave: 0.25, grid: 7, tag: 'normal',
    note: '首次引入第 3 层堆叠，玩家第一次体验到「想要的方块被压住」。' },
  { lv: 5,  symbols: 4, rounds: 3, layers: 2, interleave: 0.20, grid: 7, tag: 'breather',
    note: '喘息关。回落到 2 层 4 图案，消化 L4 的堆叠挫败感。' },
  { lv: 6,  symbols: 5, rounds: 4, layers: 3, interleave: 0.30, grid: 7, tag: 'normal',
    note: '组数增至 4，交错度提升，槽内开始出现长期占位。' },
  { lv: 7,  symbols: 6, rounds: 4, layers: 3, interleave: 0.35, grid: 7, tag: 'normal',
    note: '6 种图案，槽位压力显著。玩家开始需要规划点击顺序。' },
  { lv: 8,  symbols: 5, rounds: 3, layers: 3, interleave: 0.25, grid: 7, tag: 'breather',
    note: '喘息关。缩短时长（组数 4→3）但保留 3 层，避免能力感倒退。' },

  // ── 第三阶段 L9-14：挑战期（4 步消除机制密度上升）────────
  { lv: 9,  symbols: 6, rounds: 5, layers: 3, interleave: 0.40, grid: 8, tag: 'normal',
    note: '交错度 0.40，「4 步消除」组合开始成规模出现，Combo 频繁被打断。' },
  { lv: 10, symbols: 6, rounds: 5, layers: 4, interleave: 0.45, grid: 8, tag: 'milestone',
    note: '里程碑关。首次 4 层堆叠，是本作第一个真正的难度台阶。' },
  { lv: 11, symbols: 7, rounds: 4, layers: 4, interleave: 0.50, grid: 8, tag: 'normal',
    note: '7 种图案逼近 7 槽位上限，容错率极低，道具价值首次凸显。' },
  { lv: 12, symbols: 5, rounds: 4, layers: 3, interleave: 0.30, grid: 8, tag: 'breather',
    note: '喘息关。图案数回落至 5，给玩家一次顺畅的通关体验。' },
  { lv: 13, symbols: 7, rounds: 5, layers: 4, interleave: 0.45, grid: 8, tag: 'normal',
    note: '在 L11 的压力基础上拉长时长，考验持续专注。'
       + '（迭代：实测 80.7% 反低于 L14，出现难度倒挂，交错度 0.50→0.45 修正曲线单调性）' },
  { lv: 14, symbols: 7, rounds: 5, layers: 4, interleave: 0.55, grid: 8, tag: 'normal',
    note: '交错度 0.55，接近设计上限，深层占位方块显著增多。' },

  // ── 第四阶段 L15-20：险境期（险境→解围循环强化）─────────
  { lv: 15, symbols: 6, rounds: 4, layers: 3, interleave: 0.35, grid: 8, tag: 'breather',
    note: '喘息关。长线运营中，第 15 关前后是流失高发点，刻意回落。' },
  { lv: 16, symbols: 8, rounds: 5, layers: 4, interleave: 0.55, grid: 8, tag: 'normal',
    note: '8 种图案 > 槽位 7，理论上必须借助道具或精确规划才能通关。' },
  { lv: 17, symbols: 8, rounds: 5, layers: 5, interleave: 0.60, grid: 8, tag: 'milestone',
    note: '里程碑关。首次 5 层堆叠，视觉与策略双重压迫。' },
  { lv: 18, symbols: 6, rounds: 4, layers: 3, interleave: 0.35, grid: 8, tag: 'breather',
    note: '喘息关。'
       + '（迭代：原配置实测仅 87.0%，未达喘息关 ≥88% 的回落标准，'
       + '参数由 7图案/5组/4层/0.50 下调为 6图案/4组/3层/0.35）' },
  { lv: 19, symbols: 8, rounds: 5, layers: 5, interleave: 0.60, grid: 8, tag: 'normal',
    note: '5 层 + 0.60 交错，本作常规关难度峰值。' },
  { lv: 20, symbols: 9, rounds: 4, layers: 5, interleave: 0.65, grid: 8, tag: 'milestone',
    note: '阶段终关。9 种图案远超 7 槽位，强制玩家使用道具与规划能力。'
       + '（迭代：原 5 组实测仅 44.7%，曲线末端过陡易劝退，组数 5→4 收短关卡时长）' },
];

// 派生字段：每组 3 个方块
LEVEL_CURVE.forEach(function (cfg) {
  cfg.triples = cfg.symbols * cfg.rounds;
  cfg.tiles = cfg.triples * 3;
});

/* 道具初始配给（每关重置）
 * 设计意图：配给量刻意收紧，让道具成为"险境解围"的资源而非随手可用的拐杖。
 * 数值推导见 docs/economy.md
 */
const ITEM_LOADOUT = { undo: 3, hint: 2, recall: 1 };
