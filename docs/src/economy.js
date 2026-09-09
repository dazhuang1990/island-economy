// 小岛经济学 · 经济模型
// 数值与规则严格对齐 skill: xiaodao-economics (R1~R6)
// 鱼 = 货币 + 食物（双属性）。所有机制都从这里驱动 UI 与剧情。

export const CFG = {
  HAND_YIELD: 1,     // R1 徒手日产量
  NET_YIELD: 2,      // R3 有网日产量（翻倍）
  NET_COST: 1,       // R2 织网成本（牺牲当天捕鱼 = 延迟消费）
  BASE_RATE: 0.10,   // R4 基础利率
  EAT_PER_DAY: 1,    // 每天吃掉 1 条鱼存活
  PRINT_STEP: 6,     // 每次印鱼票增发数量
  BREAK_PEGB: 1.5,   // R6 鱼票/真鱼 > 此值 → 鱼本位破灭警告
  // R7 棚屋泡沫
  HUT_BASE: 10,        // 棚屋基准价（鱼）
  DOWN_NORMAL: 0.2,    // 无担保押鱼两成
  DOWN_GSE: 0,         // 岛主担保 → 零押鱼
  MORT_NORMAL: 0.08,   // 普通赊棚利息基准
  MORT_GSE: 0.04,      // 岛主担保赊棚利息（减半）
  PAY_RATIO: 0.15,     // 每日还款占本金比例
  MISS_LIMIT: 3,       // 连续还不上鱼次数 → 收走棚屋
  // R7 房价涨幅节奏（2026-09-03 决策：周期跳涨，便于玩家感知）
  HUT_RISE_CYCLE: 3,   // 每 3 天跳涨一次（每天涨 1% 玩家察觉不到，一次跳 10% 才有因果感）
  HUT_RISE_BASE: 0.10, // 每周期基础涨幅 10%
  CRASH_RATIO: 20,     // 棚价/日捕 > 20 天收成 → 崩盘（书中：花年收入一二十倍买房）
  CRASH_DROP: 0.45,    // 崩盘后棚价热度残留（暴跌 55%）
  RECOVER_RATIO: 10,   // 棚价回落至此以下 → 热度退去，可重新累积（崩盘后约为 9~9.5，需能复位）
  ECON_BASE: 20,       // 整岛基础真实产出（其他岛民的真鱼）：物价分母，防个体破产致物价爆炸
  // R8 邻岛（贸易方/回借）
  TRADE_FISH: 1,           // 每日进口便宜鱼（消费替代生产）
  TRADE_FLOW: 5,           // 每日回借流入（邻岛用鱼票储备回流）
  RATE_FC_WEIGHT: 1.5,     // 回借对利息的压制权重
  CONFIDENCE_TRIGGER: 1.3, // 物价指数超过此值 → 邻岛怕鱼票毛了
  WITHDRAW_STEP: 10,       // 每日抽走回借额度
};

export class Economy {
  constructor() {
    this.reset();
  }

  reset() {
    this.day = 1;
    this.fish = 0;          // 玩家库存真鱼（货币+食物）
    this.savings = 0;       // 银行储蓄（真鱼）
    this.hasNet = false;    // 是否拥有渔网（资本）
    this.catchLeft = CFG.HAND_YIELD; // 今日剩余可捕量
    this.moneySupply = 0;   // 鱼票（法币）总量
    this.starveDays = 0;    // 连续挨饿天数
    this.log = [];
    // R7 棚屋泡沫状态
    this.huts = 0;              // 拥有棚屋数
    this.mortgage = 0;          // 房贷本金余额
    this.mortgageRate = CFG.MORT_NORMAL;
    this.housingIndex = 1;      // 房价泡沫指数（1 = 基准）
    this.housingTimer = 0;      // 距下次跳涨还剩几天
    this.gseOn = false;         // 「两棚」政府担保开关
    this.missedPay = 0;         // 连续断供次数
    this.crashed = false;       // 泡沫已崩（冷却中）
    // R8 中岛帝国状态
    this.tradeOn = false;       // 是否开通贸易
    this.foreignCapital = 0;    // 外资余额（中岛帝国回流买债券的鱼票）
    this._syncMoney();
  }

