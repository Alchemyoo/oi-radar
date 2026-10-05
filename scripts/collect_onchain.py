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
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "https://api.dexscreener.com/token-pairs/v1"
BATCH_API = "https://api.dexscreener.com/tokens/v1"
ADDRESS = re.compile(r"0[xX][0-9a-fA-F]{40}\Z")
SYMBOL = re.compile(r"[A-Z0-9\u3400-\u9fff][A-Z0-9_\-\u3400-\u9fff]{0,31}\Z")
DEX = re.compile(r"[a-zA-Z0-9_-]{1,64}\Z")
MAX_POOLS = 20
MAX_POINTS = 288
HISTORY_HOURS = 72
MIN_BASELINE = timedelta(minutes=30)
MAX_BASELINE = timedelta(hours=6)
MAX_RESPONSE = 3 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024
MAX_TOKENS = 1000
MAX_BATCH_ADDRESSES = 30
MAX_WORKERS = 4
REQUEST_INTERVAL = 0.20

# DexScreener uses its chain slug in token-pairs/v1.  EVM addresses are
# case-insensitive, while Solana public keys are case-sensitive.  Sui is
# deliberately catalogued but has no collector adapter in this repository.
CHAIN_SPECS = {
    "ethereum": (1, "evm"),
    "bsc": (56, "evm"),
    "base": (8453, "evm"),
    "arbitrum": (42161, "evm"),
    "optimism": (10, "evm"),
    "polygon": (137, "evm"),
    "avalanche": (43114, "evm"),
    "linea": (59144, "evm"),
    "solana": ("CT_501", "solana"),
    "sui": ("CT_784", "unsupported"),
}
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SUI_ADDRESS = re.compile(r"0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*\Z")


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


def _valid_solana_address(address):
    if not isinstance(address, str) or not 32 <= len(address) <= 44:
        return False
    if any(char not in BASE58 for char in address):
        return False
    value = 0
    for char in address:
        value = value * 58 + BASE58.index(char)
    leading_zeroes = len(address) - len(address.lstrip("1"))
    return leading_zeroes + (value.bit_length() + 7) // 8 == 32


def _valid_sui_address(address):
    return isinstance(address, str) and bool(SUI_ADDRESS.fullmatch(address)) and int(address.split("::", 1)[0][2:], 16) != 0


def _address_kind(chain):
    spec = CHAIN_SPECS.get(chain)
    return spec[1] if spec else None


def _valid_address(chain, address):
    kind = _address_kind(chain)
    if kind == "evm":
        return isinstance(address, str) and bool(ADDRESS.fullmatch(address)) and int(address[2:], 16) != 0
    if kind == "solana":
        return _valid_solana_address(address)
    if kind == "unsupported":
        return _valid_sui_address(address)
    return False


def _canonical_address(chain, address):
    return address.lower() if _address_kind(chain) == "evm" else address


def registry_tokens(registry):
    tokens = registry.get("tokens")
    if not isinstance(tokens, list) or not 1 <= len(tokens) <= MAX_TOKENS:
        raise CollectionError("invalid_registry")
    seen = set()
    result = []
    for token in tokens:
        if not isinstance(token, dict):
            raise CollectionError("invalid_registry")
        symbol, chain, chain_id, address = (token.get(key) for key in
                                             ("symbol", "chain", "chainId", "address"))
        spec = CHAIN_SPECS.get(chain)
        if (not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol) or symbol in seen
                or spec is None or chain_id != spec[0]
                or not _valid_address(chain, address)):
            raise CollectionError("invalid_registry")
        name = token.get("name")
        if name is not None and (not isinstance(name, str) or len(name) > 120
                                 or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            raise CollectionError("invalid_registry")
        if token.get("verifiedAt") is not None and parse_time(token["verifiedAt"]) is None:
            raise CollectionError("invalid_registry")
        seen.add(symbol)
        result.append({"symbol": symbol, "chain": chain, "chainId": chain_id,
                       "address": _canonical_address(chain, address), "name": name,
                       "verifiedAt": token.get("verifiedAt"),
                       "adapterSupported": _address_kind(chain) != "unsupported"})
    return result


def _fetch_json(url, opener, pause, before_attempt=None):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "oi-radar-onchain/1"})
    for attempt in range(2):
        if before_attempt:
            before_attempt()
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


