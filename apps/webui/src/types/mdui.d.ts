// mdui-* Web Components 的 Vue 模板类型声明（第三轮重设计）
// 运行时经 vite.config.ts 的 isCustomElement 直通原生元素；这里只为 vue-tsc 提供解析目标。
// 属性面以 mdui 组件类实例类型为准（string/boolean 属性经模板 attribute 传入）。
declare module 'vue' {
  interface GlobalComponents {
    'mdui-button': typeof import('mdui/components/button.js').Button
    'mdui-button-icon': typeof import('mdui/components/button-icon.js').ButtonIcon
    'mdui-fab': typeof import('mdui/components/fab.js').Fab
    'mdui-switch': typeof import('mdui/components/switch.js').Switch
    'mdui-checkbox': typeof import('mdui/components/checkbox.js').Checkbox
    'mdui-radio': typeof import('mdui/components/radio.js').Radio
    'mdui-text-field': typeof import('mdui/components/text-field.js').TextField
    'mdui-select': typeof import('mdui/components/select.js').Select
    'mdui-slider': typeof import('mdui/components/slider.js').Slider
    'mdui-dialog': typeof import('mdui/components/dialog.js').Dialog
    'mdui-segmented-button': typeof import('mdui/components/segmented-button.js').SegmentedButton
    'mdui-segmented-button-group': typeof import('mdui/components/segmented-button-group.js').SegmentedButtonGroup
    'mdui-linear-progress': typeof import('mdui/components/linear-progress.js').LinearProgress
    'mdui-circular-progress': typeof import('mdui/components/circular-progress.js').CircularProgress
    'mdui-list': typeof import('mdui/components/list.js').List
    'mdui-list-item': typeof import('mdui/components/list-item.js').ListItem
    'mdui-list-subheader': typeof import('mdui/components/list-subheader.js').ListSubheader
    'mdui-menu': typeof import('mdui/components/menu.js').Menu
    'mdui-menu-item': typeof import('mdui/components/menu-item.js').MenuItem
    'mdui-dropdown': typeof import('mdui/components/dropdown.js').Dropdown
    'mdui-tooltip': typeof import('mdui/components/tooltip.js').Tooltip
    'mdui-snackbar': typeof import('mdui/components/snackbar.js').Snackbar
    'mdui-divider': typeof import('mdui/components/divider.js').Divider
    'mdui-chip': typeof import('mdui/components/chip.js').Chip
    'mdui-badge': typeof import('mdui/components/badge.js').Badge
    'mdui-navigation-rail': typeof import('mdui/components/navigation-rail.js').NavigationRail
    'mdui-navigation-rail-item': typeof import('mdui/components/navigation-rail-item.js').NavigationRailItem
    'mdui-navigation-bar': typeof import('mdui/components/navigation-bar.js').NavigationBar
    'mdui-navigation-bar-item': typeof import('mdui/components/navigation-bar-item.js').NavigationBarItem
    'mdui-collapse': typeof import('mdui/components/collapse.js').Collapse
    'mdui-collapse-item': typeof import('mdui/components/collapse-item.js').CollapseItem
  }
}

export {}
