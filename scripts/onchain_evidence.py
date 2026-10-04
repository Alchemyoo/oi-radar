"""Optional evidence v1 adapter. Offline only; never discovers token addresses."""
import copy
import math
import re
from datetime import datetime
from urllib.parse import urlsplit

ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
RAW = re.compile(r"(?:0|[1-9][0-9]{0,77})\Z")
MIN_USD = 100000
MIN_PCT = 10
MAX_EVENTS = 1000


def date(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except ValueError:
        return None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def same_identity(a, b):
    return (isinstance(a, dict) and isinstance(b, dict)
            and all(a.get(k) == b.get(k) for k in ("symbol", "chain", "chainId"))
            and isinstance(a.get("address"), str) and ADDRESS.fullmatch(a["address"])
            and a["address"].lower() == str(b.get("address", "")).lower())


def dex_channel(row):
    """DEX liquidity valuation difference, deliberately NOT a transfer/net-flow signal."""
    events = []
    pct, current = row.get("liquidityChangePct"), row.get("liquidityUsd")
    baseline, observed = date(row.get("liquidityBaselineAt")), date(row.get("fetchedAt"))
    fingerprint = row.get("poolFingerprint")
    if (row.get("status") == "ok" and finite(pct) and pct > -100
            and abs(pct) >= MIN_PCT and finite(current) and current >= 0
            and baseline is not None and observed is not None
            and 1800 <= (observed - baseline).total_seconds() <= 21600
            and isinstance(fingerprint, str) and re.fullmatch(r"[a-f0-9]{64}", fingerprint)):
        delta = current - current / (1 + pct / 100)
        if math.isfinite(delta) and abs(delta) >= MIN_USD:
            events.append({"kind": "liquidity_snapshot_change", "deltaUsd": delta,
                           "changePct": pct, "baselineAt": row["liquidityBaselineAt"],
                           "observedAt": row["fetchedAt"], "poolFingerprint": fingerprint,
                           "containsPriceEffects": True, "notNetFlow": True})
    return {"status": row.get("status", "error"), "identity": copy.deepcopy(row["identity"]),
            "fetchedAt": row.get("fetchedAt"), "lastAttemptAt": row.get("lastAttemptAt"),
            "source": "DexScreener token-pairs/v1", "sourceTimestampAvailable": False,
            "window": {"kind": "provider_rolling", "hours": [1, 24]},
            "coverage": copy.deepcopy(row.get("coverage", {})),
            "thresholds": {"liquidityAbsUsd": MIN_USD, "liquidityAbsPct": MIN_PCT},
            "anomalies": events}


def disabled_transfers(identity):
    return {"status": "disabled", "identity": copy.deepcopy(identity), "source": None,
            "fetchedAt": None, "lastAttemptAt": None, "window": None,
            "coverage": {"complete": False, "reason": "transfer_provider_not_configured"},
            "events": [], "anomalies": []}


def transfer_channel(identity, payload):
    """Strict adapter for a future reviewed provider; not invoked by the collector.

    Payload contract: exact identity, HTTPS provenance, bounded complete UTC window,
    finalized EVM logs and independently timestamped USD valuations. No wallet labels
    or inferred buys/sells. Invalid/ambiguous input fails closed, not partial success.
    """
    def reject():
        raise ValueError("invalid_transfer_evidence")

    if not isinstance(payload, dict) or not same_identity(payload.get("identity"), identity):
        reject()
    if identity.get("chain") != "bsc" or identity.get("chainId") != 56:
        reject()
    source = payload.get("source")
    if not isinstance(source, str) or len(source) > 2048:
        reject()
    try:
        url = urlsplit(source)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            reject()
    except ValueError:
        reject()
    fetched = date(payload.get("fetchedAt"))
    attempt = date(payload.get("lastAttemptAt"))
    window = payload.get("window")
    if not isinstance(window, dict):
        reject()
    start, end = date(window.get("from")), date(window.get("to"))
    coverage = payload.get("coverage")
    if (fetched is None or attempt is None or start is None or end is None
            or not 0 < (end - start).total_seconds() <= 86400 or end > fetched
            or not isinstance(coverage, dict) or coverage.get("complete") is not True
            or coverage.get("finality") != "finalized"):
        reject()
    rows = payload.get("events")
    if not isinstance(rows, list) or len(rows) > MAX_EVENTS:
        reject()
    seen = {}
    for event in rows:
        if not isinstance(event, dict):
            reject()
        block_time = date(event.get("blockTime"))
        if (not isinstance(event.get("tokenAddress"), str)
                or event["tokenAddress"].lower() != identity["address"].lower()
                or any(not isinstance(event.get(k), str) or not ADDRESS.fullmatch(event[k])
                       for k in ("from", "to"))
                or any(not isinstance(event.get(k), str) or not HASH.fullmatch(event[k])
                       for k in ("transactionHash", "blockHash"))
                or any(type(event.get(k)) is not int or not 0 <= event[k] <= 9007199254740991
                       for k in ("blockNumber", "logIndex"))
                or event.get("finality") != "finalized" or event.get("removed") is not False
                or type(event.get("decimals")) is not int or not 0 <= event["decimals"] <= 255
                or not isinstance(event.get("amountRaw"), str) or not RAW.fullmatch(event["amountRaw"])
                or block_time is None or not start <= block_time < end):
            reject()
        usd = event.get("usdValue")
        if usd is not None:
            valuation = event.get("valuation")
            if (not finite(usd) or usd < 0 or not isinstance(valuation, dict)
                    or not isinstance(valuation.get("source"), str) or not valuation["source"]
                    or len(valuation["source"]) > 120 or date(valuation.get("at")) != block_time):
                reject()
        clean = {k: copy.deepcopy(event.get(k)) for k in (
            "tokenAddress", "from", "to", "transactionHash", "blockHash", "blockNumber",
            "logIndex", "blockTime", "finality", "removed", "decimals", "amountRaw", "usdValue", "valuation")}
        for k in ("tokenAddress", "from", "to", "transactionHash", "blockHash"):
            clean[k] = clean[k].lower()
        key = (clean["transactionHash"], clean["logIndex"])
        if key in seen and seen[key] != clean:
            reject()
        seen[key] = clean
    events = sorted(seen.values(), key=lambda e: (e["blockNumber"], e["logIndex"], e["transactionHash"]))
    anomalies = [{"kind": "large_transfer", "transactionHash": e["transactionHash"],
                  "logIndex": e["logIndex"], "usdValue": e["usdValue"], "notTrade": True}
                 for e in events if e["usdValue"] is not None and e["usdValue"] >= MIN_USD]
    return {"status": "ok", "identity": copy.deepcopy(identity), "source": source,
            "fetchedAt": payload["fetchedAt"], "lastAttemptAt": payload["lastAttemptAt"],
            "window": copy.deepcopy(window), "coverage": copy.deepcopy(coverage),
            "thresholds": {"largeTransferUsd": MIN_USD}, "events": events, "anomalies": anomalies}


def attach_evidence(output):
    """Only enabled explicitly; retains all original v1 fields and row statuses."""
    for row in output["tokens"].values():
        row["evidence"] = {"schemaVersion": 1, "dex": dex_channel(row),
                           "transfers": disabled_transfers(row["identity"])}
    return output
