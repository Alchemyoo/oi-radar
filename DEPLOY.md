# OI 雷达（加密永续 + 币安股票 + 多周期交易决策终端）部署与交接说明

## 1. 架构说明

本项目为**纯静态前端 Web 应用（支持移动端/桌面端自适应及 PWA 主屏幕安装）**，搭配可选的离线 JSON 快照采集脚本：

- **前端核心文件**：
  - `index.html` / `layout.js` / `layout.css`：主框架、单币战术作战室（K 线 + 24h VWAP + SMC OB/FVG + 入场/止损/止盈画线 + 以损定量仓位计算器）
  - `decision.js`：默认首页 **「🎯 决策」** 多周期（`1h+15m` / `4h+1h`）自动做多/做空、入场方式（现价/限价）、止损 `SL` 与分批止盈 `TP1/TP2` 决策引擎
  - `stock.js`：**「📈 股票」** 币安 TradFi 美股/ETF/独角兽/大宗商品永续合约终端（含美东盘前/盘中/盘后/夜盘状态雷达与板块热度）
  - `smc.js`：SMC 市场结构（BOS / CHoCH / OB / FVG / 未扫流动性池）与风险收益速算模块
  - `rolling-scan.js` / `rolling-oi.js` / `radar.js` / `strong.js` / `ls-ratio.js` / `coin-evidence.js`：OI 异动扫描（含 `data.binance.vision` 浏览器直连扫描）、强势榜、大户多空比与证据面板
  - `whale.js` / `alpha.js` / `capview.js` / `cg.js`：Hyperliquid 巨鲸、币安 Alpha、OI/市值高控盘筛选（已隔离股票与同名山寨币碰撞）、CoinGlass 清算终端
  - `sw.js` / `manifest.webmanifest` / `icon-180.png` / `icon-1024.png`：PWA 离线缓存与桌面/手机图标

> **零后端即刻可用**：核心行情、K线、资金费率、多空比与交易决策全部由访客浏览器直连币安官方公开接口（`fapi.binance.com`、`fstream.binance.com`、`data.binance.vision`），无需任何后端服务器即可上线运行。

---

## 2. 快速上线部署（3 种任选）

### 方案 A：Cloudflare Pages / Netlify / Vercel（最省心，自带全球 CDN 与免费 HTTPS）
1. 将整个项目目录推入 Git 仓库（或直接打包上传静态目录）。
2. 构建设置：
   - **Build command（构建命令）**：留空（无需编译）
   - **Publish / Output directory（发布目录）**：`.`（项目根目录）
3. 发布完成后即可获得 `https://` 域名；也可绑定自定义域名。

### 方案 B：GitHub Pages（含覆盖更新 `alchemyoo/oi-radar` 说明）
1. 将全部前端代码（`index.html`、`decision.js`、`stock.js`、`smc.js`、`layout.js`、`layout.css`、`rolling-scan.js`、`whale.js`、`alpha.js`、`capview.js`、`cg.js`、`strong.js`、`coin-evidence.js`、`ls-ratio.js`、`sw.js`、`cap-snapshot-collector.py`、`release.test.js` 等）提交至 GitHub 仓库 `main` 分支根目录。
2. **注意（针对已有定时采集机器人的仓库）**：若目标仓库（如 `alchemyoo/oi-radar`）后台有服务器每几分钟向 `main` 自动推送 `*.json` 快照，直接 `git push` 可能提示 `non-fast-forward` 冲突。推送前请先执行：
   ```bash
   git pull --rebase origin main
   git push origin main
   ```
   （合并时无需覆盖线上刚刷新的 `hl-whale-cache.json` / `cg-snapshot.json` 等实时缓存文件；若采集机上同时跑 `cap-snapshot-collector.py`，请同步更新采集机上的 `cap-snapshot-collector.py` 以隔离股票合约同名碰撞。）
3. 推送成功后，GitHub Pages 通常在 **1～2 分钟**内自动完成构建生效，届时强刷页面（`Ctrl + F5` 或无痕窗口）即可看到全新的 7 栏 **「🎯 决策」+「📈 股票」** 界面。

### 方案 C：自有云服务器（Nginx 静态托管）
将项目解压至例如 `/var/www/oi-radar`，参考 Nginx 配置（建议开启 HTTPS 以支持 PWA 与浏览器通知）：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # ssl_certificate /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    root /var/www/oi-radar;
    index index.html;

    location ~* \.json$ {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 3. 可选：定时快照更新任务（Python 3.10+）

项目根目录已内置一份完整的快照 JSON 文件，直接静态部署即可正常浏览全部页面。若希望持续定时更新辅助板块快照（巨鲸持仓、CoinGlass 清算、Alpha 列表、全市场市值快照、OI 缓存），可按需配置以下脚本：

| 脚本文件 | 产出 JSON | 用途说明 |
| :--- | :--- | :--- |
| `oi-cache-collector.py` | `oi-radar-live.json` | 币安主流合约多周期 OI 服务端缓存（前端亦有 `⚡ 直连扫描` 兜底） |
| `cap-snapshot-collector.py` | `cap-snapshot.json` | CoinGecko 市值与 FDV 快照（已自动剔除 `TRADIFI_PERPETUAL` 股票合约防同名碰撞） |
| `hl-whale-collector.py` | `hl-whale-cache.json` | Hyperliquid 头部巨鲸多空持仓快照 |
| `alpha-card-collector.py` | `alpha-card-cache.json` | 币安 Alpha 代币列表与价格快照 |
| `cg-snapshot-collector.py` | `cg-snapshot.json` | 清算关键价位与多交易所聚合指标快照 |

- **GitHub Actions 方式**：仓库已包含 `.github/workflows/oi-radar-cache.yml` 与 `.github/workflows/hl-whale-cache.yml`，可在 Actions 页面手动触发或按需开启 `schedule` cron。
- **海外 Linux 服务器 `systemd` 方式**：参考 `tools/tokyo/` 目录下的 `.service`、`.timer` 与 `.sh` 模板（部署在可正常访问币安 API 的海外节点，如东京/新加坡区域）。

---

## 4. 本地预览与自动化测试

```bash
# 本地启动静态预览服务器
python3 -m http.server 8767

# 运行回归测试套件（需 Node.js 18+）
node --test *.test.js
```
