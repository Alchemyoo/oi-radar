#!/usr/bin/env python3
"""DexScreener base-side snapshot cache; Python standard library only."""
import argparse
import hashlib
from http.client import HTTPException
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "https://api.dexscreener.com/token-pairs/v1"
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
SYMBOL = re.compile(r"[A-Z0-9\u3400-\u9fff][A-Z0-9_\-\u3400-\u9fff]{0,31}\Z")
DEX = re.compile(r"[a-zA-Z0-9_-]{1,64}\Z")
MAX_POOLS = 20
MAX_POINTS = 288
HISTORY_HOURS = 72
MIN_BASELINE = timedelta(minutes=30)
MAX_BASELINE = timedelta(hours=6)
MAX_RESPONSE = 3 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024


class CollectionError(Exception):
    pass


class RateLimited(CollectionError):
    pass


def utcnow():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_time(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except ValueError:
        return None


def number(value, integer=False):
    """Missing stays missing; invalid numeric data rejects the whole pool."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("invalid metric")
    if isinstance(value, str) and len(value) > 100:
        raise ValueError("invalid metric")
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise ValueError("invalid metric") from None
    if not math.isfinite(result) or result < 0:
        raise ValueError("invalid metric")
    if integer:
        if not result.is_integer() or result > 9007199254740991:
            raise ValueError("invalid count")
        return int(result)
    return result


def object_field(obj, key):
    value = obj.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("invalid object")
    return value


def load_json(path, default=None):
    if not path.exists():
        if default is not None:
            return default
        raise CollectionError("registry_missing")
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_FILE + 1)
        if len(raw) > MAX_FILE:
            raise ValueError("too large")
        value = json.loads(raw)
        if (not isinstance(value, dict) or type(value.get("schemaVersion")) is not int
                or value["schemaVersion"] != 1):
            raise ValueError("invalid schema")
        return value
    except (OSError, ValueError, RecursionError):
        raise CollectionError("invalid_local_json") from None


def registry_tokens(registry):
    tokens = registry.get("tokens")
    if not isinstance(tokens, list) or not 1 <= len(tokens) <= 64:
        raise CollectionError("invalid_registry")
    seen = set()
    result = []
    for token in tokens:
        if not isinstance(token, dict):
            raise CollectionError("invalid_registry")
        symbol, address = token.get("symbol"), token.get("address")
        if (not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol)
                or symbol in seen or token.get("chain") != "bsc"
                or type(token.get("chainId")) is not int or token["chainId"] != 56
                or not isinstance(address, str) or not ADDRESS.fullmatch(address)):
            raise CollectionError("invalid_registry")
        name = token.get("name")
        if name is not None and (not isinstance(name, str) or len(name) > 120
                                 or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            raise CollectionError("invalid_registry")
        if token.get("verifiedAt") is not None and parse_time(token["verifiedAt"]) is None:
            raise CollectionError("invalid_registry")
        seen.add(symbol)
        result.append({"symbol": symbol, "chain": "bsc", "chainId": 56,
                       "address": address.lower(), "name": name,
                       "verifiedAt": token.get("verifiedAt")})
    return result


def fetch_pairs(identity, opener=urlopen, pause=time.sleep):
    url = f"{API}/{identity['chain']}/{identity['address']}"
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "oi-radar-onchain/1"})
    for attempt in range(2):
        try:
            with opener(request, timeout=10) as response:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise CollectionError("response_too_large")
            pairs = json.loads(raw)
            if not isinstance(pairs, list) or len(pairs) > 10000:
                raise CollectionError("invalid_api_shape")
            return pairs
        except HTTPError as error:
            if error.code == 429:
                raise RateLimited("rate_limited") from None
            if error.code < 500 or attempt == 1:
                raise CollectionError(f"http_{error.code}") from None
        except (URLError, TimeoutError, OSError, HTTPException):
            if attempt == 1:
                raise CollectionError("network_error") from None
        except (ValueError, RecursionError):
            raise CollectionError("invalid_api_json") from None
        pause(1)
    raise CollectionError("network_error")


def normalize_pool(pair, identity):
    if not isinstance(pair, dict) or pair.get("chainId") != identity["chain"]:
        return None
    base = pair.get("baseToken")
    if not isinstance(base, dict) or not isinstance(base.get("address"), str):
        return None
    # Only this validated EVM chain is case-normalized; never flip quote-side pools.
    if base["address"].lower() != identity["address"]:
        return None
    address, dex = pair.get("pairAddress"), pair.get("dexId")
    if not isinstance(address, str) or not ADDRESS.fullmatch(address):
        raise ValueError("invalid pair")
    if not isinstance(dex, str) or not DEX.fullmatch(dex):
        raise ValueError("invalid dex")
    liquidity = number(object_field(pair, "liquidity").get("usd"))
    volume = object_field(pair, "volume")
    txns = object_field(pair, "txns")
    counts = {}
    for interval in ("h1", "h24"):
        row = object_field(txns, interval)
        counts[interval] = {side: number(row.get(side), integer=True) for side in ("buys", "sells")}
    return {"pairAddress": address.lower(), "dexId": dex, "liquidityUsd": liquidity,
            "volumeUsd": {k: number(volume.get(k)) for k in ("h1", "h24")},
            "txns": counts, "priceUsd": number(pair.get("priceUsd")),
            "url": f"https://dexscreener.com/{identity['chain']}/{address.lower()}"}


def aggregate(values):
    known = sum(value is not None for value in values)
    coverage = {"knownPools": known, "totalPools": len(values), "complete": known == len(values)}
    if known != len(values):
        return None, coverage
    total = sum(values)
    if not math.isfinite(total):
        raise CollectionError("aggregate_overflow")
    return total, coverage


def snapshot(identity, pairs, at):
    dedup, invalid, unmatched, duplicates = {}, 0, 0, 0
    for raw in pairs:
        try:
            pool = normalize_pool(raw, identity)
        except (ValueError, OverflowError):
            invalid += 1
            continue
        if pool is None:
            unmatched += 1
            continue
        key = (identity["chain"], pool["pairAddress"])
        if key in dedup:
            duplicates += 1
            # Conflicting duplicates are ambiguous, not safe to silently sum/select.
            if dedup[key] != pool:
                raise CollectionError("conflicting_duplicate_pool")
        else:
            dedup[key] = pool
    if not dedup:
        raise CollectionError("no_accepted_base_pools")
    pools = sorted(dedup.values(), key=lambda p: (-(p["liquidityUsd"] if p["liquidityUsd"] is not None else -1), p["pairAddress"]))[:MAX_POOLS]
    fields = {}
    liquidity, fields["liquidityUsd"] = aggregate([p["liquidityUsd"] for p in pools])
    volume, counts = {}, {}
    for interval in ("h1", "h24"):
        volume[interval], fields[f"volumeUsd.{interval}"] = aggregate([p["volumeUsd"][interval] for p in pools])
        counts[interval] = {}
        for side in ("buys", "sells"):
            counts[interval][side], fields[f"txns.{interval}.{side}"] = aggregate([p["txns"][interval][side] for p in pools])
    primary = next((p["pairAddress"] for p in pools if p["liquidityUsd"] is not None), None)
    fingerprint = hashlib.sha256(json.dumps([identity["chain"], identity["address"], sorted(p["pairAddress"] for p in pools)], separators=(",", ":")).encode()).hexdigest()
    return {"status": "ok", "identity": identity, "fetchedAt": stamp(at), "lastAttemptAt": stamp(at),
            "coverage": {"chain": identity["chain"], "returnedPools": len(pairs),
                         "acceptedPools": len(dedup), "selectedPools": len(pools),
                         "invalidPools": invalid, "unmatchedPools": unmatched,
                         "duplicatePools": duplicates, "truncated": len(dedup) > MAX_POOLS,
                         "scope": "API-returned measurable base-side pools; selected top <=20",
                         "fields": fields},
            "liquidityUsd": liquidity, "volumeUsd": volume, "txns": counts,
            "primaryPairAddress": primary, "priceUsd": pools[0]["priceUsd"] if primary else None,
            "buySellUsd": None, "liquidityChangePct": None, "liquidityBaselineAt": None,
            "liquidityChangeKind": "snapshot_difference_including_price_effects_not_net_flow",
            "poolFingerprint": fingerprint, "pools": pools}


def prune_points(points, now):
    clean = {}
    if not isinstance(points, list):
        return []
    for point in points:
        if not isinstance(point, dict):
            continue
        at = parse_time(point.get("at"))
        fingerprint = point.get("poolFingerprint")
        try:
            liquidity = number(point.get("liquidityUsd"))
        except ValueError:
            continue
        if (at is not None and now - timedelta(hours=HISTORY_HOURS) <= at <= now
                and liquidity is not None and isinstance(fingerprint, str)
                and re.fullmatch(r"[a-f0-9]{64}", fingerprint)):
            clean[at] = {"at": stamp(at), "liquidityUsd": liquidity, "poolFingerprint": fingerprint}
    return [clean[at] for at in sorted(clean)][-MAX_POINTS:]


def add_baseline(token, points, now):
    points = prune_points(points, now)
    if token["liquidityUsd"] is None:
        return points
    candidates = [p for p in points
                  if MIN_BASELINE <= now - parse_time(p["at"]) <= MAX_BASELINE
                  and p["poolFingerprint"] == token["poolFingerprint"]
                  and p["liquidityUsd"] > 0]
    if candidates:
        baseline = candidates[-1]
        change = (token["liquidityUsd"] / baseline["liquidityUsd"] - 1) * 100
        if math.isfinite(change):
            token["liquidityChangePct"] = change
            token["liquidityBaselineAt"] = baseline["at"]
    points.append({"at": stamp(now), "liquidityUsd": token["liquidityUsd"],
                   "poolFingerprint": token["poolFingerprint"]})
    return prune_points(points, now)


def reusable(previous, identity):
    if not isinstance(previous, dict) or previous.get("status") not in ("ok", "stale"):
        return False
    prior_identity = previous.get("identity")
    if not isinstance(prior_identity, dict):
        return False
    return (all(prior_identity.get(k) == identity[k] for k in ("symbol", "chain", "chainId", "address"))
            and parse_time(previous.get("fetchedAt")) is not None
            and isinstance(previous.get("pools"), list) and bool(previous["pools"]))


def collect(registry, previous, history, fetcher=fetch_pairs, clock=utcnow):
    identities = registry_tokens(registry)
    prior = previous.get("tokens", {})
    historical = history.get("tokens", {})
    if not isinstance(prior, dict) or not isinstance(historical, dict):
        raise CollectionError("invalid_cache_schema")
    tokens, histories = {}, {}
    limited = False
    for identity in identities:
        symbol = identity["symbol"]
        attempt = clock()
        points = prune_points(historical.get(symbol, []), attempt)
        try:
            if limited:
                raise RateLimited("rate_limited")
            pairs = fetcher(identity)
            fetched = clock()
            if not isinstance(pairs, list) or len(pairs) > 10000:
                raise CollectionError("invalid_api_shape")
            token = snapshot(identity, pairs, fetched)
            token["lastAttemptAt"] = stamp(attempt)
            points = add_baseline(token, points, fetched)
        except (CollectionError, TimeoutError, URLError, OSError) as error:
            limited = limited or isinstance(error, RateLimited)
            # Only internally generated error codes reach cache/logs. Never echo API text.
            code = str(error) if isinstance(error, CollectionError) else "network_error"
            if not re.fullmatch(r"[a-z0-9_]{1,64}", code):
                code = "collection_error"
            old = prior.get(symbol)
            if reusable(old, identity):
                token = dict(old)
                token.update(status="stale", identity=identity, lastAttemptAt=stamp(attempt), error=code)
            else:
                token = {"status": "error", "identity": identity, "fetchedAt": None,
                         "lastAttemptAt": stamp(attempt), "error": code,
                         "coverage": {"chain": identity["chain"], "returnedPools": None,
                                      "acceptedPools": 0, "selectedPools": 0},
                         "liquidityUsd": None, "volumeUsd": {"h1": None, "h24": None},
                         "txns": {k: {"buys": None, "sells": None} for k in ("h1", "h24")},
                         "buySellUsd": None, "liquidityChangePct": None,
                         "liquidityBaselineAt": None, "pools": []}
        tokens[symbol], histories[symbol] = token, points
    now = clock()
    ok = sum(t["status"] == "ok" for t in tokens.values())
    stale = sum(t["status"] == "stale" for t in tokens.values())
    status = "ok" if ok == len(tokens) else "partial" if ok else "stale" if stale else "error"
    output = {"schemaVersion": 1, "generatedAt": stamp(now), "status": status,
              "collectionMode": "actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "manual",
              "source": "DexScreener token-pairs/v1", "sourceTimestampAvailable": False,
              "tokens": tokens}
    cache = {"schemaVersion": 1, "generatedAt": stamp(now), "retentionHours": HISTORY_HOURS,
             "maxPointsPerToken": MAX_POINTS,
             "tokens": {s: prune_points(p, now) for s, p in histories.items()}}
    return output, cache, 0 if ok or stale else 1


def atomic_json(path, value):
    payload = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".onchain-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=root / "onchain.registry.json")
    parser.add_argument("--data-dir", type=Path, default=root / "data")
    parser.add_argument("--include-evidence", action="store_true",
                        help="Opt in to separate DEX/disabled-transfer evidence channels; no new network calls")
    args = parser.parse_args(argv)
    try:
        registry = load_json(args.registry)
        previous = load_json(args.data_dir / "onchain.json", {"schemaVersion": 1, "tokens": {}})
        history = load_json(args.data_dir / "onchain-history.json", {"schemaVersion": 1, "tokens": {}})
        output, cache, code = collect(registry, previous, history)
        if args.include_evidence:
            from onchain_evidence import attach_evidence
            attach_evidence(output)
        # History first: after interruption it may advance, but never advertises live token freshness.
        atomic_json(args.data_dir / "onchain-history.json", cache)
        atomic_json(args.data_dir / "onchain.json", output)
        counts = {s: sum(t["status"] == s for t in output["tokens"].values()) for s in ("ok", "stale", "error")}
        print("onchain: " + json.dumps(counts, sort_keys=True))
        return code
    except (CollectionError, OSError, ValueError):
        print("onchain: failed (invalid registry/cache or local write)", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
