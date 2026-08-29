# QuotaBar 官网

静态站，无构建步骤 —— 三个文件加一个 assets 目录，直接丢给任何静态托管即可。

```
web/
  index.html
  styles.css
  app.js
  assets/          真机截图 + 应用图标 + Sora 字体
```

本地预览：

```bash
python3 -m http.server 8080 --directory web
```

## 关于视觉

配色、字阶、间距和阴影取自 `onlook.cam-DESIGN.md` 里那套设计系统
（近黑画布、克制的高对比排版、分层微阴影）。**代码是重新写的** ——
没有复制 onlook.cam 的 `styles.css` 或 `app.js`，页面文案、截图和信息
架构都是 QuotaBar 自己的。

英雄区的壁纸是 CSS 渐变，不是任何现成图片；Dock 里除 QuotaBar 外的
图标是抽象色块，没有复刻 Apple 的图标。

## 截图怎么来的

全是真机截取的运行中的应用，不是模型图：

| 文件 | 内容 |
|---|---|
| `panel.png` | 菜单面板，选中 Codex |
| `dock.png` | 展开的边缘停靠条 |
| `notch.png` | 刘海条 |
| `settings.png` | 设置窗口 |

换新版后重新截一遍即可，尺寸不必对齐 —— 页面按百分比布局。

## 字体

字标用 Sora（SIL OFL 1.1），随站点分发，许可全文在
`assets/fonts/OFL.txt`。正文走系统字体栈，在 Mac 上就是 SF Pro。
