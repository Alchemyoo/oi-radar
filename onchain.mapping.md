# 链上首版身份核验记录

核验日期：2026-10-04。注册表只登记 BSC 三币，按链 ID 和确切合约绑定，不通过搜索同名币匹配。

| 永续 | BSC 合约 | Binance 官方桥接字段 |
|---|---|---|
| 龙虾USDT | `0xeccbb861c0dda7efd964010085488b69317e4444` | Alpha ALPHA_772、symbol/name 龙虾、chainId 56；永续公告明确标的龙虾、BNB Chain；指数成分含 binance_alpha 龙虾USDT |
| MUBARAKUSDT | `0x5c85d6c6825ab4032337f11ee92a72df936b46f6` | Alpha ALPHA_116、cexCoinName MUBARAK、chainId 56；官方资产 MUBARAK/Mubarak/BSC |
| TSTUSDT | `0x86bb94ddd16efc8bc58e6b056e8df71d9e666429` | Alpha ALPHA_87、cexCoinName TST、chainId 56；官方资产 TST/Test/BSC |

## 实际检查
- Binance `fapi/v1/exchangeInfo` 三者均 `TRADING`、`PERPETUAL`，baseAsset 分别为龙虾/MUBARAK/TST。
- Alpha 官网公开列表：`https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list`。
- 官方资产列表：`https://www.binance.com/bapi/asset/v2/public/asset/asset/get-all-asset`。
- 龙虾上币公告：`https://www.binance.com/zh-CN/support/announcement/detail/d9c05581552140eba3f393ef0a9a23b3`。
- 龙虾指数成分：`https://fapi.binance.com/fapi/v1/constituents?symbol=%E9%BE%99%E8%99%BEUSDT`。
- DexScreener token-pairs/v1 三币均返回真实池；采集器只保留 baseToken 为确切目标合约的池、去重，不纳入同名或 quote-side 池。

Alpha 的 offline/fullyDelisted 字段描述该 Alpha 条目，不代替 Futures 合约状态。合约是否交易以 Futures exchangeInfo 为准。

## 首轮实测
龙虾 19 个返回池 / 8 个符合 base 侧；MUBARAK 16 / 11，流动性字段仅 8/11 披露，因此总流动性为 null；TST 17 / 7。这些不是全链覆盖数量。

龙虾和 TST 第二次实际采样与首次相隔约 37 分钟，池集合指纹一致，获得可比 USD 流动性快照变化；MUBARAK 缺数据不给变化率。没有历史造点、没有用买卖笔数换算金额。
