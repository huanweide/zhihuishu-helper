/**
 * 悬浮控制面板（Shadow DOM 隔离样式）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 12px; }
.mini { width: 44px; height: 44px; border-radius: 50%; background: #185FA5; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  border: none; font-size: 15px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.panel { width: 320px; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 12px;
  overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,.14); display: none; }
.panel.show { display: block; }
.head { padding: 10px 12px; background: #F1EFE8; border-bottom: 1px solid rgba(0,0,0,.1);
  display: flex; align-items: center; justify-content: space-between; }
.head b { font-size: 13px; font-weight: 500; color: #2C2C2A; }
.head .btns button { background: none; border: none; cursor: pointer; color: #5F5E5A;
  font-size: 14px; padding: 2px 6px; }
.tabs { display: flex; border-bottom: 1px solid rgba(0,0,0,.1); background: #fff; }
.tabs button { flex: 1; padding: 8px 0; border: none; background: none; cursor: pointer;
  font-size: 12px; color: #5F5E5A; border-bottom: 2px solid transparent; }
.tabs button.on { color: #185FA5; border-bottom-color: #185FA5; font-weight: 500; }
.body { padding: 12px; max-height: 340px; overflow-y: auto; }
.body .pane { display: none; }
.body .pane.on { display: block; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
.row label { color: #2C2C2A; }
.row .val { color: #888780; font-size: 11px; }
.kv { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed rgba(0,0,0,.08); }
.kv span:first-child { color: #5F5E5A; }
.kv span:last-child { color: #2C2C2A; font-weight: 500; }
.sw { width: 34px; height: 18px; border-radius: 9px; background: #D3D1C7; position: relative;
  cursor: pointer; border: none; transition: background .15s; }
.sw.on { background: #1D9E75; }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: #fff; transition: left .15s; }
.sw.on::after { left: 18px; }
.logs { font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.5; }
.logs div { padding: 1px 0; word-break: break-all; color: #444441; }
.logs .warn { color: #854F0B; }
.logs .error { color: #A32D2D; }
.alert { margin: 0 12px 10px; padding: 7px 9px; border-radius: 6px; font-size: 11px; display: none; }
.alert.warn { background: #FAEEDA; color: #412402; display: block; }
.alert.info { background: #E6F1FB; color: #042C53; display: block; }
.alert.error { background: #FCEBEB; color: #501313; display: block; }
.foot { padding: 8px 12px; border-top: 1px solid rgba(0,0,0,.1); background: #F1EFE8;
  display: flex; gap: 6px; }
.foot button { flex: 1; padding: 6px 0; border: 1px solid rgba(0,0,0,.15); border-radius: 6px;
  background: #fff; cursor: pointer; font-size: 11px; color: #2C2C2A; }
.foot button:hover { background: #F1EFE8; }
.foot button.pri { background: #185FA5; color: #fff; border-color: #185FA5; }
.inp { width: 152px; font-size: 11px; padding: 2px 4px; border: 1px solid rgba(0,0,0,.18);
  border-radius: 4px; background: #fff; color: #2C2C2A; }
.mini-btn { font-size: 10px; padding: 2px 7px; border: 1px solid rgba(0,0,0,.18);
  border-radius: 4px; background: #fff; cursor: pointer; color: #2C2C2A; }
.mini-btn:hover { background: #F1EFE8; }
.mini-btn.ok { background: #E6F4EC; border-color: #1D9E75; color: #0C4A2F; }
.mini-btn.bad { background: #FCEBEB; border-color: #A32D2D; color: #501313; }
.hint { font-size: 10px; color: #888780; padding: 2px 0 6px; line-height: 1.45; }
/* 完成总结弹层 */
.report { margin: 0 12px 10px; padding: 10px 11px; border-radius: 8px; background: #E6F1FB;
  border: 1px solid #B5D4F4; display: none; }
.report.show { display: block; }
.report h4 { margin: 0 0 7px; font-size: 12px; color: #042C53; font-weight: 600; }
.report .line { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; color: #042C53; }
.report .line b { font-weight: 600; }
.report .line span:first-child { color: #185FA5; }
.report .close-rp { margin-top: 7px; width: 100%; padding: 4px 0; font-size: 11px;
  border: 1px solid #185FA5; background: #fff; color: #185FA5; border-radius: 5px; cursor: pointer; }
`;

  const Panel = {
    _root: null,
    _shadow: null,
    _tabs: ['home', 'log', 'cfg'],

    mount() {
      if (this._root && document.contains(this._root)) return;
      const host = document.createElement('div');
      host.id = 'zhs-helper-panel';
      host.style.cssText = 'all:initial';
      this._shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = CSS;
      this._shadow.appendChild(style);

      const box = document.createElement('div');
      box.className = 'wrap';
      box.innerHTML = this._html();
      this._shadow.appendChild(box);

      document.documentElement.appendChild(host);
      this._root = host;

      this._bind(box);
      this.refresh();
      ZHS.Log.debug('控制面板已挂载');
    },

    _html() {
      return `
<button class="mini" title="智慧树助手">智</button>
<div class="panel show">
  <div class="head">
    <b>智慧树助手 v${ZHS.version}</b>
    <div class="btns"><button class="fold" title="收起">—</button></div>
  </div>
  <div class="tabs">
    <button data-tab="home" class="on">状态</button>
    <button data-tab="log">日志</button>
    <button data-tab="cfg">设置</button>
  </div>
  <div class="alert"></div>
  <div class="report"></div>
  <div class="body">
    <div class="pane on" data-pane="home">
      <div class="kv"><span>运行状态</span><span class="s-run">—</span></div>
      <div class="kv"><span>页面版本</span><span class="s-ver">—</span></div>
      <div class="kv"><span>当前课时</span><span class="s-lesson">—</span></div>
      <div class="kv"><span>视频进度</span><span class="s-vprog">—</span></div>
      <div class="kv"><span>课程完成</span><span class="s-cprog">—</span></div>
      <div class="kv"><span>未看完</span><span class="s-undone">—</span></div>
      <div class="kv"><span>未解锁</span><span class="s-locked">—</span></div>
      <div class="kv"><span>已答题数</span><span class="s-ans">0</span></div>
      <div class="kv"><span>本次运行</span><span class="s-uptime">—</span></div>
    </div>
    <div class="pane" data-pane="log">
      <div class="logs"></div>
    </div>
    <div class="pane" data-pane="cfg">
      <div class="row"><label>自动播放</label><button class="sw" data-cfg="autoPlay"></button></div>
      <div class="row"><label>自动下一节</label><button class="sw" data-cfg="autoNext"></button></div>
      <div class="row"><label>跳过已完成</label><button class="sw" data-cfg="skipFinished"></button></div>
      <div class="row"><label>静音</label><button class="sw" data-cfg="mute"></button></div>
      <div class="row"><label>断点续播</label><button class="sw" data-cfg="resume"></button></div>
      <div class="row"><label>倍速</label><input type="range" min="1" max="1.8" step="0.1" data-cfg-num="speed" style="width:100px"><span class="v-speed"></span></div>

      <div style="margin:9px 0 3px;font-size:11px;font-weight:600;color:#185FA5">AI 答题</div>
      <div class="row"><label>自动答题</label><button class="sw" data-cfg="autoAnswer"></button></div>
      <div class="row"><label>答完自动关闭</label><button class="sw" data-cfg="autoCloseDialog"></button></div>
      <div class="row"><label>题库通道</label><button class="sw" data-cfg="bankEnabled"></button></div>
      <div class="row"><label>LLM 通道</label><button class="sw" data-cfg="llmEnabled"></button></div>
      <div class="row"><label>答题模式</label>
        <select class="sel-mode inp">
          <option value="both">双通道</option>
          <option value="bank">仅题库</option>
          <option value="llm">仅LLM</option>
        </select>
      </div>
      <div class="row"><label>题库地址</label><input type="text" class="in-bank inp" placeholder="http://localhost:8060"></div>
      <div class="row"><label>投票次数</label><input type="number" class="in-vote inp" min="1" max="5" style="width:60px"></div>

      <div style="margin:9px 0 3px;font-size:11px;font-weight:600;color:#185FA5">模型接口（OpenAI 兼容）</div>
      <div class="hint">填 Key 后可用任意兼容接口：DeepSeek / 通义 / Kimi / 本地 Ollama 等</div>
      <div class="row"><label>API 地址</label><input type="text" class="in-base inp" placeholder="https://api.deepseek.com"></div>
      <div class="row"><label>模型名</label><input type="text" class="in-model inp" placeholder="deepseek-chat" list="model-list">
        <datalist id="model-list">
          <option value="deepseek-chat"></option>
          <option value="deepseek-reasoner"></option>
          <option value="qwen-plus"></option>
          <option value="moonshot-v1-8k"></option>
        </datalist>
      </div>
      <div class="row"><label>API Key</label><input type="password" class="in-key inp" placeholder="sk-..."></div>
      <div class="row"><label></label>
        <span>
          <button class="mini-btn btn-lmtest">测试连接</button>
          <button class="mini-btn btn-savekey">保存</button>
        </span>
      </div>
      <div class="hint s-keymsg"></div>

      <div class="row"><label>调试日志</label><button class="sw" data-cfg="debug"></button></div>
    </div>
  </div>
  <div class="foot">
    <button class="btn-start pri">启动</button>
    <button class="btn-stop">停止</button>
    <button class="btn-next">下一节</button>
    <button class="btn-answer">答题</button>
  </div>
</div>`;
    },

    _bind(box) {
      const $ = (s) => box.querySelector(s);

      // 折叠/展开
      $('.fold').onclick = () => {
        $('.panel').classList.remove('show');
        $('.mini').style.display = 'flex';
      };
      $('.mini').onclick = () => {
        $('.panel').classList.add('show');
      };

      // 切换 tab
      box.querySelectorAll('.tabs button').forEach((btn) => {
        btn.onclick = () => {
          box.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('on'));
          box.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
          btn.classList.add('on');
          const pane = box.querySelector('.pane[data-pane="' + btn.dataset.tab + '"]');
          if (pane) pane.classList.add('on');
          this.refresh();
        };
      });

      // 开关
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        sw.onclick = () => {
          const key = sw.dataset.cfg;
          const cur = ZHS.config[key];
          ZHS.setConfig({ [key]: !cur });
          ZHS.Log.info('设置 ' + key + ' = ' + !cur);
          this.refresh();
        };
      });

      // 数值
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed) {
        speed.oninput = () => {
          ZHS.setConfig({ speed: Number(speed.value) });
          this.refresh();
          const v = ZHS.Player.video();
          if (v) ZHS.Player.setSpeed(v, Number(speed.value));
        };
      }

      // 答题模式下拉
      const selMode = box.querySelector('.sel-mode');
      if (selMode) {
        selMode.onchange = () => {
          ZHS.setConfig({ answerMode: selMode.value });
          ZHS.Log.info('答题模式 = ' + selMode.value);
        };
      }

      // 题库地址
      const inBank = box.querySelector('.in-bank');
      if (inBank) {
        inBank.onchange = () => {
          ZHS.setConfig({ bankUrl: inBank.value.trim() });
          ZHS.Log.info('题库地址 = ' + inBank.value.trim());
        };
      }

      // LLM Key
      const inKey = box.querySelector('.in-key');
      if (inKey) {
        inKey.onchange = () => {
          ZHS.setConfig({ llmKey: inKey.value.trim() });
          ZHS.Log.info('LLM Key 已' + (inKey.value.trim() ? '设置' : '清空'));
        };
      }

      // API 地址（BaseURL）
      const inBase = box.querySelector('.in-base');
      if (inBase) {
        inBase.onchange = () => {
          const v = inBase.value.trim() || 'https://api.deepseek.com';
          ZHS.setConfig({ llmBaseUrl: v });
          ZHS.Log.info('API 地址 = ' + v);
        };
      }

      // 模型名
      const inModel = box.querySelector('.in-model');
      if (inModel) {
        inModel.onchange = () => {
          const v = inModel.value.trim() || 'deepseek-chat';
          ZHS.setConfig({ llmModel: v });
          ZHS.Log.info('模型 = ' + v);
        };
      }

      // 测试连接
      const btnTest = box.querySelector('.btn-lmtest');
      if (btnTest) {
        btnTest.onclick = async () => {
          // 先把当前输入落盘，再测
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: inKey.value.trim() });

          btnTest.textContent = '测试中…';
          btnTest.className = 'mini-btn btn-lmtest';
          const r = await ZHS.LLM.test();
          btnTest.textContent = r.ok ? '连接正常' : '连接失败';
          btnTest.className = 'mini-btn btn-lmtest ' + (r.ok ? 'ok' : 'bad');
          const msg = box.querySelector('.s-keymsg');
          if (msg) msg.textContent = r.msg;
          ZHS.Log[r.ok ? 'info' : 'warn']('模型连通性：' + r.msg);
        };
      }

      // 保存 Key
      const btnSave = box.querySelector('.btn-savekey');
      if (btnSave) {
        btnSave.onclick = () => {
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: inKey.value.trim() });
          this.alert('模型配置已保存', 'info');
          ZHS.Log.info('模型配置已保存：' + ZHS.config.llmModel + ' @ ' + ZHS.config.llmBaseUrl);
        };
      }

      // 总结弹层关闭
      const closeRp = box.querySelector('.close-rp');
      if (closeRp) {
        closeRp.onclick = () => {
          const rp = box.querySelector('.report');
          if (rp) rp.classList.remove('show');
        };
      }

      // 投票次数
      const inVote = box.querySelector('.in-vote');
      if (inVote) {
        inVote.onchange = () => {
          ZHS.setConfig({ voteTimes: Number(inVote.value) });
        };
      }

      // 底部按钮
      $('.btn-start').onclick = () => ZHS.Scheduler.start();
      $('.btn-stop').onclick = () => ZHS.Scheduler.stop();
      $('.btn-next').onclick = () => ZHS.Scheduler.gotoNext('手动');
      $('.btn-answer').onclick = () => {
        const scene = ZHS.Questions.scene();
        if (scene === 'dialog') ZHS.Answerer.handleDialog();
        else ZHS.Answerer.handleHomework();
        this.alert('已触发答题（场景：' + (scene || '未识别') + '）', 'info');
      };
    },

    /** 刷新面板显示 */
    refresh() {
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;
      const cfg = ZHS.config;
      const $ = (s) => box.querySelector(s);

      // 状态
      const v = ZHS.Player.video();
      $('.s-run').textContent = ZHS.state.running ? '运行中' : '已停止';
      $('.s-ver').textContent = ZHS.state.siteVersion || '未识别';
      $('.s-lesson').textContent = (ZHS.state.lessonKey || '—').slice(0, 16);
      $('.s-vprog').textContent = v ? (ZHS.Player.percent(v) + '% · ' + Math.round(v.currentTime) + 's') : '—';
      const st = ZHS.Catalog.stats();
      $('.s-cprog').textContent = st.done + '/' + st.total + ' (' + st.percent + '%)';

      // 三态明细（N1 需求）
      const bd = ZHS.Catalog.breakdown();
      const undoneEl = $('.s-undone');
      if (undoneEl) {
        undoneEl.textContent = bd.undone + ' 节';
        undoneEl.style.color = bd.undone === 0 ? '#1D9E75' : '#854F0B';
      }
      const lockedEl = $('.s-locked');
      if (lockedEl) lockedEl.textContent = bd.locked + ' 节';

      $('.s-ans').textContent = String(ZHS.state.answeredCount);
      const mins = Math.floor((Date.now() - ZHS.state.startedAt) / 60000);
      $('.s-uptime').textContent = mins + ' 分钟';

      // 开关状态
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        const on = !!cfg[sw.dataset.cfg];
        sw.classList.toggle('on', on);
      });
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed && document.activeElement !== speed) speed.value = String(cfg.speed);
      $('.v-speed').textContent = cfg.speed + 'x';

      // 答题设置回填（避免覆盖用户正在输入的框）
      this._syncInput(box, '.sel-mode', cfg.answerMode);
      this._syncInput(box, '.in-bank', cfg.bankUrl);
      this._syncInput(box, '.in-key', cfg.llmKey);
      this._syncInput(box, '.in-vote', String(cfg.voteTimes));
      this._syncInput(box, '.in-base', cfg.llmBaseUrl);
      this._syncInput(box, '.in-model', cfg.llmModel);
    },

    /**
     * 展示「全部看完」总结报告（N3 需求）
     */
    showReport(report) {
      if (!report) return;
      // 兜底：面板未挂载时先挂载，避免总结报告静默丢失
      if (!this._shadow || !this._root || !document.contains(this._root)) {
        try { this.mount(); } catch (e) { /* 挂载失败则放弃显示 */ }
      }
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;
      const rp = box.querySelector('.report');
      if (!rp) return;

      const rows = [
        ['课程', report.课程名],
        ['页面版本', report.页面版本],
        ['完成情况', report.已完成 + ' / ' + report.总节点 + '（' + report.完成度 + '）'],
        ['未看完', report.未完成 + ' 节'],
        ['未解锁', report.未解锁 + ' 节'],
        ['本次切换课时', report.本次切换课时数 + ' 次'],
        ['已答题数', report.已答题数 + ' 题'],
        ['答题通道', report.答题通道],
        ['总耗时', report.总耗时],
        ['结束时间', report.结束时间],
      ];

      // 标题按真实结果动态判定：不能只有 25% 完成度还写「全部看完」
      const allDone = Number(report.未完成) === 0 && Number(report.总节点) > 0
        && Number(report.已完成) >= Number(report.总节点);
      const head = allDone ? '全部课程已看完' : '运行已结束（仍有未完成课程）';
      const headColor = allDone ? '#042C53' : '#854F0B';

      rp.innerHTML = '<h4 style="color:' + headColor + '">' + this._esc(head) + '</h4>'
        + rows.map(([k, v]) => '<div class="line"><span>' + k + '</span><b>' + this._esc(String(v)) + '</b></div>').join('')
        + '<button class="close-rp">知道了</button>';
      rp.classList.add('show');

      const btn = rp.querySelector('.close-rp');
      if (btn) btn.onclick = () => rp.classList.remove('show');

      // 切到状态页让用户看到
      box.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'home'));
      box.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === 'home'));
    },

    /** 只在值不同且未聚焦时同步输入框 */
    _syncInput(box, sel, val) {
      const el = box.querySelector(sel);
      if (!el) return;
      if (el === (this._shadow && this._shadow.activeElement)) return;
      if (String(el.value) !== String(val)) el.value = val;
    },

    /** 日志更新回调 */
    onLog() {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const pane = box.querySelector('.pane[data-pane="log"]');
      if (!pane || !pane.classList.contains('on')) return;   // 只在日志页刷新
      this._renderLogs(box);
    },

    _renderLogs(box) {
      const el = box.querySelector('.logs');
      if (!el) return;
      const list = ZHS.Log.all().slice(-80);
      el.innerHTML = list.map((e) => {
        const time = new Date(e.t).toTimeString().slice(0, 8);
        const cls = e.level === 'warn' ? 'warn' : (e.level === 'error' ? 'error' : '');
        return '<div class="' + cls + '">' + time + ' ' + this._esc(e.text) + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    },

    _esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    /** 顶部提示条 */
    alert(msg, type) {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const el = box.querySelector('.alert');
      el.className = 'alert ' + (type || 'info');
      el.textContent = msg;
      clearTimeout(this._alertTimer);
      this._alertTimer = setTimeout(() => { el.className = 'alert'; }, 8000);
    },
  };

  // 面板每 1.5 秒自刷新
  setInterval(() => Panel.refresh(), 1500);

  ZHS.panel = Panel;
})();
