# 链上首期证据数据契约

## 范围与运行

首期只是 GitHub Pages 的静态 JSON 证据缓存，不增加入口，不改 `index.html`、layout、strong 或 `onchain.js`。只用 Python 标准库，生产输入是根目录 `onchain.registry.json`，不按 symbol 搜索、猜合约或自动追加币种。注册表由人工/独立核验流程维护。

```sh
# 离线测试：内置 fixture，不需要注册表、不访问网络
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p test_onchain.py -v
# 生产采样：注册表核验完毕后运行
python3 scripts/collect_onchain.py
# 可选：隔离输出目录，默认路径仍是仓库根目录下 data
python3 scripts/collect_onchain.py --registry /path/registry.json --data-dir /path/data
```

注册表形状：`{schemaVersion:1,tokens:[{symbol,chain:'bsc',chainId:56,address,sources,verifiedAt,name}]}`。目前只支持 BSC/EVM；1–64 个 token；symbol 必须为 1–32 位大写字母/数字/下划线/连字符或 CJK 字符且唯一（兼容 Binance `龙虾USDT`）；chainId 必须是整数 56；address 必须是 `0x` 加 40 位十六进制。name 可选，最多 120 字符且无控制字符；verifiedAt 如存在须为带时区 ISO 时间。`sources` 是注册表身份核验资料，**不是采集器要访问的 URL**，保留在注册表中；输出 identity 保存 symbol/chain/chainId/address/name/verifiedAt。

## 唯一上游及限制

`GET https://api.dexscreener.com/token-pairs/v1/{chain}/{address}`，公开、无密钥，无 RPC/付费服务/第三方 Python 包。请求来自 Actions 后端，浏览器不直接调用 API。

- 只接收 API `chainId === 'bsc'` 且 `baseToken.address` 与注册表地址确切相等的池子。仅 EVM 地址大小写归一，不对 chain 字符串放宽，不猜测或翻转 quote-side 数据。
- 池子地址同样验证 EVM 格式，以 `(chain,pairAddress)` 去重；完全相同副本只计一次，冲突副本导致该币采样失败、保旧，避免选择错误值。
- liquidity USD、volume h1/h24、price USD 必须有限、非负；txns buys/sells 必须非负整数且不超过 JavaScript 安全整数上限。字段缺失/null 不补 0；负数、NaN、Infinity、错误类型等使该池被拒绝。
- 唯一合法池按已知 liquidity USD 降序选前 **20** 个；缺 liquidity 的池排在已知值后。主池是最大已知 liquidity 的池，缺全部流动性时主池/主价格为 null。输出 URL 根据已验证 chain/pairAddress 构造，不信任 API URL。
- 返回列表最多 10,000 项、HTTP 响应最多 3 MiB、本地 JSON 最多 16 MiB；每次网络超时 10 秒，只对网络/HTTP 5xx 最多尝试两次，中间等 1 秒。HTTP 429 不重试，并停止本轮后续币种的网络请求。其他 HTTP 4xx/无效 JSON 不重试。日志只输出计数或固定安全错误码，不输出响应原文、地址、异常详情或凭据。

**DexScreener 这个接口没有可用的 source timestamp。** `fetchedAt` 仅代表成功抓取时刻，不表示链上数据对应时刻，也不保证 API 的量/价格实时。h1/h24 是供应商报告的滚动窗口，不是采集器根据逐笔成交重建的窗口。本期没有 holder 数、钱包画像、聪明钱、实际资金净流入/净流出、USD 买卖差额或 USD 买卖比例。`buySellUsd` 始终为 null：API 只有买卖**笔数**，不能按笔数推算金额。

## `data/onchain.json`（schemaVersion 1）

顶层：

- `generatedAt`：本轮输出生成时刻，**不是所有币的数据时刻**。
- `status`：全部成功为 `ok`，有新成功但并非全部成功为 `partial`，没有新成功但存在旧好快照为 `stale`，没有任何好快照为 `error`。
- `source: 'DexScreener token-pairs/v1'`、`sourceTimestampAvailable:false`。
- `tokens`：按经过验证的 symbol 键控。

每个成功 token：

- `status:'ok'`、`identity`、`fetchedAt`、`lastAttemptAt`。
- `coverage`：chain、returnedPools（API 原始返回数）、acceptedPools（合法去重池数）、selectedPools（实际汇总数，<=20）、invalidPools、unmatchedPools、duplicatePools、truncated，以及各字段的 `{knownPools,totalPools,complete}`。
- `liquidityUsd`、`volumeUsd:{h1,h24}`、`txns:{h1:{buys,sells},h24:{buys,sells}}`。
- `primaryPairAddress` 和其 `priceUsd`。不对多个池的价格求和或伪造加权价格。
- `buySellUsd:null`、`liquidityChangePct`、`liquidityBaselineAt`、`poolFingerprint`。
- `liquidityChangeKind:'snapshot_difference_including_price_effects_not_net_flow'`。
- `pools:[{pairAddress,dexId,liquidityUsd,volumeUsd,txns,priceUsd,url}]`。

