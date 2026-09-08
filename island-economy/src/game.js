// game.js — 荒岛养成状态机(Phase 1: 纯养成闭环)
// 定位:表层的"玩家在玩的养成"逻辑;底层小岛经济学(economy.js)作为隐藏引擎 Phase 2 再接入。

// ---------- 科技树定义 ----------
export const TECH_TREE = [
  // 阶段1:原始生存
  { id: 'basket',   name: '采集篓',     desc: '每天自动采集野生根茎', phase: 1,
    goal: () => true, // 无前置
    progress: (g) => ({ done: g.baskets >= 2, text: `采集篓 ${g.baskets}/2` }) },
  // 阶段2:基础建设
  { id: 'net',      name: '织渔网',     desc: '捕鱼效率×2', phase: 2,
    goal: (g) => g.wood >= 2,
    progress: (g) => ({ done: g.hasNet, text: g.hasNet ? '已完成' : `木头 ${g.wood}/2` }) },
  { id: 'hut',      name: '盖棚屋',     desc: '每间住2人', phase: 2,
    goal: (g) => g.wood >= 4 && g.stone >= 2,
    progress: (g) => ({ done: g.huts >= 1, text: g.huts >= 1 ? '已完成' : `木${g.wood}/4 石${g.stone}/2` }) },
  { id: 'granary',  name: '盖粮仓',     desc: '谷穗保鲜×2', phase: 2,
    goal: (g) => g.wood >= 6 && g.stone >= 4,
    progress: (g) => ({ done: g.granary >= 1, text: g.granary >= 1 ? '已完成' : `木${g.wood}/6 石${g.stone}/4` }) },
  { id: 'dock',     name: '建码头',     desc: '捕鱼效率×3', phase: 2,
    goal: (g) => g.wood >= 8,
    progress: (g) => ({ done: g.dock >= 1, text: g.dock >= 1 ? '已完成' : `木头 ${g.wood}/8` }) },
  // 阶段3:造船出海
  { id: 'boat',     name: '造船',       desc: '解锁深海钓鱼和出海探索', phase: 3,
    goal: (g) => g.wood >= 30 && g.stone >= 10 && g.dock >= 1,
    progress: (g) => ({ done: g.hasBoat, text: g.hasBoat ? '已完成' : `木${g.wood}/30 石${g.stone}/10` }) },
  { id: 'deepfish', name: '深海钓鱼',   desc: '钓到铁矿石碎片', phase: 3,
    goal: (g) => g.hasBoat,
    progress: (g) => ({ done: (g.ironFragments || 0) >= 3, text: `铁矿碎片 ${g.ironFragments || 0}/3` }) },
  // 阶段4:铁器时代
  { id: 'workbench', name: '工具台',    desc: '解锁铁器工具', phase: 4,
    goal: (g) => g.wood >= 10 && g.stone >= 6 && (g.iron || 0) >= 3,
    progress: (g) => ({ done: g.hasWorkbench, text: g.hasWorkbench ? '已完成' : `木${g.wood}/10 石${g.stone}/6 铁${g.iron || 0}/3` }) },
  // 阶段5:冶炼时代
  { id: 'furnace',  name: '冶炼炉',     desc: '生产精炼铁', phase: 5,
    goal: (g) => (g.iron || 0) >= 5 && g.stone >= 10 && g.hasWorkbench,
    progress: (g) => ({ done: g.hasFurnace, text: g.hasFurnace ? '已完成' : `铁${g.iron || 0}/5 石${g.stone}/10` }) },
  // 阶段6:航海时代
  { id: 'trader',   name: '商船',       desc: '远洋探索', phase: 6,
    goal: (g) => (g.refinedIron || 0) >= 5 && g.wood >= 50 && g.hasFurnace,
    progress: (g) => ({ done: g.hasTrader, text: g.hasTrader ? '已完成' : `精炼铁${g.refinedIron || 0}/5 木${g.wood}/50` }) },
];
// 获取当前主线目标
export function getCurrentGoal(g) {
  for (const tech of TECH_TREE) {
    const p = tech.progress(g);
    if (!p.done) return { tech, ...p };
  }
  return { tech: null, done: true, text: '🎉 所有科技已解锁!' };
}

