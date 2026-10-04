# 全永续链上接入状态

## 当前范围

官方 Futures `exchangeInfo` 归档统计：571 个 `TRADING/PERPETUAL`（含所有 quote），528 个 base asset。生成器 `scripts/build_onchain_universe.py` 只生成审查候选，不自动改生产登记表：

- 275 个符号具有严格来源关联的已选地址：66 个 Binance 官方 Alpha/资产来源，209 个 provider-matched（Binance asset identity + CoinGecko 唯一名称/符号桥接，不等于项目方独立核验）。
- 61 个 `native_no_dex_contract`，不伪造 ERC-20 地址。
- 20 个 `no_adapter`，例如当前未实现的 Sui 通道；不返回假数值。
- 7 个 `ambiguous_identity`，208 个 `pending_verification`。
- 映射链分布：Ethereum 180、BSC 44、Solana 30、Base 12、Sui 5、Arbitrum 2、Avalanche 1、Optimism 1。

候选文件生成于 `/var/minis/workspace/allchain/proposed-registry.json`，不是已发布的 `onchain.registry.json`。原因是把 provider-matched 地址直接当成全市场事实会造成同名币、桥接资产、数字倍数合约误配。

## 已实现的采集能力

`scripts/collect_onchain.py` 已支持：

- 严格 EVM chainId/address、Solana base58、Sui Move 类型格式校验；
- 同链最多30地址一批的 DexScreener `token-pairs/v1` 请求；4 worker、全局间隔、429停发和批次失败隔离；
- baseToken 精确匹配，绝不把 quoteToken 翻转为 base；EVM 地址大小写归一，Solana 大小写敏感；
- Sui 明确输出 `unsupported_chain_adapter`，不伪装成成功；native/no-contract 和未映射状态由候选清单保留；
- 历史池指纹按 `chain + address + pool set` 隔离，旧地址不复用新地址基线；失败可保留 stale，缺失值不补零。

现有 GitHub Actions 工作流和生产登记表未自动扩大；要把275个映射纳入生产，还需要审查 provider-matched 映射、更新前端多链身份校验、扩展 `onchain.js` 详情/区块浏览器链接和 Transfer provider，随后再调整 Actions 预算与缓存大小。

## 已移除

独立 Hyperliquid/HYPE 板块、脚本、样式和测试已移除；Binance 永续清单中的普通符号仍由官方 exchangeInfo 正常列出，不建立专用行情模块。

## 测试

- Python 全套 `scripts/test*.py`：65/65；
- Node 全套串行测试：112/112；
- `chains.test.js` 覆盖 EVM/Solana/Sui/unsupported 状态；
- 未进行全市场真实 DexScreener 采集：公共 API 在当前网络不可达，避免用旧快照冒充新数据。