**汇总范围仅为“API 返回的可计量 base 侧池子”，并且只汇总选出的 top <=20。** 不代表全链/全市场资产流动性。`truncated:true` 时还有被上限排除的合法池子。被拒绝/未匹配池数通过 coverage 可见；没有合法 base 池就失败而不是输出零。

任一选中池缺某字段，则对应汇总为 null，`coverage.fields` 显示已知/总池数；其他完整字段仍可汇总。例如 volume.h1 完整但 volume.h24 缺一池时，只把 h24 设为 null。流动性不完整时不写历史点、不给变化率。`coverage` 的 complete 仅描述选中池字段完整性，不暗示供应商覆盖全链。

## 历史与流动性变化

`data/onchain-history.json`：schemaVersion 1、generatedAt、`retentionHours:72`、`maxPointsPerToken:288`，tokens 按 symbol 保存 `{at,liquidityUsd,poolFingerprint}` 点数组。

- 同时受 **72 小时** 与 **每币最多 288 点** 限制，不是无限历史或 7 天。30 分钟采样通常约 144–145 点；手动重复采样可提前触及点数上限。按点时间去重，剔除无效及未来点。
- 只有本轮完整的新成功流动性产生历史点；失败、stale、缺字段均不追加。
- poolFingerprint 是 chain、base 地址、排序后的选中池地址集合的 SHA-256；池集合或身份变化不混用基线。历史采样复用时不修改旧点。
- 仅同指纹、基线流动性大于零、`30min <= baselineAge <= 6h` 才计算：`(current / baseline - 1) * 100`，取最新符合条件的历史点。没有合格基线/零基线/非有限计算结果时，变化率和 baselineAt 都为 null。
- 这是 **USD 流动性快照差，包含价格变化影响，绝非净资金流**；不同采样可能间隔不同，需同时展示 liquidityBaselineAt 与 fetchedAt。字段名称不应渲染成“净流入”。

## 故障与缓存真实性

单币失败：若相同 symbol/chain/chainId/address 有历史好快照（ok 或 stale），保留其 pools、数值、历史成功 fetchedAt 等，标记 `status:'stale'`、error，并更新 lastAttemptAt；不会更新 fetchedAt 或追加历史点。地址发生变更不会借用旧身份的好快照。无旧好快照则 `status:'error'`，fetchedAt 和数值为 null，pools 为空。

全部失败且存在旧好快照：顶层 stale，退出 0，使工作流能发布“已尝试但陈旧”的状态。初次全部失败/无可复用好快照：顶层 error，退出非 0，工作流不提交初次失败产物。部分成功退出 0；消费方必须逐币检查 status/fetchedAt，而不能用顶层 generatedAt 当新鲜度。缓存格式损坏/注册表非法时提前失败，不覆盖旧缓存。

两个 JSON 各自采用同目录临时文件、fsync、原子替换；先历史后快照，不宣称两文件具有跨文件事务性。Workflow concurrency 防止本工作流互相覆盖；不要本地并发运行到同一输出目录。

## GitHub Actions 与发布边界

`.github/workflows/onchain.yml` 每半小时 UTC cron + workflow_dispatch；仅 **main 分支、公开仓库**运行，contents:write 与 pages:write、同组 concurrency 不取消正在执行的任务，25 分钟总超时。checkout/setup-python 后先跑全部离线测试再采集，只 add/commit `data/onchain.json` 与 `data/onchain-history.json`，有变化才提交并 push main；不 reset、不 force-push、不提交其他文件。并发外部提交造成普通 push 冲突时直接失败，等下轮或人工检查，不强行覆盖。

缓存机器人使用 GITHUB_TOKEN 的 push 通常不会自动触发其他工作流，因此 commit/push 后额外调用 `POST /repos/{owner}/{repo}/pages/builds` 请求 legacy Pages 重建。此步骤必须在真实 Actions 运行中验收；cron 可能延迟，不承诺准点。

没有付费依赖：依赖公开仓库 GitHub Actions 与上游公开接口。仍受 GitHub 用量/滥用策略、分支保护与 API 限流影响。cron 可能延迟、跳过，不能保证每 30 分钟实际更新。仓库需允许 Actions token 写 contents；分支保护阻止写入时需维护者处理。本次实现**没有提交、推送、触发工作流，也没有在仓库写入测试币生产数据**；待注册表核验与主 agent 发布后启用。

## 本轮发布权限结果
2026-10-04 首次 PAT push 因缺 workflow scope 被拒绝，先发布手动快照版。随后用户要求启用定时更新，通过已有管理员 GitHub 浏览器登录态网页提交工作流 d8cb93f（未修改PAT/未扩大scope），注册为active。workflow_dispatch 37186274203 success：离线测试、三币采集、数据提交659b8f4、Pages rebuild API 全通过；Pages 37186283298 success，线上 `collectionMode:actions`、generatedAt 2026-10-04T07:36:04Z，与仓库采集结果一致。cron已配置半小时；首次计划事件是否准点执行未观测，不保证准点。