  // 真实鱼总量 = 流通中的真鱼（库存 + 储蓄）
  get realFish() { return this.fish + this.savings; }

  // 整岛真实产出 = 其他岛民基础产出 + 玩家侧真鱼（通胀/币值的分母）
  get totalReal() { return CFG.ECON_BASE + this.realFish; }

  _syncMoney() {
    // 初始鱼票与整岛真鱼 1:1 锚定（鱼本位健康期）；真实产出增长时货币同步增发（非通胀）
    if (this.moneySupply < this.totalReal) this.moneySupply = this.totalReal;
  }

  // R1/R3 捕鱼：受当日额度限制
  catchFish() {
    if (this.catchLeft <= 0) {
      return { ok: false, msg: '今天的可捕额度已用完，推进一天再来。' };
    }
    const yield_ = this.hasNet ? CFG.NET_YIELD : CFG.HAND_YIELD;
    this.fish += yield_;
    this.catchLeft -= 1;
    this._syncMoney();
    return { ok: true, msg: `捕到 ${yield_} 条鱼（${this.hasNet ? '有网×2' : '徒手'}）。`, gained: yield_ };
  }

  // R2 织网：延迟消费，用 1 条鱼换来资本
  buildNet() {
    if (this.hasNet) return { ok: false, msg: '你已经拥有渔网了。' };
    if (this.fish < CFG.NET_COST) return { ok: false, msg: `织网需要 ${CFG.NET_COST} 条鱼作材料，先去捕鱼。` };
    this.fish -= CFG.NET_COST;
    this.hasNet = true;
    this.catchLeft = CFG.NET_YIELD; // 拥有网后当日额度立即提升
    return { ok: true, msg: '你牺牲了一天的口粮，织出了渔网！从此生产力翻倍。' };
  }

  // R4 储蓄：把真鱼存入银行计息
  deposit(n) {
    n = Math.min(Math.floor(n), this.fish);
    if (n <= 0) return { ok: false, msg: '没有可存的鱼。' };
    this.fish -= n; this.savings += n;
    return { ok: true, msg: `存入 ${n} 条鱼，放进鱼仓生息。` };
  }

  withdraw(n) {
    n = Math.min(Math.floor(n), this.savings);
    if (n <= 0) return { ok: false, msg: '鱼仓里没有你的鱼。' };
    this.savings -= n; this.fish += n;
    return { ok: true, msg: `从鱼仓取出 ${n} 条鱼。` };
  }

  // R4/R8 利率：随储蓄稀缺度浮动；外资流入进一步压低利率（资本供给增加）
  get interestRate() {
    let r = CFG.BASE_RATE * (80 / (this.savings + this.foreignCapital * CFG.RATE_FC_WEIGHT + 40));
    // R7 挤出效应：楼市越热，银行越偏爱棚屋抵押贷款 → 实体储蓄回报被压低
    if (this.housingIndex > 1.2) r *= 0.6;
    return Math.max(0.01, Math.min(0.30, r));
  }

  // R5/R6 印鱼票：只增法币，不增真鱼 → 通胀
  printMoney(n = CFG.PRINT_STEP) {
    this.moneySupply += n;
    return { ok: true, msg: `印鱼坊又印了 ${n} 张鱼票，岛上的真鱼一条没多……` };
  }

  // 通胀指数 = 鱼票 / 整岛真实产出；1.0 为健康
  get priceIndex() {
    return this.moneySupply / Math.max(1, this.totalReal);
  }
  // 购买力 = 整岛真鱼 / 鱼票
  get purchasingPower() {
    return this.totalReal / Math.max(1, this.moneySupply);
  }
  get inflationPct() {
    return Math.round((this.priceIndex - 1) * 100);
  }
  get pegBroken() {
    return this.priceIndex > CFG.BREAK_PEGB;
  }

  // R7 棚屋标价 = 基准价 × 通胀指数 × 房价泡沫指数
  get hutPrice() {
    return Math.max(1, Math.round(CFG.HUT_BASE * this.priceIndex * this.housingIndex));
  }
  get dailyIncome() { return this.hasNet ? CFG.NET_YIELD : CFG.HAND_YIELD; }
  get priceToIncome() { return this.hutPrice / this.dailyIncome; }

