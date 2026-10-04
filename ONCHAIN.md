# 链上证据首版

## 使用
保持市场 / 机会 / 自选三个入口：
- 市场增加轻量「链上」标签、试点筛选和龙虾/MUBARAK/TST快捷入口。市场与自选试点筛选状态独立。
- 强势/异动/信号结果中，已核实币种追加1h买卖笔数或池流动性证据标签。标签不改变合约排序、评分和信号，不强行对齐不同窗口。
- 点击币种进入详情，展开顶部「链上证据」。查看BSC合约、流动性、1h/24h成交额、1h买卖笔数、可比池流动性变化、池清单、时间、来源和覆盖范围。
- 「重读链上缓存」只重新下载本站静态JSON，不访问DEX接口或触发采集。

## 数据与限制
官方身份见 `onchain.registry.json`、`onchain.mapping.md`。采用DEX Screener公开API；不需要前端密钥，不访问钱包、不发送交易。

**发布状态：自动缓存已启用。** 2026-10-04 通过仓库已登录 GitHub 网页提交 `.github/workflows/onchain.yml`（d8cb93f），没有修改或扩大现有 PAT 权限。工作流 active，cron `*/30 * * * *`：每小时 :00/:30 计划执行，GitHub 队列可能延迟。首次 workflow_dispatch 实跑 37186274203 success：25项离线测试、三币采集、机器人数据提交659b8f4、Pages 重建请求全部成功；Pages 37186283298 success，线上缓存 `collectionMode:actions`、抓取时间 2026-10-04 15:36:04 北京时间。退出 Minis 不影响 GitHub 云端采样。已实跑手动触发链路；下一次 cron 自触发尚未观测，不承诺准点。

买卖金额差额、大户持仓和集中度本期暂无，未用笔数代替金额。MUBARAK部分池流动性未披露，总额为null，池清单仍可看单池已披露数据。缺数不补零。

单币90分钟以上或采集失败标旧快照；缓存重读失败保留旧值但标stale，不显示为当前方向确认。来源没有底层更新时间，fetchedAt仅抓取时间。历史保留72h、每币最多288点；流动性变化只在相同池集合、真实30min–6h基线间计算，包含币价变化影响，不是资金净流。

## 测试
```sh
node onchain.test.js
node strong.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p test_onchain.py -v
python3 -m http.server 8770 --directory .
```
测试浏览器控制台：
```js
await eval(await (await fetch('onchain.qa.js')).text())
await eval(await (await fetch('layout.qa.js')).text())
```
QA仅用于本地/测试。会临时修改收藏、筛选、币种与网络函数，不应在生产监测会话运行。生产入口不会加载测试脚本。

首次发布前已验收：采集器25/25、前端模型12/12、强势20/20、链上浏览器24/24、原布局27/27；三币真实采样成功；320px市场/机会/自选/详情无整页横向溢出。WebKit预览曾两次卡住，关闭/重开并隔离初始化后恢复；Node DOM隔离初始化检查和随后真实WebKit验收通过，未发现确定无限循环证据。

未验收内容：钱包画像/大户、USD买卖差额、全链扫描、盈利回测。定时执行准点性不能保证。
