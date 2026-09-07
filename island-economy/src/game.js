// game.js — 荒岛养成状态机(Phase 1: 纯养成闭环)
// 定位:表层的"玩家在玩的养成"逻辑;底层小岛经济学(economy.js)作为隐藏引擎 Phase 2 再接入。

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
  NET_COST: { wood: 2, fiber: 0 },  // 渔网用木头编(也可以改吃鱼成本)
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
    fish: 0, grain: 0, wood: 0, stone: 0,
    hasNet: false,
    pop: 1,                 // 1 = 只有你自己
    huts: 0, granary: 0, dock: 0,
    craftingDay: false,     // R2 延迟消费:织网当天分心,捕鱼成功率减半(过一天恢复)
    savings: 0,             // 鱼仓储蓄(Phase 2.1)
    interestLast: 0,        // 上一周期结算的利息(供 3D 飘字显示鱼苗数)
    granaryHintShown: false,// 是否已提示过"老岛民建议存鱼"
    workers: { fisher: 0, farmer: 0, woodcutter: 0, miner: 0 },  // 在职帮工
    workerReport: null,     // 昨天帮工给玩家的产出(供3D飘字)
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

export function foodTotal(g) { return g.fish + g.grain; }
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

  // 2. 帮工产出:樵夫/矿工/农夫 已改为实时结算(Phase 2.1.2,帮工砍树敲石收割时立即入账),
  // 这里只算渔夫(鱼AI 复杂,保留批量)+ 帮工每天的吃饭负担(extraEat)
  if (g.workers.fisher) {
    for (let i = 1; i <= g.workers.fisher; i++) {
      const P = Math.max(1, Math.round(2 * fisherCapital(g) * marginal(i) * wInfo.fishMul)); // 产量=2×资本×效率×天气
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
    hasNet: g.hasNet, pop: g.pop, huts: g.huts, granary: g.granary, dock: g.dock,
    craftingDay: g.craftingDay,
    savings: g.savings, interestLast: g.interestLast, granaryHintShown: g.granaryHintShown,
    workers: { ...g.workers }, prosperity: g.prosperity, starveStreak: g.starveStreak,
    weather: g.weather || 'sunny', weatherTimer: g.weatherTimer || 3,
    foodStock: g.foodStock || [],
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
