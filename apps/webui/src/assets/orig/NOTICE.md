# 原版资产许可声明（webui/src/assets/orig/）

本目录资产（CSS 切片、D-DIN-PRO 字体子集、3D 插画 PNG、蜂鸟 logo SVG、导航图标 SVG）来源于迅雷客户端安装包（thunder_x/program），**仅供个人使用，禁止再分发**。若项目转为公开发布，须先移除本目录并替换为开源等价资产。

来源：迅雷 Linux 客户端 renderer（asar 解包，日期 2026-08-05）。

子目录说明：

- `css/`     — 原版 CSS 切片占位目录，Task 1 起按需补充。
- `fonts/`   — 字体子集（D-DIN-PRO.woff2），由 `webui/scripts/provision-orig-assets.mjs` 通过 pyftsubset 生成。
- `img/`     — 原版 3D 插画 PNG（空状态、错误页、VIP banner 等）。
- `svg/`     — 蜂鸟 logo + 导航图标 SVG。