  // ---------- R7 棚屋泡沫 ----------
  toggleGSE() {
    this.gseOn = !this.gseOn;
    this.mortgageRate = this.gseOn ? CFG.MORT_GSE : CFG.MORT_NORMAL;
    return { ok: true, msg: this.gseOn
      ? '🏛️ 岛主为你作保：零押鱼、赊棚利息减半，什么人都能来赊棚了！'
      : '🏛️ 岛主不再作保：恢复两成押鱼与平常的赊棚利息。' };
  }

  // ---------- R8 中岛帝国贸易 ----------
  toggleTrade() {
    this.tradeOn = !this.tradeOn;
    return { ok: true, msg: this.tradeOn
      ? '🚢 与邻岛通商：每天捎来便宜鱼 +1，邻岛把挣的鱼票回借给我们，借鱼利息更低了。'
      : '🚢 停了通商：邻岛抽走回借的鱼，借鱼利息回升，便宜鱼也没了。' };
  }

  buyHut() {
    const price = this.hutPrice;
    const down = this.gseOn ? 0 : Math.ceil(price * CFG.DOWN_NORMAL);
    if (this.fish < down) return { ok: false, msg: `押鱼要 ${down} 条（岛主作保可零押鱼），先攒鱼。` };
    this.fish -= down;
    this.mortgage += price - down;
    this.mortgageRate = this.gseOn ? CFG.MORT_GSE : CFG.MORT_NORMAL;
    this.huts += 1;
    return { ok: true, msg: `押鱼 ${down} 条 + 赊账 ${price - down}，赊来一间棚屋（棚价 ${price} 鱼）。` };
  }

  sellHut() {
    if (this.huts <= 0) return { ok: false, msg: '你还没有棚屋。' };
    const proceeds = this.hutPrice;
    this.huts -= 1;
    if (proceeds >= this.mortgage) {
      const net = proceeds - this.mortgage;
      this.mortgage = 0;
      this.fish += net;
      return { ok: true, msg: `卖棚得 ${proceeds} 条鱼，还清赊账后净赚 ${net} 条。` };
    }
    // 资不抵债：倒贴
    const gap = this.mortgage - proceeds;
    const pay = Math.min(gap, this.fish + this.savings);
    this._takeFish(pay);
    this.mortgage = gap - pay;
    return { ok: true, msg: `卖棚只换回 ${proceeds} 条鱼，不够还赊账，倒贴 ${pay} 条！仍欠 ${this.mortgage} 条。` };
  }

  // 依次从库存/储蓄扣鱼
  _takeFish(n) {
    const fromFish = Math.min(this.fish, n);
    this.fish -= fromFish;
    this.savings = Math.max(0, this.savings - (n - fromFish));
  }

