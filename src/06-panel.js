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
  <div class="body">
    <div class="pane on" data-pane="home">
      <div class="kv"><span>运行状态</span><span class="s-run">—</span></div>
      <div class="kv"><span>页面版本</span><span class="s-ver">—</span></div>
      <div class="kv"><span>当前课时</span><span class="s-lesson">—</span></div>
      <div class="kv"><span>视频进度</span><span class="s-vprog">—</span></div>
      <div class="kv"><span>课程完成</span><span class="s-cprog">—</span></div>
      <div class="kv"><span>已答题数</span><span class="s-ans">0</span></div>
      <div class="kv"><span>本次运行</span><span class="s-uptime">—</span></div>
    </div>
    <div class="pane" data-pane="log">
      <div class="logs"></div>
    </div>
    <div class="pane" data-pane="cfg">
      <div class="row"><label>自动播放</label><button class="sw" data-cfg="autoPlay"></button></div>
      <div class="row"><label>自动下一节</label><button class="sw" data-cfg="autoNext"></button></div>
      <div class="row"><label>静音</label><button class="sw" data-cfg="mute"></button></div>
      <div class="row"><label>断点续播</label><button class="sw" data-cfg="resume"></button></div>
      <div class="row"><label>AI 自动答题</label><button class="sw" data-cfg="autoAnswer"></button></div>
      <div class="row"><label>倍速</label><input type="range" min="1" max="1.8" step="0.1" data-cfg-num="speed" style="width:110px"><span class="v-speed"></span></div>
      <div class="row"><label>调试日志</label><button class="sw" data-cfg="debug"></button></div>
    </div>
  </div>
  <div class="foot">
    <button class="btn-start pri">启动</button>
    <button class="btn-stop">停止</button>
    <button class="btn-next">下一节</button>
    <button class="btn-clear">清续播</button>
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

      // 底部按钮
      $('.btn-start').onclick = () => ZHS.Scheduler.start();
      $('.btn-stop').onclick = () => ZHS.Scheduler.stop();
      $('.btn-next').onclick = () => ZHS.Scheduler.gotoNext('手动');
      $('.btn-clear').onclick = () => ZHS.Resume.clear(ZHS.state.courseId);
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
