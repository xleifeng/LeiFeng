// mdui 2 接入层（第三轮重设计）：M3 规范 Web Components——ripple / state layer /
// 规范组件行为全部齐备，替代第二轮的手写近似件。
// 配色：以 #0b57d0 为种子色经 HCT 色调板生成明暗双套（material-color-utilities），
// 与 tokens.css 的 --md-* 手书令牌同源（--md-* 已改为 --mdui-color-* 的别名层）。
// 组件按需注册控制包体；新用哪个组件就在这里加一行。
import 'mdui/mdui.css'

import 'mdui/components/button.js'
import 'mdui/components/button-icon.js'
import 'mdui/components/fab.js'
import 'mdui/components/switch.js'
import 'mdui/components/checkbox.js'
import 'mdui/components/radio.js'
import 'mdui/components/text-field.js'
import 'mdui/components/select.js'
import 'mdui/components/slider.js'
import 'mdui/components/dialog.js'
import 'mdui/components/segmented-button.js'
import 'mdui/components/segmented-button-group.js'
import 'mdui/components/linear-progress.js'
import 'mdui/components/circular-progress.js'
import 'mdui/components/list.js'
import 'mdui/components/list-item.js'
import 'mdui/components/list-subheader.js'
import 'mdui/components/menu.js'
import 'mdui/components/menu-item.js'
import 'mdui/components/dropdown.js'
import 'mdui/components/tooltip.js'
import 'mdui/components/snackbar.js'
import 'mdui/components/divider.js'
import 'mdui/components/chip.js'
import 'mdui/components/badge.js'
import 'mdui/components/navigation-rail.js'
import 'mdui/components/navigation-rail-item.js'
import 'mdui/components/navigation-bar.js'
import 'mdui/components/navigation-bar-item.js'

import { setColorScheme } from 'mdui/functions/setColorScheme.js'
import { setTheme } from 'mdui/functions/setTheme.js'

// 种子色 = 第二轮 Google 蓝；生成的 tone 值与 tokens.css 回退值同族但有微调（更贴规范）
setColorScheme('#0b57d0')

// 主题切换走 mdui 的 mdui-theme-* class（shell store 与 index.html 预置脚本同步调用）
export { setTheme }