  // 推进一天：吃鱼 + 计息 + 重置捕捞额度
  advanceDay() {
    const eaten = Math.min(CFG.EAT_PER_DAY, this.fish + this.savings);
    if (this.fish >= CFG.EAT_PER_DAY) {
      this.fish -= CFG.EAT_PER_DAY;
      this.starveDays = 0;
    } else if (this.fish + this.savings >= CFG.EAT_PER_DAY) {
      // 库存不够就从储蓄扣
      const need = CFG.EAT_PER_DAY - this.fish;
      this.fish = 0; this.savings -= need; this.starveDays = 0;
    } else {
      this.starveDays += 1;
      this.fish = 0;
    }
    // 计息
    const interest = this.savings * this.interestRate;
    this.savings += interest;

    const events = [];

    // R7 房价动态：每 HUT_RISE_CYCLE 天跳涨一次（周期跳涨，玩家看得见）
    // 基础 10%/周期；岛主担保/已有赊账/通商/通胀都会让涨得更凶
    this.housingTimer += 1;
    if (this.housingTimer >= CFG.HUT_RISE_CYCLE) {
      this.housingTimer = 0;
      const g = CFG.HUT_RISE_BASE
        + (this.gseOn ? 0.06 : 0)
        + (this.mortgage > 0 ? 0.04 : 0)
        + (this.tradeOn ? 0.03 : 0)
        + 0.03 * Math.max(0, this.priceIndex - 1);
      if (!this.crashed) {
        this.housingIndex *= 1 + g;
        events.push(`🏠 棚价又涨了 +${Math.round(g * 100)}%（热度 ×${this.housingIndex.toFixed(2)}）`);
      }
    }

    // R8 中岛帝国贸易：便宜进口替代生产 + 外资回流
    if (this.tradeOn) {
      this.fish += CFG.TRADE_FISH;
      this.foreignCapital += CFG.TRADE_FLOW;
      if (this.priceIndex > CFG.CONFIDENCE_TRIGGER) {
        this.foreignCapital = Math.max(0, this.foreignCapital - CFG.WITHDRAW_STEP);
        events.push(`😰 物价 +${this.inflationPct}%，邻岛怕鱼票毛了，抽走回借的鱼 ${CFG.WITHDRAW_STEP}（剩 ${this.foreignCapital}）`);
      }
      events.push(`🚢 邻岛商船到港：捎来便宜鱼 +${CFG.TRADE_FISH}，回借给我们 +${CFG.TRADE_FLOW}`);
    } else if (this.foreignCapital > 0) {
      // 贸易中断 → 邻岛不再回流鱼票，外资逐步撤离，利率回升
      this.foreignCapital = Math.max(0, this.foreignCapital - CFG.WITHDRAW_STEP);
      if (this.foreignCapital === 0) events.push('📦 邻岛回借的鱼全抽走了，借鱼利息重新由存鱼多少说了算。');
    }

    // R7 每日还贷
    if (this.mortgage > 0) {
      const pay = Math.max(1, Math.round(this.mortgage * CFG.PAY_RATIO));
      if (this.fish + this.savings >= pay) {
        this._takeFish(pay);
        this.mortgage = Math.max(0, this.mortgage - Math.round(pay * 0.6)); // 6成还本 4成付息
        this.missedPay = 0;
      } else {
        this.missedPay += 1;
        this.mortgage = Math.round(this.mortgage * (1 + this.mortgageRate * 0.3)); // 欠款滚息
        events.push(`⚠️ 还不上鱼（${this.missedPay}/${CFG.MISS_LIMIT}次）：差 ${pay} 条，赊账滚到 ${this.mortgage}`);
        if (this.missedPay >= CFG.MISS_LIMIT) {
          if (this.huts > 0) {
            this.huts -= 1; this.mortgage = 0;
            events.push('🏚️ 接连还不上鱼，鱼仓把棚屋收走了！');
          } else {
            events.push('💸 没有棚屋可收，欠的鱼还在。');
          }
          this.missedPay = 0;
        }
      }
    }

    // R7 泡沫崩盘判定：房价收入比突破临界（书中：花年收入一二十倍买房）
    if (!this.crashed && this.priceToIncome > CFG.CRASH_RATIO) {
      const ratio = Math.round(this.priceToIncome);
      this.crashed = true;
      this.housingIndex *= CFG.CRASH_DROP;
      this.gseOn = false;
      this.mortgageRate = CFG.MORT_NORMAL;
      events.push(`💥 棚价崩了！一间棚要捕 ${ratio} 天鱼才换得来，没人接得动，棚价一天暴跌 55%！`);
      if (this.huts > 0 && this.mortgage > this.huts * this.hutPrice) {
        events.push('🫠 你欠的鱼比棚屋还值钱——白干还要倒贴！');
      }
    } else if (this.crashed && this.priceToIncome < CFG.RECOVER_RATIO) {
      this.crashed = false;
      events.push('🌤️ 棚价回到合理水平，热度退了。');
    }

    this.day += 1;
    this.catchLeft = this.hasNet ? CFG.NET_YIELD : CFG.HAND_YIELD;
    this._syncMoney();
    return {
      ok: true,
      starved: this.starveDays > 0,
      interest: Math.round(interest * 10) / 10,
      events,
    };
  }
}