export const CFG = {
  // 采集产出
  FISH_PER_CATCH: [1, 2, 3],        // 徒手 / 渔网 / 码头
  TREE_WOOD: 3,                     // 砍一棵树
  ROCK_STONE: 2,                    // 采一块石头
  BUSH_GRAIN: 1,                    // 摘一丛野果穗
  // 作物
  PLANT_COST: 1,                    // 播种耗谷穗
  CROP_DAYS: 3,                     // 生长天数
  CROP_YIELD: 6,                    // 收获谷穗
  // 资源再生(天)
  TREE_REGROW: 4,
  ROCK_REGROW: 6,
  BUSH_REGROW: 2,
  FISH_MAX: 12,                     // 水域鱼群上限
  // 建造
  HUT_COST: { wood: 4, stone: 2 },
  GRANARY_COST: { wood: 6, stone: 4 },
  DOCK_COST: { wood: 8, stone: 0 },
  BOAT_COST: { wood: 30, stone: 10 },           // 造船
  WORKBENCH_COST: { wood: 10, stone: 6, iron: 3 }, // 工具台
  WELL_COST: { wood: 0, stone: 8, iron: 2 },       // 水井
  FURNACE_COST: { wood: 0, stone: 10, iron: 5 },    // 冶炼炉
  // 铁矿石保底
  IRON_PER_ORE: 3,       // 3碎片=1铁矿石
  IRON_PRD_BASE: 0.05,   // PRD基础概率
  IRON_PRD_STEP: 0.08,   // PRD每次递增
  IRON_PRD_CAP: 0.50,    // PRD概率上限
  DEEP_FISH_COOLDOWN: 0, // 深海钓鱼无冷却(同一天可多次)
  NET_COST: { wood: 2, fiber: 0 },  // 渔网用木头编(也可以改吃鱼成本)
  BASKET_COST: { wood: 4 },         // 采集篓
  BASKET_MAX: 2,                    // 每人岛最多2个采集篓
  BASKET_MIN_YIELD: 1,              // 每天最少产出
  BASKET_MAX_YIELD: 2,              // 每天最多产出
  // 人口与生存
  EAT_PER_PERSON: 1,                // 每人每天吃1份食物(鱼或谷穗)
  ISLANDER_WORK: 1,                 // 散工每天自动产出1份食物(自给自足)
  POP_CAP: 12,
  HUT_CAPACITY: 2,                  // 每间棚屋住2人
  // 雇佣(Phase 1.5)
  HIRE_COST: 5,                     // 安家费:5份食物(鱼优先,谷穗可补)
  PROSPER_PER_WORKER: 15,           // 每位帮工贡献繁荣度
  FARMER_PLOTS: 4,                  // 每位农夫照看4块田
  // 鱼仓(Phase 2.1)
  RATE_BASE: 0.10,                  // 基础利率 10%
  RATE_FLOOR: 0.01, RATE_CEIL: 0.30, // 利率下限/上限(防极端)
  RATE_DENOM: 40,                   // 利率公式分母常数(与 economy.js 对齐)
  // 繁荣度
  PROSPER_PER_POP: 10,
  PROSPER_PER_HUT: 15,
  PROSPER_GRANARY: 30,
  PROSPER_DOCK: 30,
  // 食物保质期(天)
  FISH_SHELF_LIFE: 3,
  GRAIN_SHELF_LIFE: 7,
  ROOT_SHELF_LIFE: 10,
  // 生病机制
  SICK_EAT_EXPIRED_CHANCE: 0.30,    // 吃过期食物生病概率
  SICK_STORM_WORK_CHANCE: 0.20,     // 暴风雨天工作生病概率
  SICK_STARVE_DAYS: 2,              // 饥饿持续天数必定生病
  HERB_HEAL_CHANCE: 0.60,           // 草药治愈概率
  SELF_HEAL_DAYS: 3,                // 自愈天数
  SELF_HEAL_CHANCE: 0.50,           // 自愈概率
  HERB_SPAWN_MIN: 1,                // 每天最少刷新草药
  HERB_SPAWN_MAX: 2,                // 每天最多刷新草药
  // 天气系统
  WEATHER_MIN_DAYS: 2,              // 每种天气最少持续天数
  WEATHER_MAX_DAYS: 3,              // 每种天气最多持续天数
  STORM_TREE_FALL_CHANCE: 0.20,     // 暴风雨吹倒树木概率
  TREE_STUMP_REGROW: 10,            // 树桩重生天数
};
CFG.FISH_RESPAWN = 3; // 每天自然回游

// ---------- 食物保质期系统 ----------
// 计算食物最终保质期(含仓储加成)
export function calcShelfLife(baseLife, g) {
  let life = baseLife;
  if (g.granary > 0) life *= 2;  // 粮仓 ×2
  if (g.dock > 0 && g.savings > 0) life *= 1; // 鱼仓不影响(仅鱼),此处预留
  return Math.floor(life);
}
// 添加食物到库存(带保质期)
export function addFood(g, type, qty) {
  if (qty <= 0) return;
  const baseLife = type === 'fish' ? CFG.FISH_SHELF_LIFE
    : type === 'grain' ? CFG.GRAIN_SHELF_LIFE
    : CFG.ROOT_SHELF_LIFE;
  const life = calcShelfLife(baseLife, g);
  g.foodStock.push({ type, qty, expiresAt: g.day + life });
  // 同步到旧字段(兼容)
  if (type === 'fish') g.fish += qty;
  else if (type === 'grain') g.grain += qty;
  else if (type === 'root') g.root = (g.root || 0) + qty;
}
// 每天结算:过期食物扣除
export function expireFood(g) {
  const ev = [];
  let expiredFish = 0, expiredGrain = 0, expiredRoot = 0;
  for (let i = g.foodStock.length - 1; i >= 0; i--) {
    const batch = g.foodStock[i];
    if (g.day >= batch.expiresAt) {
      if (batch.type === 'fish') { g.fish -= batch.qty; expiredFish += batch.qty; }
      else if (batch.type === 'grain') { g.grain -= batch.qty; expiredGrain += batch.qty; }
      else if (batch.type === 'root') { g.root = Math.max(0, (g.root || 0) - batch.qty); expiredRoot += batch.qty; }
      g.foodStock.splice(i, 1);
    }
  }
  if (expiredFish > 0) ev.push(`🐟 ${expiredFish} 条鱼变质了!`);
  if (expiredGrain > 0) ev.push(`🌾 ${expiredGrain} 份谷穗发霉了!`);
  if (expiredRoot > 0) ev.push(`🥔 ${expiredRoot} 份根茎腐烂了!`);
  return ev;
}
// 获取某种食物的新鲜度百分比(0~1,用于HUD颜色)
export function foodFreshness(g, type) {
  const batches = g.foodStock.filter(b => b.type === type);
  if (batches.length === 0) return 1;
  const baseLife = type === 'fish' ? CFG.FISH_SHELF_LIFE
    : type === 'grain' ? CFG.GRAIN_SHELF_LIFE
    : CFG.ROOT_SHELF_LIFE;
  const life = calcShelfLife(baseLife, g);
  let totalFresh = 0, totalQty = 0;
  for (const b of batches) {
    const remaining = b.expiresAt - g.day;
    totalFresh += (remaining / life) * b.qty;
    totalQty += b.qty;
  }
  return totalQty > 0 ? totalFresh / totalQty : 1;
}