def fetch_pairs(identity, opener=urlopen, pause=time.sleep):
    """Fetch one token, retained as the small/fixture-friendly API."""
    return _fetch_json(f"{API}/{identity['chain']}/{identity['address']}", opener, pause)


class _RateLimiter:
    def __init__(self, interval=REQUEST_INTERVAL):
        self.interval = max(0.0, float(interval))
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            delay = max(0.0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if delay:
            time.sleep(delay)


def _batch_url(batch):
    chain = batch[0]["chain"]
    addresses = ",".join(identity["address"] for identity in batch)
    return f"{BATCH_API}/{chain}/{addresses}"


def fetch_pairs_batched(identities, opener=urlopen, pause=time.sleep, workers=MAX_WORKERS,
                        interval=REQUEST_INTERVAL):
    """Fetch up to 30 same-chain addresses per DexScreener request.

    The return value is (pairs-by-identity-key, error-by-identity-key).  A
    failed request only affects its batch, allowing other chains/batches to
    produce useful partial output.  Matching is repeated by snapshot(), which
    is the strict base-side identity gate.
    """
    supported = [i for i in identities if i.get("adapterSupported", _address_kind(i.get("chain")) != "unsupported")]
    groups = {}
    for i in supported:
        key = (i["chain"], _canonical_address(i["chain"], i["address"]))
        groups.setdefault(key, []).append(i)
    unique = [rows[0] for rows in groups.values()]
    batches = []
    for chain in sorted({i["chain"] for i in unique}):
        rows = [i for i in unique if i["chain"] == chain]
        batches.extend(rows[offset:offset + MAX_BATCH_ADDRESSES]
                       for offset in range(0, len(rows), MAX_BATCH_ADDRESSES))
    results, errors = {}, {}
    limiter = _RateLimiter(interval)
    halted = threading.Event()

    def permit():
        if halted.is_set():
            raise RateLimited("rate_limited")
        limiter.wait()
        if halted.is_set():
            raise RateLimited("rate_limited")

    def request(batch):
        try:
            return _fetch_json(_batch_url(batch), opener, pause, permit)
        except RateLimited:
            halted.set()
            raise

    if not batches:
        return results, errors
    with ThreadPoolExecutor(max_workers=max(1, min(int(workers), len(batches)))) as pool:
        pending = {pool.submit(request, batch): batch for batch in batches}
        for future in as_completed(pending):
            batch = pending[future]
            try:
                pairs = future.result()
                by_address = {}
                for pair in pairs:
                    if isinstance(pair, dict) and isinstance(pair.get("baseToken"), dict):
                        address = pair["baseToken"].get("address")
                        if isinstance(address, str):
                            key = _canonical_address(batch[0]["chain"], address)
                            by_address.setdefault(key, []).append(pair)
                for identity in batch:
                    key = (identity["chain"], _canonical_address(identity["chain"], identity["address"]))
                    for alias in groups[key]:
                        results[alias["symbol"]] = by_address.get(key[1], [])
            except (CollectionError, TimeoutError, URLError, OSError) as error:
                code = str(error) if isinstance(error, CollectionError) else "network_error"
                if not re.fullmatch(r"[a-z0-9_]{1,64}", code):
                    code = "collection_error"
                for identity in batch:
                    key = (identity["chain"], _canonical_address(identity["chain"], identity["address"]))
                    for alias in groups[key]:
                        errors[alias["symbol"]] = code
    return results, errors


def normalize_pool(pair, identity):
    if not isinstance(pair, dict) or pair.get("chainId") != identity["chain"]:
        return None
    base = pair.get("baseToken")
    if not isinstance(base, dict) or not isinstance(base.get("address"), str):
        return None
    # EVM matching is case-insensitive; Solana public keys are case-sensitive.
    # This is intentionally baseToken-only: a quote-side match never flips.
    if _canonical_address(identity["chain"], base["address"]) != identity["address"]:
        return None
    address, dex = pair.get("pairAddress"), pair.get("dexId")
    if not isinstance(address, str) or not _valid_address(identity["chain"], address):
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
    pair_address = _canonical_address(identity["chain"], address)
    return {"pairAddress": pair_address, "dexId": dex, "liquidityUsd": liquidity,
            "volumeUsd": {k: number(volume.get(k)) for k in ("h1", "h24")},
            "txns": counts, "priceUsd": number(pair.get("priceUsd")),
            "url": f"https://dexscreener.com/{identity['chain']}/{pair_address}"}


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


def _error_token(identity, attempt, code, previous=None):
    old = previous.get(identity["symbol"]) if isinstance(previous, dict) else None
    if reusable(old, identity):
        token = dict(old)
        token.update(status="stale", identity=identity, lastAttemptAt=stamp(attempt), error=code)
        return token
    return {"status": "error", "identity": identity, "fetchedAt": None,
            "lastAttemptAt": stamp(attempt), "error": code,
            "coverage": {"chain": identity["chain"], "returnedPools": None,
                         "acceptedPools": 0, "selectedPools": 0},
            "liquidityUsd": None, "volumeUsd": {"h1": None, "h24": None},
            "txns": {k: {"buys": None, "sells": None} for k in ("h1", "h24")},
            "buySellUsd": None, "liquidityChangePct": None,
            "liquidityBaselineAt": None, "pools": []}


def _unsupported_token(identity, attempt):
    return {"status": "unsupported", "identity": identity, "fetchedAt": None,
            "lastAttemptAt": stamp(attempt), "error": "unsupported_chain_adapter",
            "coverage": {"chain": identity["chain"], "adapterSupported": False,
                         "returnedPools": None, "acceptedPools": 0, "selectedPools": 0},
            "liquidityUsd": None, "volumeUsd": {"h1": None, "h24": None},
            "txns": {k: {"buys": None, "sells": None} for k in ("h1", "h24")},
            "buySellUsd": None, "liquidityChangePct": None,
            "liquidityBaselineAt": None, "pools": []}


def collect(registry, previous, history, fetcher=fetch_pairs, clock=utcnow):
    identities = registry_tokens(registry)
    prior = previous.get("tokens", {})
    historical = history.get("tokens", {})
    if not isinstance(prior, dict) or not isinstance(historical, dict):
        raise CollectionError("invalid_cache_schema")
    tokens, histories = {}, {}
    # The production/default path uses bounded same-chain batches.  Injected
    # fetchers remain one-token calls so existing offline tests stay deterministic.
    batched, batch_errors = ({}, {})
    if fetcher is fetch_pairs:
        batched, batch_errors = fetch_pairs_batched(identities)
    limited = False
    for identity in identities:
        symbol = identity["symbol"]
        attempt = clock()
        points = prune_points(historical.get(symbol, []), attempt)
        if not identity["adapterSupported"]:
            token = _unsupported_token(identity, attempt)
            tokens[symbol], histories[symbol] = token, points
            continue
        try:
            if limited:
                raise RateLimited("rate_limited")
            if fetcher is fetch_pairs:
                if symbol in batch_errors:
                    raise CollectionError(batch_errors[symbol])
                pairs = batched.get(symbol, [])
            else:
                pairs = fetcher(identity)
            fetched = clock()
            if not isinstance(pairs, list) or len(pairs) > 10000:
                raise CollectionError("invalid_api_shape")
            token = snapshot(identity, pairs, fetched)
            token["lastAttemptAt"] = stamp(attempt)
            points = add_baseline(token, points, fetched)
        except (CollectionError, TimeoutError, URLError, OSError) as error:
            limited = limited or isinstance(error, RateLimited)
            code = str(error) if isinstance(error, CollectionError) else "network_error"
            if not re.fullmatch(r"[a-z0-9_]{1,64}", code):
                code = "collection_error"
            token = _error_token(identity, attempt, code, prior)
        tokens[symbol], histories[symbol] = token, points
    now = clock()
    ok = sum(t["status"] == "ok" for t in tokens.values())
    stale = sum(t["status"] == "stale" for t in tokens.values())
    unsupported = sum(t["status"] == "unsupported" for t in tokens.values())
    active = len(tokens) - unsupported
    successful = ok + stale
    status = ("ok" if ok == len(tokens) else
              "stale" if stale == len(tokens) and stale else
              "partial" if successful or unsupported else
              "error")
    output = {"schemaVersion": 1, "generatedAt": stamp(now), "status": status,
              "collectionMode": "actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "manual",
              "source": "DexScreener tokens/v1 (batched); token-pairs/v1 (single)", "sourceTimestampAvailable": False,
              "tokens": tokens}
    cache = {"schemaVersion": 1, "generatedAt": stamp(now), "retentionHours": HISTORY_HOURS,
             "maxPointsPerToken": MAX_POINTS,
             "tokens": {s: prune_points(p, now) for s, p in histories.items()}}
    return output, cache, 0 if successful or active == 0 else 1


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
