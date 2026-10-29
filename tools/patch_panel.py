# -*- coding: utf-8 -*-
import io

src_path = r'C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper\src\06-panel.js'
src = open(src_path, encoding='utf-8').read()

def rep(s, old, new):
    assert old in s, 'NOT FOUND: ' + old[:70]
    return s.replace(old, new, 1)

# 1. QR base64 常量（顶部）
src = rep(src, "  const U = ZHS.Util;\n",
          "  const U = ZHS.Util;\n  const ZHS_QR_B64 = \"" + b64 + "\";\n")

# 2. 正文字号放大到更舒适尺寸
src = rep(src, 'sans-serif; font-size: 12px; }', 'sans-serif; font-size: 14px; }')
src = rep(src, 'font-size: 12px; color: #5F5E5A;', 'font-size: 13px; color: #5F5E5A;')
src = rep(src, 'color: #888780; font-size: 11px;', 'color: #888780; font-size: 12px;')
src = rep(src, 'Consolas, monospace; font-size: 11px; line-height: 1.5;',
          'Consolas, monospace; font-size: 12px; line-height: 1.6;')
src = rep(src, 'border-radius: 6px; font-size: 11px; display: none;',
          'border-radius: 6px; font-size: 12px; display: none;')
src = rep(src, 'background: #fff; cursor: pointer; font-size: 11px; color: #2C2C2A;',
          'background: #fff; cursor: pointer; font-size: 12px; color: #2C2C2A;')
src = rep(src, 'color: #888780; padding: 2px 0 6px; line-height: 1.45; }',
          'color: #888780; padding: 2px 0 6px; line-height: 1.6; }')
src = rep(src, 'justify-content: space-between; font-size: 11px; padding: 2px 0; color: #042C53;',
          'justify-content: space-between; font-size: 12px; padding: 2px 0; color: #042C53;')
src = rep(src, 'font-size: 13px; font-weight: 600; color: #fff;',
          'font-size: 14px; font-weight: 600; color: #fff;')
src = rep(src, 'color: #042C53; font-size: 11px; line-height: 1.8;',
          'color: #042C53; font-size: 12px; line-height: 1.8;')
src = rep(src, 'margin: 0 0 8px; font-size: 12px; color: #042C53;',
          'margin: 0 0 8px; font-size: 13px; color: #042C53;')
src = rep(src, 'margin: 0 0 7px; font-size: 12px; color: #042C53; font-weight: 600; }',
          'margin: 0 0 7px; font-size: 13px; color: #042C53; font-weight: 600; }')
src = rep(src, 'margin: 10px 0 3px; font-size: 11px; font-weight: 600; color: #185FA5;',
          'margin: 10px 0 3px; font-size: 12px; font-weight: 600; color: #185FA5;')

# 3. about 区块 CSS
about_css = '''
.about { padding: 11px 12px; border-top: 1px dashed rgba(0,0,0,.12); background: #FBFBF9; }
.about-head { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; }
.retri { font-weight: 800; font-size: 15px; letter-spacing: .5px;
  background: linear-gradient(135deg,#FFD56B,#FF8A3D); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.about-sub { font-size: 11px; color: #888780; }
.about-link { display: block; padding: 8px 10px; margin: 5px 0; border-radius: 8px;
  background: #E6F1FB; color: #042C53; text-decoration: none; font-size: 12px; font-weight: 600; }
.about-link:hover { background: #D2E6FA; }
.sf-box { margin-top: 9px; }'''
src = rep(src, ':host { all: initial; }', ':host { all: initial; }' + about_css)

# 4. about 区块 HTML（foot 之后）
about_html = '''
  <div class="about">
    <div class="about-head"><span class="retri">ReTri</span><span class="about-sub">智慧树助手 · 永久免费</span></div>
    <a class="about-link" href="https://github.com/huanweide/zhihuishu-helper" target="_blank" rel="noopener">⭐ 给作者点个 Star 支持一下</a>
    <div class="sf-box">
      <div class="sec-title">🔑 还没有 API Key？免费领硅基流动</div>
      <div class="hint">硅基流动是 DeepSeek / 大模型中转站，稳定且价格友好。用下方邀请链接注册，双方都有额度赠送。</div>
      <a class="about-link" href="https://cloud.siliconflow.cn/i/axOmWfWi" target="_blank" rel="noopener">🚀 点击注册（邀请码 axOmWfWi）</a>
    </div>
  </div>'''
foot_block = '''  <div class="foot">
    <button class="btn-start pri">启动</button>
    <button class="btn-stop">停止</button>
    <button class="btn-next">下一节</button>
    <button class="btn-answer">答题</button>
  </div>
</div>'''
assert foot_block in src
src = src.replace(foot_block, foot_block.replace('</div>\n</div>', '</div>' + about_html + '\n</div>'), 1)

src = rep(src, bind_marker, sponsor_js)

open(src_path, 'w', encoding='utf-8').write(src)
print('PATCHED OK, len=', len(src))