// ---------- 天气系统 ----------
export const WEATHER_TYPES = ['sunny', 'cloudy', 'rainy', 'stormy'];
export const WEATHER_INFO = {
  sunny:   { name: '晴天', icon: '☀️', fishMul: 1.0, cropBonus: 0,   workerMul: 1.0 },
  cloudy:  { name: '阴天', icon: '☁️', fishMul: 1.0, cropBonus: 0,   workerMul: 1.0 },
  rainy:   { name: '雨天', icon: '🌧️', fishMul: 1.0, cropBonus: 1,   workerMul: 0.8 },
  stormy:  { name: '暴风雨', icon: '⛈️', fishMul: 0.5, cropBonus: -1, workerMul: 0.5 },
};
// 天气转换规则:stormy 之后强制 sunny,其余按顺序或随机
const WEATHER_NEXT = {
  sunny:  () => Math.random() < 0.5 ? 'cloudy' : 'rainy',
  cloudy: () => Math.random() < 0.6 ? 'rainy' : 'stormy',
  rainy:  () => Math.random() < 0.5 ? 'stormy' : 'cloudy',
  stormy: () => 'sunny', // 保底:暴风雨后必定晴天
};

export function advanceWeather(g) {
  if (!g.weather) { g.weather = 'sunny'; g.weatherTimer = CFG.WEATHER_MIN_DAYS + Math.floor(Math.random() * (CFG.WEATHER_MAX_DAYS - CFG.WEATHER_MIN_DAYS + 1)); }
  g.weatherTimer--;
  if (g.weatherTimer <= 0) {
    const next = WEATHER_NEXT[g.weather]();
    g.weather = next;
    g.weatherTimer = CFG.WEATHER_MIN_DAYS + Math.floor(Math.random() * (CFG.WEATHER_MAX_DAYS - CFG.WEATHER_MIN_DAYS + 1));
    return WEATHER_INFO[next];
  }
  return null; // 天气未变化
}

// ---------- 生病机制 ----------
export function workerHealthMul(g, role) {
  const h = g.workerHealth[role] || 'ok';
  if (h === 'sick') return 0;
  if (h === 'weak') return 0.25;
  return 1.0;
}
export function checkSickness(g) {
  const ev = [];
  for (const role of ROLES) {
    if (g.workers[role] <= 0) continue;
    const h = g.workerHealth[role];
    if (h === 'sick') {
      g.sickDays[role] = (g.sickDays[role] || 0) + 1;
      if (g.sickDays[role] >= CFG.SELF_HEAL_DAYS) {
        if (Math.random() < CFG.SELF_HEAL_CHANCE) {
          g.workerHealth[role] = 'ok'; g.sickDays[role] = 0;
          ev.push(`💊 ${ROLE_NAME[role]}自愈了!`);
        } else { g.sickDays[role] = 0; }
      }
      continue;
    }
    if (h === 'weak') {
      if (foodTotal(g) > 0) { g.workerHealth[role] = 'ok'; ev.push(`💪 ${ROLE_NAME[role]}吃饱了,恢复正常!`); }
      continue;
    }
    if (g.weather === 'stormy' && Math.random() < CFG.SICK_STORM_WORK_CHANCE) {
      g.workerHealth[role] = 'sick'; g.sickDays[role] = 0;
      ev.push(`🤒 ${ROLE_NAME[role]}暴风雨天工作,生病了!`);
    }
  }
  // 饥饿触发虚弱
  if (foodTotal(g) <= 0) {
    g.starveDays = (g.starveDays || 0) + 1;
    if (g.starveDays >= CFG.SICK_STARVE_DAYS) {
      for (const role of ROLES) {
        if (g.workers[role] > 0 && g.workerHealth[role] === 'ok') {
          g.workerHealth[role] = 'weak';
          ev.push(`😵 ${ROLE_NAME[role]}持续饥饿,进入虚弱状态(效率25%)!`);
        }
      }
    }
  } else { g.starveDays = 0; }
  return ev;
}
export function useHerb(g, role) {
  if (g.herbs <= 0) return { ok: false, msg: '❌ 没有草药了。' };
  if ((g.workerHealth[role] || 'ok') !== 'sick') return { ok: false, msg: `${ROLE_NAME[role]}没有生病。` };
  g.herbs--;
  if (Math.random() < CFG.HERB_HEAL_CHANCE) {
    g.workerHealth[role] = 'ok'; g.sickDays[role] = 0;
    return { ok: true, msg: `🌿 草药生效!${ROLE_NAME[role]}痊愈了!` };
  }
  return { ok: true, msg: `🌿 草药没起效……${ROLE_NAME[role]}还是病着。` };
}

