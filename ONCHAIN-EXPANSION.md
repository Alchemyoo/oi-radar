# DEX / Transfer 双通道证据扩展（分阶段接入）

## 当前架构与边界

`onchain.registry.json → scripts/collect_onchain.py → data/onchain.json + data/onchain-history.json → onchain.js`。现有 Actions 每半小时执行默认采集，机器人仅提交这两个数据文件并请求 Pages rebuild。浏览器只重读缓存，不逐币调用 DEX/RPC、不启动合约扫描、不把链上指标计入评分。

已登记仅龙虾USDT、MUBARAKUSDT、TSTUSDT，确切身份为 BSC/56/合约地址。已有登记及其来源没有改动、没有重新宣称完成独立核验。采集器只接受 DexScreener 返回的确切 base-side 池，最多 top20，池去重与字段缺失覆盖保留。流动性变化要求相同池指纹、30分钟–6小时基线，不是净资金流。history 保留72小时/288点。

存在扩容瓶颈：Python 登记上限64、原 UI 上限20（此次对齐64）；采集与UI均仅支持BSC/EVM；UI还限定USDT符号；UI JSON读取上限2,000,000字符，Python本地16MiB；采集单请求10秒/最多两次，Actions 25分钟期限。不能直接把全市场塞进当前登记表，更不能为了“全覆盖”猜地址。

## 本次实现文件

- `scripts/collect_onchain.py`：新增 `--include-evidence`，默认不变、工作流不变；显式开启时只追加证据对象，无额外网络请求、无转账日志采集。
- `scripts/onchain_evidence.py`：DEX证据生成、disabled转账通道、严格离线 `transfer_channel(identity,payload)` 适配器。这个适配器是未来已审查数据源的入口，不是联网采集器，不自动接入现有其他transfer实现。
- `scripts/audit_onchain_mappings.py`：给归档的exchangeInfo和现有登记表做全部TRADING/PERPETUAL覆盖审计。包括不同quote和1000倍数符号；没有exact symbol登记的一律pending，不推断地址、不修改登记表。生产文件和输入不能作为output。
- `onchain.js`：新增 `transferEvents/channelSummary/channelPanel`；详情分开“DEX池证据”“大额转账证据”；旧v1快照可直接渲染，转账明确未接入；UI登记上限20→64。原toast、badge、评分、网络路径保留。
- `onchain.css`：两证据通道布局，手机单列，桌面两列。
- `scripts/test_onchain_evidence.py`、`onchain-evidence.test.js`：离线安全与兼容回归。

## 兼容数据契约

仍为顶层 `schemaVersion:1`；不删除或重命名任何原row/history字段。只有开启开关才添加每个row的：

```json
{
  "evidence": {
    "schemaVersion": 1,
    "dex": {
      "status": "ok | stale | error",
      "identity": {"symbol": "exact perpetual symbol", "chain": "bsc", "chainId": 56, "address": "verified address"},
      "source": "DexScreener token-pairs/v1",
      "sourceTimestampAvailable": false,
      "fetchedAt": "successful fetch time or null",
      "lastAttemptAt": "attempt time",
      "window": {"kind": "provider_rolling", "hours": [1, 24]},
      "coverage": "copy of existing coverage object",
      "thresholds": {"liquidityAbsUsd": 100000, "liquidityAbsPct": 10},
      "anomalies": []
    },
    "transfers": {
      "status": "disabled",
      "identity": "same exact identity object",
      "source": null,
      "fetchedAt": null,
      "lastAttemptAt": null,
      "window": null,
      "coverage": {"complete": false, "reason": "transfer_provider_not_configured"},
      "events": [],
      "anomalies": []
    }
  }
}
```

上例为字段说明，不是可直接采集的fixture。DEX anomaly 为 `kind:liquidity_snapshot_change`，包含 `deltaUsd/changePct/baselineAt/observedAt/poolFingerprint/containsPriceEffects:true/notNetFlow:true`。要求新成功状态、合法指纹、30分钟–6小时基线、绝对变化>=10%且>=100,000USD。它仅代表可比池USD估值差，不是实际入金/撤资，也不把买卖笔数识别为资金异动。

### 未来转账入口（目前不联网、不自动启用）

`transfer_channel(identity,payload)`要求：exact symbol/chain/chainId/address身份；HTTPS来源；带时区的fetchedAt/lastAttemptAt；`window:{from,to}`为<=24小时的半开区间[from,to)，to<=fetchedAt；`coverage:{complete:true,finality:'finalized'}`；events<=1000。

每条event：`tokenAddress/from/to`为EVM地址；`transactionHash/blockHash`为32-byte hash；`blockNumber/logIndex`为安全非负整数；`blockTime`在窗口内；`finality:'finalized',removed:false`；`decimals`为0–255整数；`amountRaw`保留最多78位十进制字符串，绝不转float；`usdValue:null`或有限非负数，非null时必须有`valuation:{source,at}`且at与blockTime一致。缺USD定价保留unknown，不补零、不报大额。

以chain身份+transactionHash+logIndex去重；冲突重复整通道拒绝，而非静默选择。>=100,000USD产生 `kind:large_transfer/notTrade:true`；UI独立校验后从events重算阈值，不信任上游anomalies标签。UI要求channel抓取新鲜、窗口终点新鲜，父缓存失败重读标stale时不确认当前转账。只生成固定bscscan交易链接，最多展示5条。没有推断钱包归属、买卖方向、交易所入金、聪明钱、持仓分布。

