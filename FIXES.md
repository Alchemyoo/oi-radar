# OI Radar audit fixes — 2026-10-04

## Completed
- T+1 uses signal-day close to the next completed UTC close; pending/missing stays null. Scan identities isolate caches and reject obsolete responses.
- Scan OI and price share strict endpoints. Show OI notional change separately from coin quantity change; quantity filters and percent-mode picks use coin change. No metric is named actual capital inflow/outflow.
- Radar uses selected 1/4/6h coverage, genuine warmup/gap reset and independent 25-minute alert timestamps.
- Historical quadrant calculations use the same selected 1/2/3-day windows as current observations. Explicit small samples, current-universe selection bias, correlated/overlapping observations and trading-cost exclusions.
- Intraday OI and closed 5m price share 15/30/60min endpoints. Incomplete coverage/gaps remain warmup; no future endpoint borrowing. Dedicated intraday thresholds; unknown funding contributes zero; generation guards pause/window changes.
- Full OI loading uses six workers; partial failures remain retryable. 429/418 Retry-After cooldown prevents archive fallback. Stop aborts currently active core requests (shared cancellation may also interrupt concurrently loading secondary cards; they remain retryable).
- Funding uses successful fundingInfo interval overrides; default8h only on successful omitted overrides, failed interval lookup yields unknown. Actual 4h contracts verified in browser. Missing OI remains unknown. WS keeps mark separate from last traded price.
- Historical detail prices request explicit date bounds and compare previous close. External MegaGlass symbol/attribute/remarks are escaped. Zoom enabled, iOS meta and numeric/date input16px, table colspans and documentation corrected.
- Three primary entries preserve the original market, opportunity and watchlist workflows.

## Executed validation
- Retained tests exercise OI endpoints, T+1, alerting, strong rankings and intraday time windows.
- Browser layout.qa.js:27/27 including stale-detail and radar pause response guards.
- Browser: 528 contracts loaded; BTC3d scan archive endpoints both coin and notional quantities returned; price1.356475%; actual4h funding overrides verified.
- Narrow viewport: each three entry document width equals effective innerWidth. Device WebView reported innerWidth402 despite requested320, so not a physical320px guarantee.

## Limits
- Binance daily OI timestamp semantics not independently matched against raw archive endpoints on a network permitting hist; browser uses single-source archive fallback where CORS unavailable.
- No profit backtest or calibrated probabilities claimed. Live429 threshold/physical device zoom and full multi-hour warmup not exhaustively exercised.