// ---------- 雇佣职业 ----------
export const ROLES = ['fisher', 'farmer', 'woodcutter', 'miner'];
export const ROLE_NAME = { fisher: '渔夫', farmer: '农夫', woodcutter: '樵夫', miner: '采石工' };
export const ROLE_TIP = {
  fisher: '捕鱼四六分成,你拿六成',
  farmer: '自动种收4块田,收谷你拿大头',
  woodcutter: '每天+1木头,管1顿饭',
  miner: '每天+1石头,管1顿饭',
};

export const TIERS = [
  { min: 0, name: '荒岛' },
  { min: 50, name: '小渔村' },
  { min: 120, name: '繁荣渔村' },
  { min: 220, name: '小岛集镇' },
];

export function newGame() {
  return {
    day: 1,
    fish: 0, grain: 0, wood: 0, stone: 0, root: 0,
    hasNet: false,
    baskets: 0,              // 采集篓数量
    // 科技树进度
    hasBoat: false,          // 造船完成
    hasWorkbench: false,     // 工具台完成
    hasWell: false,          // 水井完成
    hasFurnace: false,       // 冶炼炉完成
    hasTrader: false,        // 商船完成
    ironFragments: 0,        // 铁矿石碎片数量
    iron: 0,                 // 铁矿石数量(3碎片合成)
    refinedIron: 0,          // 精炼铁数量
    deepFishCount: 0,        // 深海钓鱼次数(PRD计数器)
    pop: 1,                 // 1 = 只有你自己
    huts: 0, granary: 0, dock: 0,
    craftingDay: false,     // R2 延迟消费:织网当天分心,捕鱼成功率减半(过一天恢复)
    savings: 0,             // 鱼仓储蓄(Phase 2.1)
    interestLast: 0,        // 上一周期结算的利息(供 3D 飘字显示鱼苗数)
    granaryHintShown: false,// 是否已提示过"老岛民建议存鱼"
    workers: { fisher: 0, farmer: 0, woodcutter: 0, miner: 0 },  // 在职帮工
    workerReport: null,     // 昨天帮工给玩家的产出(供3D飘字)
    // 帮工健康: {fisher:'ok'|'sick'|'weak', ...} ok=正常 sick=生病 weak=虚弱
    workerHealth: { fisher: 'ok', farmer: 'ok', woodcutter: 'ok', miner: 'ok' },
    sickDays: { fisher: 0, farmer: 0, woodcutter: 0, miner: 0 },  // 生病天数(自愈计数)
    starveDays: 0,          // 连续饥饿天数(生病触发)
    herbs: 0,               // 草药库存
    crops: [],              // {x,z,age,ready} 由 main 层维护 3D
    prosperity: 0,
    starveStreak: 0,
    events: [],
    // 食物库存(按批次追踪保质期): [{type:'fish'|'grain'|'root', qty:N, expiresAt:day}]
    foodStock: [],
    // 天气系统
    weather: 'sunny',
    weatherTimer: 3,        // 距下次天气变化的天数
  };
}

export function workersTotal(g) { return ROLES.reduce((s, r) => s + g.workers[r], 0); }
export function idleCount(g) { return Math.max(0, g.pop - 1 - workersTotal(g)); }
export function fisherCapital(g) { return g.dock ? 3 : g.hasNet ? 2 : 1; } // 徒手1/网2/码头3
export function marginal(i) { return Math.max(0.5, 1 - 0.1 * (i - 1)); }     // 同职业第i人边际递减

export function prosperityOf(g) {
  return g.pop * CFG.PROSPER_PER_POP + g.huts * CFG.PROSPER_PER_HUT
    + g.granary * CFG.PROSPER_GRANARY + g.dock * CFG.PROSPER_DOCK
    + workersTotal(g) * CFG.PROSPER_PER_WORKER
    + Math.min(50, g.fish + g.grain);
}

export function tierOf(p) {
  let name = TIERS[0].name;
  for (const t of TIERS) if (p >= t.min) name = t.name;
  return name;
}

export function foodTotal(g) {
  // 计算 foodStock 中所有食物的总量(包含根茎)
  return g.foodStock.reduce((sum, b) => sum + b.qty, 0);
}
export function hutCapacity(g) { return g.huts * CFG.HUT_CAPACITY; }
export function canHouse(g) { return g.pop < hutCapacity(g) || g.pop === 1; } // 你自己可以睡沙滩

// ---------- 玩家动作 ----------
export function catchOne(g) {
  const yieldN = CFG.FISH_PER_CATCH[g.dock ? 2 : g.hasNet ? 1 : 0];
  addFood(g, 'fish', yieldN);
  return { ok: true, msg: `捕到 ${yieldN} 条鱼!(徒手×1 / 渔网×2 / 码头×3)` };
}

export function plantCrop(g) {
  if (g.grain < CFG.PLANT_COST) return { ok: false, msg: `❌ 播种需要 ${CFG.PLANT_COST} 份谷穗,先去摘野果丛凑种子。` };
  g.grain -= CFG.PLANT_COST;
  return { ok: true, msg: '播下谷种,3 天后成熟。' };
}

export function harvestCrop(g) {
  addFood(g, 'grain', CFG.CROP_YIELD);
  return { ok: true, msg: `收获 ${CFG.CROP_YIELD} 份谷穗!` };
}

export function canBuild(g, what) {
  const cost = CFG[what + '_COST'];
  if (!cost) return { ok: false, msg: '未知建筑' };
  if (g.wood < cost.wood) return { ok: false, msg: `❌ 木头不够:需要 ${cost.wood},现有 ${g.wood}。去砍树(空格)。` };
  if ((cost.stone || 0) > g.stone) return { ok: false, msg: `❌ 石头不够:需要 ${cost.stone},现有 ${g.stone}。去采石头(空格)。` };
  return { ok: true, cost };
}
function pay(g, cost) { g.wood -= cost.wood; g.stone -= cost.stone || 0; }

