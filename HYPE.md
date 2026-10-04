# HYPE 独立行情板块

## 入口与边界
保持「市场 / 机会 / 自选」三个主入口。在「机会」增加 HYPE 子标签，与强势选币、持仓异动、信号验证平级；HYPE 面板不会混入 Binance 全市场、评分、扫描、自选或 OI 雷达。

仅展示 Hyperliquid 默认永续 universe 中精确名称 `HYPE` 的单一市场。没有该市场时明确提示「API 未提供 HYPE 市场」，不猜测生态代币，不使用含 HYPE 的其他名称。下架状态单独标注。

公共接口：`POST https://api.hyperliquid.xyz/info`，JSON body `{"type":"metaAndAssetCtxs"}`。无需密钥、钱包、clearinghouseState 或账户权限；不读取账户、不发送交易。

模块 `hyperliquid.js` 在 `layout.js` 与布局初始化之前加载；布局创建机会容器后调用 `hyperliquidInit()`。初次进入 HYPE 或手动刷新才发送请求；90 秒内切换复用快照，超过 90 秒切回时重新读取。同一个未完成请求去重，12 秒超时；状态刷新计时器只更新展示，**不自动请求**。失败可重试，旧值仅供历史参考。

## 字段口径
| 展示 | API 字段 / 计算 |
| --- | --- |
| 标记 / 预言机价格 | markPx / oraclePx |
| 前日价格 | prevDayPx |
| 24h 价格变化 | `(markPx / prevDayPx - 1) * 100%`，prevDayPx 必须大于 0 |
| OI 数量 | openInterest，HYPE 单位 |
| OI 名义价值 | openInterest × markPx，以美元展示；不使用 oracle 补缺 |
| 24h 名义成交额 / 基础成交量 | dayNtlVlm / dayBaseVlm |
| funding / premium | 原始比率 × 100，以百分数展示，允许负数 |

空值、非法数、非有限数和无效分母显示未知，不填 0；真实 0 保留。API 上下文数组按 universe 的索引对齐，数组长度不一致或多个精确 HYPE 映射报错，不采用不确定数据。

**资金费率周期声明：** 本响应没有返回结算周期，因此不标为 1h / 8h、不换算年化，也不与 Binance 周期费率直接比较。公开 API 行情不是链上交易证据，不据此生成「链上异动」。24h 变化是 API 前日价和当前标记价之比，并非本机采样精确 24 小时回报。OI 名义值不等于资金净流入。

展示来源链接、本机成功读取时间（不是交易所事件时间）、加载 / 错误 / 缺市场 / 字段未知 / 旧快照状态。仅供数据观察，不构成交易建议。

## 窄屏与质量门
卡片使用可收缩网格与断行，360px 以下单列；机会四个标签缩小字号，在 320px 无固定宽表格。静态测试验证收缩和断行约束；实际 WebKit 320px 的几何、请求可达性和交互验收由后续浏览器 QA 完成，不能用静态测试替代。

```sh
node --test --test-concurrency=1 *.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test*.py' -v
node --check hyperliquid.js
```

`hyperliquid.test.js` 完全离线：fixture 精确映射、全部字段与计算、缺字段 / 0 / 负数 / 溢出、错误 HTTP / JSON / abort、UI 状态 / 旧快照、请求体、缓存去重与刷新、加载顺序、三个主入口、320px CSS 约束。`onchain-alert.test.js` 验证链上标注不发网络请求、不误归 HYPE 为链上、阈值与旧快照规则。现有测试保留。iSH 多进程并发可能耗尽线程，使用 `--test-concurrency=1` 获得实际逐项测试结果。

未修改 Actions 工作流、缓存数据、映射或采集器；没有 git commit / push。真实 API 网络与浏览器渲染仍需验收，不承诺请求成功、全链覆盖、生态币扫描或交易获利。
