/**
 * 统计层：答题记录 + 学习时长（M8）
 *
 * 目标：让面板能回答两个用户真正会问的问题——
 *   ① 「今天答了几道题？答案都是哪来的（题库 / 模型）？」
 *   ② 「今天学了多久？习惯分进度到哪了？」
 *
 * 设计取舍：
 *  - 只存**明细最近 N 条 + 按天聚合**，不无限增长，避免 localStorage 被撑爆
 *    （油猴脚本跑几个月不清理是很常见的，膨胀会拖慢整站）。
 *  - 所有写入都吞异常：统计是锦上添花，**绝不能因为统计失败影响答题主流程**。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod14_stats) return;
  ZHS.__mod14_stats = true;

  const KEY = 'zhs_helper_stats';
  const DAY_MS = 86400000;
  // 明细上限：超过就丢最早的。200 条足够回看近期作答，又不至于撑爆存储。
  const MAX_RECORDS = 200;
  // 平台规则：每天学满 30 分钟得 1 分习惯分（README 4.4 节实测结论）
  const HABIT_MINUTE = 30 * 60 * 1000;

  function dayKey(ts) {
    const d = new Date(ts || Date.now());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : null;
      return (d && typeof d === 'object') ? d : {};
    } catch (e) {
      return {};   // 存储损坏/被禁用时当作空数据，绝不让统计拖垮主流程
    }
  }

  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 配额满/隐私模式：静默放弃 */ }
  }

  const Stats = {
    _data: null,

    _ensure() {
      if (!this._data) {
        this._data = load();
        if (!this._data.days) this._data.days = {};
        if (!Array.isArray(this._data.records)) this._data.records = [];
      }
      return this._data;
    },

    _day(ts) {
      const d = this._ensure();
      const k = dayKey(ts);
      if (!d.days[k]) d.days[k] = { answered: 0, bank: 0, llm: 0, skipped: 0, studyMs: 0 };
      return d.days[k];
    },

    /**
     * 记录一次作答。
     * @param {string} title  题干（只存前 60 字，长题干没意义且占空间）
     * @param {object} result solve() 的返回：{answer, from, confidence}
     */
    record(title, result) {
      try {
        const d = this._ensure();
        const day = this._day(Date.now());
        const from = (result && result.from) || '';

        if (result && result.answer) {
          day.answered++;
          if (from.indexOf('bank') === 0) day.bank++;
          else if (from === 'llm') day.llm++;
        } else {
          day.skipped++;
        }

        d.records.push({
          t: Date.now(),
          q: String(title || '').slice(0, 60),
          a: (result && result.answer) || '',
          from: from,
        });
        if (d.records.length > MAX_RECORDS) d.records.splice(0, d.records.length - MAX_RECORDS);

        save(d);
      } catch (e) { /* 统计失败不影响答题 */ }
    },

    /** 累加学习时长（毫秒） */
    addStudyTime(ms) {
      try {
        const n = Number(ms) || 0;
        if (n <= 0) return;
        this._day(Date.now()).studyMs += n;
        save(this._ensure());
      } catch (e) { /* 同上 */ }
    },

    /** 今日概要 */
    summary() {
      try {
        const d = this._ensure();
        const today = d.days[dayKey(Date.now())] || { answered: 0, bank: 0, llm: 0, skipped: 0, studyMs: 0 };
        let totalAnswered = 0;
        let activeDays = 0;
        for (const k of Object.keys(d.days)) {
          const v = d.days[k];
          totalAnswered += (v.answered || 0);
          if ((v.answered || 0) > 0 || (v.studyMs || 0) > 0) activeDays++;
        }
        return {
          today,
          todayHabitDone: Math.floor((today.studyMs || 0) / HABIT_MINUTE),
          todayHabitRemainMs: HABIT_MINUTE - ((today.studyMs || 0) % HABIT_MINUTE),
          totalAnswered,
          activeDays,
          recent: (d.records || []).slice(-10).reverse(),
        };
      } catch (e) {
        return { today: { answered: 0, bank: 0, llm: 0, skipped: 0, studyMs: 0 }, todayHabitDone: 0, todayHabitRemainMs: HABIT_MINUTE, totalAnswered: 0, activeDays: 0, recent: [] };
      }
    },

    /** 清空统计（面板「清空记录」用） */
    reset() {
      this._data = { days: {}, records: [] };
      save(this._data);
    },

    /** 供测试与调试：不持久化地直接读取 */
    _dayKey: dayKey,
  };

  ZHS.Stats = Stats;
})();