export function buildHut(g) {
  const c = canBuild(g, 'HUT'); if (!c.ok) return c;
  pay(g, c.cost);
  g.huts++;
  return { ok: true, msg: `棚屋盖好了!(第 ${g.huts} 间,可住 ${hutCapacity(g)} 人)` };
}
export function buildGranary(g) {
  if (g.granary > 0) return { ok: false, msg: '粮仓已经有啦,一座就够了。' };
  const c = canBuild(g, 'GRANARY'); if (!c.ok) return c;
  pay(g, c.cost);
  g.granary = 1;
  return { ok: true, msg: '粮仓建成!存粮不怕受潮,谷穗能长期保存了。' };
}
export function buildDock(g) {
  if (g.dock > 0) return { ok: false, msg: '码头已经有啦,一座就够了。' };
  const c = canBuild(g, 'DOCK'); if (!c.ok) return c;
  pay(g, c.cost);
  g.dock = 1;
  return { ok: true, msg: '码头建成!以后捕鱼 ×3。' };
}
export function craftNet(g) {
  if (g.hasNet) return { ok: false, msg: '已经有渔网了。' };
  const c = canBuild(g, 'NET'); if (!c.ok) return c;
  pay(g, c.cost);
  g.hasNet = true;
  // R2 延迟消费 = 双成本:既耗木头,当天还要分心编网(捕鱼成功率减半,睡一觉恢复)
  g.craftingDay = true;
  return { ok: true, msg: '渔网编好了!代价是双份:耗了木头,今天还得边编网边分心——捕鱼成功率减半。睡一觉就好,明天起捕鱼 ×2。' };
}
export function buildBasket(g) {
  if (g.baskets >= CFG.BASKET_MAX) return { ok: false, msg: `❌ 采集篓已达上限(${CFG.BASKET_MAX}个)。` };
  const c = canBuild(g, 'BASKET'); if (!c.ok) return c;
  pay(g, c.cost);
  g.baskets++;
  return { ok: true, msg: `采集篓建好了!(第 ${g.baskets}/${CFG.BASKET_MAX} 个,每天自动采集1~2份野生根茎)` };
}

// ---------- 造船/铁器 ----------
// canBuild 支持带 iron 的造价
function canBuildAdv(g, costKey) {
  const cost = CFG[costKey];
  if (!cost) return { ok: false, msg: '未知建筑' };
  if (g.wood < (cost.wood || 0)) return { ok: false, msg: `❌ 木头不够:需要 ${cost.wood},现有 ${g.wood}。` };
  if ((cost.stone || 0) > g.stone) return { ok: false, msg: `❌ 石头不够:需要 ${cost.stone},现有 ${g.stone}。` };
  if ((cost.iron || 0) > (g.iron || 0)) return { ok: false, msg: `❌ 铁矿石不够:需要 ${cost.iron},现有 ${g.iron || 0}。` };
  return { ok: true, cost };
}
function payAdv(g, cost) { g.wood -= (cost.wood || 0); g.stone -= (cost.stone || 0); g.iron = (g.iron || 0) - (cost.iron || 0); }

export function buildBoat(g) {
  if (g.hasBoat) return { ok: false, msg: '已经有船了。' };
  if (!g.dock) return { ok: false, msg: '❌ 需要先建码头。' };
  const c = canBuildAdv(g, 'BOAT_COST'); if (!c.ok) return c;
  payAdv(g, c.cost);
  g.hasBoat = true;
  return { ok: true, msg: '⛵ 船造好了!码头菜单解锁"深海钓鱼"和"出海探索"。' };
}
export function buildWorkbench(g) {
  if (g.hasWorkbench) return { ok: false, msg: '已经有工具台了。' };
  if ((g.iron || 0) < 3) return { ok: false, msg: '❌ 需要 3 个铁矿石(深海钓鱼获得碎片,3个合成1个铁矿石)。' };
  const c = canBuildAdv(g, 'WORKBENCH_COST'); if (!c.ok) return c;
  payAdv(g, c.cost);
  g.hasWorkbench = true;
  return { ok: true, msg: '🔨 工具台建好了!解锁铁器工具。' };
}
export function buildWell(g) {
  if (g.hasWell) return { ok: false, msg: '已经有水井了。' };
  if (!g.hasWorkbench) return { ok: false, msg: '❌ 需要先建工具台。' };
  const c = canBuildAdv(g, 'WELL_COST'); if (!c.ok) return c;
  payAdv(g, c.cost);
  g.hasWell = true;
  return { ok: true, msg: '💧 水井建好了!作物不再受暴风雨影响。' };
}
export function buildFurnace(g) {
  if (g.hasFurnace) return { ok: false, msg: '已经有冶炼炉了。' };
  if (!g.hasWorkbench) return { ok: false, msg: '❌ 需要先建工具台。' };
  const c = canBuildAdv(g, 'FURNACE_COST'); if (!c.ok) return c;
  payAdv(g, c.cost);
  g.hasFurnace = true;
  return { ok: true, msg: '🔥 冶炼炉建好了!可以生产精炼铁。' };
}

