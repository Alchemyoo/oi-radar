# 全永续链上采集与覆盖验收

## 目录与身份

目录快照包含571个TRADING/PERPETUAL符号（全部quote、528个base），不含TRADIFI_PERPETUAL。275个选定链地址中66个为官方元数据关联、209个为provider_matched，后者不是项目方独立合约核验。其余61个无已登记DEX合约、20个无适配、7个身份歧义、208个待核实：这是状态目录，不是已采集数值。

前端读取onchain.universe.json与登记、DEX、Transfer缓存四条独立链路。展示目录原因、证据层级、有效/旧/不可用状态和真实链浏览器。移除275个快捷按钮；索引和渲染去重；快照流式读取上限16MiB。三主入口、三机会子页保留，没有独立HYPE/Hyperliquid接入。

## DEX修复与真实采集

此前将多个地址发往单地址token-pairs/v1接口，导致大量错误无池结果；现已改为官方tokens/v1批量端点。同链30地址/批、4worker、链地址跨quote去重。429停止新批次及重试，失败只影响相应批次。所有池仍严格匹配base地址，Solana大小写保留，不翻转quote侧。

2026-10-04T23:54:40Z本地真实完整登记采集：275记录，198ok、72no_accepted_base_pools、5unsupported（Sui）。缺池不是0成交额，也不能证明全链无池；仅表示当前精确地址/所选链的API未返回合法base池。没有伪造新抓取时间。

## Transfer与自动流水线

Transfer采集器现在遍历所有275映射，EVM按链与地址去重：Ethereum/BSC/Base/Arbitrum/Optimism/Avalanche/Polygon公开RPC，Solana/Sui明确未适配。RPC方法批量最多20条，日志过滤最多8地址，100区块有界查询，decimals按结束块读取，日志/区块hash与链Id校验，链独立失败。180秒全局预算、90秒链运行时间、400个全局HTTP请求与140个单链请求上限、4秒请求时限（云端POSIX时钟；iSH不支持setitimer时保留socket时限）。确认块缓冲按链配置，不承诺finality。

实测PublicNode的Arbitrum历史日志需个人令牌，因此改用已验证的Arbitrum官方公开RPC（arb1.arbitrum.io/rpc），没有绕过私有接口认证。高活跃代币（如USDC）在单次响应过大时按区块二分，保持同一完整起止范围，预算不足时明确失败而不截断为成功。

2026-10-05T00:13:40Z手机实跑：240unavailable（218rpc_timeout、22rpc_http_error）、35unsupported；这不是成功转账覆盖。主界面保留失败原因与未知计数。Transfer过滤默认100万token单位，不是统一USD大额标准；USD估值、地址标签未知，不生成美元鲸鱼确认。

Actions仍计划每30分钟。collect_pipeline.py依次采集DEX、Transfer，并产出逐符号onchain-coverage.json；发布四个data文件。只有确实写入当前合法attempt才允许发布，失败状态可以被发布，但不会将旧缓存改成当前成功。构建/调度success不代表每个链成功，必须检查覆盖报告。

## 验收

- 完整Node128/128、Python95/95，批量端点/去重/限流/失败状态/全目录DOM/多链Transfer/完整区块二分等回归通过。
- 真WebKit：571目录、275地址、198有效DEX数据、0快捷按钮；Ethereum与Solana浏览器链接、native说明、三入口、320px无整页溢出；layout.qa.js27/27。
- 云端完整pipeline run37255150159成功，数据时间2026-10-05T02:23:22Z：DEX198ok/72无合法池/5未适配；Transfer240ok/35未适配，169HTTP请求、71条满足token数量过滤的事件。六条有效EVM链：Ethereum180/BSC44/Base12/Arbitrum2/Avalanche1/Optimism1（含报价别名符号，不等于240个唯一合约）。
- 缓存提交20ca1ac，Pages37255204757成功；双通道定时工作流91adfc1保持每30分钟计划。已验证手动触发完整pipeline；新版cron准点性不承诺。

## 尚未覆盖

208待核实身份、native链活动、缺链适配/Sui/Solana Transfer、美元历史定价及可信地址标签、长时间连续日志覆盖尚未完成。没有把未知或无响应说成零、没有宣称571符号均有有效链上数据。
