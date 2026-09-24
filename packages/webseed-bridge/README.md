# @tlei/webseed-bridge

BEP-19 web seed 桥：把迅雷（tlei daemon）P2SP 落盘数据经 sha1 逐 piece 门控后，以 HTTP web seed 形态供给本机 qBittorrent。实测混合加速 ≈ 60× 纯 qBittorrent（132 KiB/s → 7.7 MiB/s，归因迅雷 P2P 网络）。

## 架构

```
磁力 ──→ tlei daemon（P2SP 下载，顺序调度）
              │ 落盘（<infohash>.torrent/ 目录，CP1252 mojibake 名，.bt.xltd 边车）
              ▼
        桥（本包）── sha1 逐 piece 按需验证 ──→ HTTP 206/503（BEP-19）
              ▼
        qBittorrent（swarm + web seed 双路取数，拼装完整文件并做种回哺）
```

**安全铁律**：sha1 不通过的 piece 绝不供出（206 放行 = 逐字节等于请求区间且全部 piece 已验证；否则 503 + Retry-After）。不污染 swarm 是本桥存在的前提。

## 用法

`src/main.js` 是 `bridge-host` Cordis profile 的兼容入口；桥 daemon client、qbit Recipient、HTTP 供种与编排均由同一插件树装配。可加 `--dump-config` 查看脱敏后的装配配置，或用 `--config <json>` 传入 profile 插件配置。

```bash
# 前置：tlei daemon 在跑（默认 127.0.0.1:16800）、qBittorrent WebUI 在跑（默认 8085，
# 可通过 QBIT_USERNAME/QBIT_PASSWORD 配置 WebUI 登录）、迅雷已登录（三项验收自动执行）

# P2 混合加速（磁力 → 双路下载）
node src/main.js hybrid --magnet 'magnet:?xt=urn:btih:<hash>' --data <保存目录> [--port 7127] [--daemon-port 16800]

# E4 批量输入：可混用重复 --magnet、--torrent 和 --input-file；--save-path 指向前一项
node src/main.js hybrid --torrent ./a.torrent --save-path /data/a --magnet 'magnet:?xt=urn:btih:<hash>' --data /data/default
node src/main.js hybrid --input-file ./bridge-inputs.txt --data /data/default

# P1 完成态供种（已有数据 + 种子 → 纯 web seed 服务）
node src/main.js serve --torrent <x.torrent> --data <rootDir> [--out injected.torrent]
```

`--input-file` 为 UTF-8，每行一个磁力或 `.torrent` 路径；也接受逐行 JSON `{"kind":"torrent","value":"./a.torrent","savePath":"/data/a"}`。批次逐项预检、按 infohash 去重、最多两项并行，结果见 `GET /status` 的 `inputs`。仅所有项失败时返回非零状态。daemon 若启用 bearer，使用受保护环境变量 `THUNDERD_RPC_SECRET`；桥不打印完整磁力 URI 或凭据。

## 语义要点（按客户端实测行为定死）

| 行为 | 语义 |
|---|---|
| `Range: bytes=a-b`（单区间） | 覆盖 piece 按需验证；过 → `206` **区间逐字节等于请求区间**（libtorrent 对 206 严格相等校验，子区间应答触发 invalid_range 断连）；数据未落盘/未过 → `503 + Retry-After: 15` |
| 无 Range / 多区间 | 整文件已验证 → `200`；否则 `503` |
| HEAD | 只回头不回体 |
| 数据根 | 自动探测迅雷三层形态（`<infohash>.torrent/` 目录 / `<name>/` 目录 / 单文件直落），含 `.N.torrent` 变体与 CP1252 mojibake 修复；单文件种子不会误选 `<infohash>.torrent` 元数据文件 |
| 验证模型 | 按需验证（请求驱动），无周期扫描——常驻 CPU <1%（旧周期扫描版本实测 199 MiB/s 常驻读、60-70% CPU） |

## 故障自愈

| 故障 | 处置 |
|---|---|
| 引擎 208（同 infohash 会话未释放） | 删除失败任务 → 安全重建（≤2 次），忙则 qbit 独立下载 |
| 引擎崩溃/重启（START_FAILED 等） | 指数退避（5/15/30/60s）`start` 重试 ≤6 次，不删不重建（B3 长跑实证：数据完好，start 一次救回） |
| 桥重启 | 接管同 hash 存量任务（含引擎失败任务先救活），绝不重复建行 |
| tlei 停滞 | 三信号（验证推进/磁盘字节/host 速度）全灭 5 分钟才止损暂停，qbit 独立继续 |

## 测试

```bash
npm test   # Range 边界、按需验证、E4 批量和 Recipient、208/引擎失败自愈等
```

## 边界

- 本服务**无鉴权**，仅允许 loopback 绑定（`--host` 拒绝非 127.0.0.1/localhost/::1）；对外供种需反代 + 鉴权。
- qBittorrent 侧默认保存目录承接第二路数据（拼装文件落 qbit 侧，非桥数据目录）。
- **libtorrent 503 长退避**：qbit session 存续期内对某 web seed 的失败（503/断连）累计会进入分钟级退避。桥长时不可用（如进程退出过久）后重新上线，qbit 可能长时间不来请求——这不是桥故障。恢复手段：对种子 stop/start，或删种重加（`deleteFiles=false`，数据保留，重加后 qbit 重新校验并立即请求 web seed；实测 503 风暴后的 session 删种重加即刻恢复 206 流量）。