// 精炼铁生产(铁矿石 + 木炭)
export function smeltIron(g) {
  if (!g.hasFurnace) return { ok: false, msg: '❌ 需要先建冶炼炉。' };
  if ((g.iron || 0) < 1) return { ok: false, msg: '❌ 没有铁矿石了(深海钓鱼获得碎片合成)。' };
  if (g.wood < 2) return { ok: false, msg: '❌ 需要 2 个木头做木炭。' };
  g.iron -= 1; g.wood -= 2;
  g.refinedIron = (g.refinedIron || 0) + 1;
  return { ok: true, msg: `🔥 精炼成功!消耗 1 铁矿石 + 2 木头 → 精炼铁 ${g.refinedIron} 块。` };
}

// 商船建造
export function buildTrader(g) {
  if (g.hasTrader) return { ok: false, msg: '已经有商船了。' };
  if (!g.hasFurnace) return { ok: false, msg: '❌ 需要先建冶炼炉。' };
  if ((g.refinedIron || 0) < 5) return { ok: false, msg: `❌ 精炼铁不够:需要 5,现有 ${g.refinedIron || 0}。` };
  if (g.wood < 50) return { ok: false, msg: `❌ 木头不够:需要 50,现有 ${g.wood}。` };
  g.refinedIron -= 5; g.wood -= 50;
  g.hasTrader = true;
  return { ok: true, msg: '🚢 商船建好了!可以远洋探索,前往其他岛屿进行贸易。' };
}

// 钢制工具(不需要建筑,有精炼铁就能做)
export function craftSteelTool(g, toolName) {
  if ((g.refinedIron || 0) < 2) return { ok: false, msg: `❌ 需要 2 块精炼铁,现有 ${g.refinedIron || 0}。` };
  g.refinedIron -= 2;
  g.steelTools = g.steelTools || {};
  g.steelTools[toolName] = true;
  return { ok: true, msg: `⚒️ ${toolName}打造完成!(精炼铁 -2)` };
}

// 获取采集/建造效率倍率(含工具加成)
export function getEfficiency(g, type) {
  let mul = 1;
  const tools = g.steelTools || {};
  if (type === 'wood') {
    if (tools['钢斧']) mul *= 4;      // 铁斧×2 × 钢斧×2 = ×4
    else if (g.hasWorkbench) mul *= 2; // 铁斧
  } else if (type === 'stone') {
    if (tools['钢镐']) mul *= 4;
    else if (g.hasWorkbench) mul *= 2;
  } else if (type === 'crop') {
    if (tools['钢锄']) mul *= 2;
    else if (g.hasWorkbench) mul *= 1.5;
  }
  return mul;
}
// PRD 伪随机:每次未获得铁矿石碎片,下次概率递增
export function ironDropChance(count) {
  return Math.min(CFG.IRON_PRD_CAP, CFG.IRON_PRD_BASE + count * CFG.IRON_PRD_STEP);
}
// 深海钓鱼(返回收获信息)
export function deepFish(g) {
  if (!g.hasBoat) return { ok: false, msg: '❌ 需要先造船。' };
  g.deepFishCount = (g.deepFishCount || 0) + 1;
  const chance = ironDropChance(g.deepFishCount);
  const roll = Math.random();
  let result = { ironFragment: 0, fish: 0, msg: '' };
  // 保底:第10次必出
  const guaranteed = g.deepFishCount >= 10;
  if (roll < chance || guaranteed) {
    result.ironFragment = 1;
    g.ironFragments = (g.ironFragments || 0) + 1;
    g.deepFishCount = 0; // 重置PRD计数
  }
  // 额外捕鱼
  const fishAmt = 1 + Math.floor(Math.random() * 2);
  addFood(g, 'fish', fishAmt);
  result.fish = fishAmt;
  // 检查是否够合成铁矿石
  if (g.ironFragments >= CFG.IRON_PER_ORE) {
    g.ironFragments -= CFG.IRON_PER_ORE;
    g.iron = (g.iron || 0) + 1;
    result.msg = `🎣 深海钓鱼:获得 ${fishAmt} 条鱼` + (result.ironFragment ? ' + 1 铁矿石碎片!' : '') + ` (碎片 ${g.ironFragments}/${CFG.IRON_PER_ORE})。碎片足够,自动合成了 1 个铁矿石!(铁矿石:${g.iron})`;
  } else {
    result.msg = `🎣 深海钓鱼:获得 ${fishAmt} 条鱼` + (result.ironFragment ? ' + 1 铁矿石碎片!' : ' (没钓到碎片)') + ` (碎片 ${g.ironFragments}/${CFG.IRON_PER_ORE})`;
  }
  return { ok: true, ...result };
}

// ---------- 鱼仓(Phase 2.1) ----------
// 与 economy.js.interestRate 公式一致(foreignCapital=0 时简化版):r = BASE × 80 / (savings + 40)
// 储蓄少→利率高(鼓励存);储蓄多→利率低(鼓励投);挤出效应待 Phase 2.4 接入 R7 时再加
export function interestRate(g) {
  const r = CFG.RATE_BASE * (80 / (g.savings + CFG.RATE_DENOM));
  return Math.max(CFG.RATE_FLOOR, Math.min(CFG.RATE_CEIL, r));
}
export function depositFish(g, n) {
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: '❌ 至少存 1 条鱼。' };
  n = Math.floor(n);
  if (n > g.fish) return { ok: false, msg: `❌ 库存只有 ${g.fish} 条鱼,不够存。` };
  g.fish -= n; g.savings += n;
  return { ok: true, msg: `🐟 鱼仓收入 ${n} 条(仓内 ${g.savings})。` };
}
export function withdrawFish(g, n) {
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: '❌ 至少取 1 条鱼。' };
  n = Math.floor(n);
  if (n > g.savings) return { ok: false, msg: `❌ 鱼仓只有 ${g.savings} 条鱼,不够取。` };
  g.savings -= n; g.fish += n;
  return { ok: true, msg: `🐟 从鱼仓取出 ${n} 条(仓内剩余 ${g.savings})。` };
}

