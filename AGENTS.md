# 迅雷设备登录

- 当 refresh token 失效或需要设备登录时，必须将当次 `verificationUrl` 编码为可扫描的二维码并直接展示给用户；链接和 `userCode` 只作为备用方式。
- 二维码、临时登录码、access token、refresh token、session 和 peer ID 不得写入仓库、源码日志或提交内容。二维码只生成在临时目录，登录完成或过期后清理。
- 登录验收需同时确认实时账号状态有效、session 已注册、原生引擎已收到登录通知，再继续 P2SP 和会员加速验证。