注意：这是结构验证与可信数据源适配边界，不是加密证明或独立链上验真。最终provider必须核验RPC receipt/log/block hash/finality/decimals和历史USD定价的真实性。

## 安全扩展到全部永续的流程

1. 固定并归档官方Futures exchangeInfo（保存抓取时间、serverTime、原始内容hash），分别统计TRADING/PERPETUAL，不只USDT。所有符号都可出现在coverage报告；数据可用性不能保证所有符号都可验证。
2. 候选发现与生产登记严格分离：按 exact futures symbol/baseAsset/官方公告或资产ID桥接，不按名称、ticker、DexScreener搜索结果自动选地址。
3. 每个候选至少核实官方永续标的关联资料与官方项目/官方资产/浏览器链合约资料；登记URL、具体JSON字段/记录ID、原始内容hash、核验时间、核验人、chain/chainId/address、资产ID、版本状态。仅HTTPS URL不是事实证明。
4. 倍数合约如1000X记录显式contractMultiplier与tokenAsset关系；不去掉1000后直接映射。同名多链、canonical/wrapped、bridge、升级迁移要标明资产变体与生效区间；有歧义保持pending/conflict。原生资产、指数、合成资产、非crypto标的及无链上token的标的明确not_applicable，不强造ERC20地址。
5. 新registry v2建议symbols键对应多个经过核验的asset mapping，并以 `(assetId,chainId,address,validFrom)` 建不可变mappingId。多链分别采集，再分别展示，不将不同链资金混合。history key加入mappingId，地址迁移不复用旧基线。
6. 添加明确chain adapter allowlist（API链标识、chainId、地址格式、大小写策略、explorer、finality）。Solana地址大小写敏感且需base58/32-byte验证，不能使用EVM归一；quote-side池如要支持必须逐字段定义方向语义，不直接翻转base买卖。
7. 全市场调度需按经核实唯一(chain,address)去重采集、限流/预算分片、429停止/退避、可恢复游标、文件分片、UI按需重读缓存和分页。先小规模评估2MB前端/16MiB后端/25分钟约束，再扩容；不能只增数组上限。
8. transfer provider显式opt-in：RPC/indexer范围、确认数或finalized策略、区块hash校验、reorg回滚、幂等游标、mint/burn/self-transfer分类、代币decimals来源、历史USD定价、部分覆盖与rate-limit状态、provider密钥与成本审查。独立缓存和workflow输入，不让DEX默认任务自动承担RPC扫描。
9. 只有维护者审核候选与工作流预算后才激活mapping/provider。每次移除/迁移映射都失效对应缓存，保留历史审计。禁止“所有币已支持链上”的笼统声明。

## 可复现命令

```sh
# 原默认：不启用新schema、不新增网络数据源
python3 scripts/collect_onchain.py
# 显式opt-in并使用隔离目录；仍只有原DexScreener请求
python3 scripts/collect_onchain.py --include-evidence --data-dir /tmp/oi-onchain-evidence
# exchange-info是维护者归档的官方清单，审核输出与生产数据隔离
python3 scripts/audit_onchain_mappings.py --exchange-info /tmp/exchange-info.json --output /tmp/mapping-coverage.json
# 离线测试；不采集、不改生产JSON
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_onchain*.py' -v
# iSH并行worker可能触发uv_thread_create断言，使用串行
node --test --test-concurrency=1 *.test.js
```

本次没有运行生产采集、没有写入data/、没有修改登记或Actions、没有commit/push。实时全部永续数量审计未成功（shell请求执行失败，浏览器fetch Load failed），所以没有声称获得真实全市场覆盖数；离线审计已测试。实际转账RPC provider、mapping v2和多链采集仍是后续opt-in工作，不是本次已完成的在线能力。

## 实际整合与验收补充

- 主详情页已加载 `transfers.js` 并读取独立 `data/transfers.json`。DEX继续使用原Actions定时缓存；Transfer明确标为手动采样，刷新只重读缓存不触发RPC。
- `collect_transfers.py` 查询既有BSC三币、100块范围、20块缓冲、decimals链上读取、分块日志与区块hash检查。原始大整数保留字符串，标签/USD估值未知；数量过滤默认100万token，**不是统一美元大额标准**。
- 缓存样本：龙虾与MUBARAK成功，125691523–125691622，UTC2026-10-04 14:22:33–14:23:18约45秒，符合数量阈值0条；TST网络失败，不显示0条。后续本地重试三币均RPC网络失败，成功样本仅作为历史缓存保留，不冒充新采样。
- `transfers.js` 同时按抓取时间和区块终点时效判断旧数据，抓取新时间不能将旧范围包装成当前证据；过期Transfer不生成美元大额异动标签。
- 官方exchangeInfo真实归档审计：571个TRADING/PERPETUAL（所有quote），已登记3、待核实568。此数不含TRADIFI_PERPETUAL，页面USDT合约子集数量可能不同。报告是覆盖缺口，不是新增映射；没有按名称猜地址。
- Python43/43；两通道相关Node测试含20项新证据/转账用例通过；主详情浏览器展示DEX和Transfer分栏、Actions与手动采样区别已验收。完整Node套件需以最终测试记录为准。
- 仍未完成：568币地址核验、多链适配、历史USD定价与可信交易所标签、Transfer持续自动采样和全市场索引。不会把少量手动token数量查询说成全币USD鲸鱼监控。