// ---------- 雇佣 / 解约 ----------
export function hireVillager(g, role) {
  if (!ROLE_NAME[role]) return { ok: false, msg: '未知职业。' };
  if (idleCount(g) <= 0) return { ok: false, msg: '❌ 没有闲着的岛民。先攒余粮+盖棚屋吸引更多人上岛,或先解约一个。' };
  const cost = CFG.HIRE_COST;
  const fishUse = Math.min(g.fish, cost);
  const grainUse = cost - fishUse;   // 鱼不够用谷穗补
  if (g.grain < grainUse) return { ok: false, msg: `❌ 安家费要 ${cost} 份食物(鱼优先、谷穗可补)。现有鱼 ${g.fish} + 谷穗 ${g.grain},还不够。` };
  g.fish -= fishUse; g.grain -= grainUse;
  g.workers[role]++;
  return { ok: true, msg: `🤝 签约!${ROLE_NAME[role]}上岗了(安家费 ${fishUse}鱼${grainUse ? '+' + grainUse + '谷穗' : ''})。${ROLE_TIP[role]}。` };
}
export function dismissVillager(g, role) {
  if (!g.workers[role]) return { ok: false, msg: `❌ 没有在职的${ROLE_NAME[role]}。` };
  g.workers[role]--;
  return { ok: true, msg: `${ROLE_NAME[role]}结账离职,回去当散工(自给自足)。` };
}
// 返回事件数组,供 main 层展示
export function advanceDay(g) {
  const ev = [];
  const idle = idleCount(g);
  const rep = { fisher: 0, farmer: 0, woodcutter: 0, miner: 0 };
  let extraEat = 0; // 需要库存供养的帮工数(收成差的渔夫/农夫/樵夫/采石工)

  // 0. 天气变化
  const weatherChanged = advanceWeather(g);
  if (weatherChanged) {
    ev.push(`${weatherChanged.icon} 天气变为${weatherChanged.name}!`);
  } else {
    ev.push(`${WEATHER_INFO[g.weather].icon} ${WEATHER_INFO[g.weather].name}(还有 ${g.weatherTimer} 天)`);
  }
  const wInfo = WEATHER_INFO[g.weather];

  // 0.5 食物过期结算
  const expireEv = expireFood(g);
  ev.push(...expireEv);

  // 1. 散工觅食(自给自足:每天产1份、吃1份)
  for (let i = 0; i < idle; i++) {
    if (Math.random() < 0.55) addFood(g, 'fish', 1); else addFood(g, 'grain', 1);
  }
  if (idle > 0) ev.push(`散工们觅食自给(${idle} 人,产多少吃多少)`);

  // 1.5 采集篓产出(不受天气影响)
  if (g.baskets > 0) {
    let basketTotal = 0;
    for (let i = 0; i < g.baskets; i++) {
      const amt = CFG.BASKET_MIN_YIELD + Math.floor(Math.random() * (CFG.BASKET_MAX_YIELD - CFG.BASKET_MIN_YIELD + 1));
      addFood(g, 'root', amt);
      basketTotal += amt;
    }
    ev.push(`🧺 采集篓产出 ${basketTotal} 份野生根茎(不受天气影响)`);
  }

  // 2. 帮工产出:樵夫/矿工/农夫 已改为实时结算(Phase 2.1.2,帮工砍树敲石收割时立即入账),
  // 这里只算渔夫(鱼AI 复杂,保留批量)+ 帮工每天的吃饭负担(extraEat)
  if (g.workers.fisher) {
    for (let i = 1; i <= g.workers.fisher; i++) {
      const healthMul = workerHealthMul(g, 'fisher');
      const P = Math.max(1, Math.round(2 * fisherCapital(g) * marginal(i) * wInfo.fishMul * healthMul)); // 产量=2×资本×效率×天气×健康
      const mine = Math.round(P * 0.6);   // 玩家拿六成
      addFood(g, 'fish', mine); rep.fisher += mine;
      if (P < 2) extraEat++;              // 徒手+效率衰减时收成差,渔夫还得吃库存
    }
    const weatherNote = wInfo.fishMul < 1 ? '(暴风雨减产)' : '';
    ev.push(`🎣 渔夫捕鱼:你分得 ${rep.fisher} 条${weatherNote}(四六分成,他自留四成当饭)`);
  }
  if (g.workers.farmer) {
    // 农夫吃饭负担(实时收割时已扣过谷穗,这里只统计吃饭 1 份/天)
    extraEat += g.workers.farmer;
  }
  g.workerReport = rep;

  // 3. 全岛吃饭:玩家1 + 散工(产出已入库)+ 需供养帮工(先吃谷穗后吃鱼,省着鲜货)
  const need = 1 + idle + extraEat;
  let ate = Math.min(g.grain, need);
  g.grain -= ate; let left = need - ate;
  ate += Math.min(g.fish, left); g.fish -= Math.min(g.fish, left);
  left = need - ate;
  if (left > 0) {
    g.starveStreak++;
    ev.push(`⚠️ 粮食不够!缺 ${left} 份,大家饿着肚子(连续第 ${g.starveStreak} 天)`);
    if (g.starveStreak >= 2) {
      const wr = ROLES.find((r) => g.workers[r] > 0);
      if (wr) {
        g.workers[wr]--;
        ev.push(`😢 连续断粮,${ROLE_NAME[wr]}干不下去,散伙回散工了`);
        g.starveStreak = 0;
      } else if (g.pop > 1) {
        g.pop--;
        ev.push('😢 一位岛民饿得划木筏离岛了');
        g.starveStreak = 0;
      }
    }
  } else {
    g.starveStreak = 0;
  }

  // 3.5 生病检查+草药刷新
  const sickEv = checkSickness(g);
  ev.push(...sickEv);
  // 主岛每天刷新草药
  const herbDrop = CFG.HERB_SPAWN_MIN + Math.floor(Math.random() * (CFG.HERB_SPAWN_MAX - CFG.HERB_SPAWN_MIN + 1));
  g.herbs = (g.herbs || 0) + herbDrop;
  if (herbDrop > 0) ev.push(`🌿 发现了 ${herbDrop} 株草药(可用于治疗生病的帮工)`);

  // 4. 鱼仓计息(Phase 2.1)—— 整日结算前最后改 savings,避免吃饭/新岛民逻辑读到旧值
  if (g.savings > 0) {
    const rate = interestRate(g);
    const interest = Math.max(0, Math.floor(g.savings * rate)); // 不足 1 条不冒头(玩家看得到 0 比满屏飘字好)
    g.savings += interest;
    g.interestLast = interest;
    if (interest > 0) ev.push(`🐟 鱼仓生崽了 +${interest} 条小鱼苗(仓内 ${g.savings})`);
  } else g.interestLast = 0;

  // 5. 新岛民上岛(有余粮+有住处才来)
  if (g.pop < CFG.POP_CAP && foodTotal(g) >= g.pop + 2 && g.huts * CFG.HUT_CAPACITY >= g.pop + 1) {
    g.pop++;
    ev.push(`🎉 一位新岛民划着木筏上岛了!(人口 ${g.pop};按 V 可花 5 份食物雇佣帮工)`);
  } else if (g.pop === 1 && g.huts === 0 && foodTotal(g) >= 4 && g.day >= 3) {
    ev.push('💭 有余粮了,但没棚屋……盖间棚屋才会有人愿意上岛。');
  }

  // 6. 作物生长(age=-1 表示荒田,不生长);雨天加速(+1天),暴风雨暂停(不+)
  let ripened = 0;
  for (const c of g.crops) {
    if (!c.ready && c.age >= 0) {
      const grow = 1 + wInfo.cropBonus; // 晴天/阴天=1,雨天=2,暴风雨=0
      if (grow > 0) { c.age += grow; if (c.age >= CFG.CROP_DAYS) { c.ready = true; ripened++; } }
    }
  }
  if (ripened) ev.push(`🌾 ${ripened} 块田的谷子熟了,快去收(空格)!`);
  if (wInfo.cropBonus > 0) ev.push('🌧️ 雨水滋润,作物长得更快了!');
  if (wInfo.cropBonus < 0) ev.push('⛈️ 暴风雨肆虐,作物暂停生长。');

  // 7. 新的一天:织网的分心结束,捕鱼手感恢复
  g.craftingDay = false;

  // 8. 繁荣度
  g.prosperity = prosperityOf(g);
  g.day++;
  return ev;
}

// ---------- 存档 / 读档(Phase 2.1.1) ----------
export function serializeGame(g) {
  return JSON.stringify({
    v: 4,
    day: g.day, fish: g.fish, grain: g.grain, wood: g.wood, stone: g.stone,
    hasNet: g.hasNet, baskets: g.baskets || 0, root: g.root || 0, pop: g.pop, huts: g.huts, granary: g.granary, dock: g.dock,
    craftingDay: g.craftingDay,
    savings: g.savings, interestLast: g.interestLast, granaryHintShown: g.granaryHintShown,
    workers: { ...g.workers }, prosperity: g.prosperity, starveStreak: g.starveStreak,
    weather: g.weather || 'sunny', weatherTimer: g.weatherTimer || 3,
    foodStock: g.foodStock || [],
    workerHealth: g.workerHealth || { fisher: 'ok', farmer: 'ok', woodcutter: 'ok', miner: 'ok' },
    sickDays: g.sickDays || { fisher: 0, farmer: 0, woodcutter: 0, miner: 0 },
    starveDays: g.starveDays || 0,
    herbs: g.herbs || 0,
    hasBoat: g.hasBoat || false, hasWorkbench: g.hasWorkbench || false, hasWell: g.hasWell || false,
    hasFurnace: g.hasFurnace || false, hasTrader: g.hasTrader || false,
    ironFragments: g.ironFragments || 0, iron: g.iron || 0, refinedIron: g.refinedIron || 0,
    deepFishCount: g.deepFishCount || 0,
    steelTools: g.steelTools || {},
  });
}
export function deserializeGame(json) {
  try {
    const d = JSON.parse(json);
    if (!d || typeof d.day !== 'number') return null;
    const g = newGame();
    Object.assign(g, d);
    g.workers = { fisher: 0, farmer: 0, woodcutter: 0, miner: 0, ...(d.workers || {}) };
    return g;
  } catch (err) { return null; }
}
export function hasSave() { try { return !!localStorage.getItem('island.save'); } catch (err) { return false; } }
export function clearSave() { try { localStorage.removeItem('island.save'); } catch (err) { /* 忽略 */ } }
