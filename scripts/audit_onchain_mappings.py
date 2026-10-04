#!/usr/bin/env python3
"""Audit all TRADING perpetuals from an archived exchangeInfo; never auto-register."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
import collect_onchain as c


def audit(exchange_info, registry):
    identities = c.registry_tokens(registry)
    for token in registry["tokens"]:
        sources = token.get("sources")
        if c.parse_time(token.get("verifiedAt")) is None or not isinstance(sources, list) or not sources:
            raise ValueError("missing_verification_provenance")
        for source in sources:
            url = urlsplit(source.get("url", "")) if isinstance(source, dict) else None
            if not url or url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("invalid_verification_provenance")
    symbols = exchange_info.get("symbols") if isinstance(exchange_info, dict) else None
    if not isinstance(symbols, list) or len(symbols) > 10000:
        raise ValueError("invalid_exchange_info")
    mapped = {t["symbol"]: t for t in identities}
    rows, seen = [], set()
    for item in symbols:
        if not isinstance(item, dict):
            raise ValueError("invalid_exchange_info")
        if item.get("contractType") != "PERPETUAL" or item.get("status") != "TRADING":
            continue
        symbol = item.get("symbol")
        if not isinstance(symbol, str) or not c.SYMBOL.fullmatch(symbol) or symbol in seen:
            raise ValueError("invalid_exchange_symbol")
        seen.add(symbol)
        identity = mapped.get(symbol)
        rows.append({"symbol": symbol, "baseAsset": item.get("baseAsset"),
                     "quoteAsset": item.get("quoteAsset"),
                     "mappingStatus": "registered_bsc" if identity else "pending_verification",
                     "identity": identity, "dexSupport": "base_side_snapshot" if identity else "unavailable",
                     "transferSupport": "not_configured"})
    rows.sort(key=lambda r: r["symbol"])
    return {"schemaVersion": 1, "source": "caller_archived_exchangeInfo",
            "exchangeServerTime": exchange_info.get("serverTime"),
            "counts": {"tradingPerpetuals": len(rows), "registered": sum(r["identity"] is not None for r in rows),
                       "pending": sum(r["identity"] is None for r in rows)},
            "inactiveRegistrySymbols": sorted(set(mapped) - seen), "symbols": rows,
            "note": "Coverage audit only; registered is not fresh independent re-verification. No symbol-name/address inference."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exchange-info", type=Path, required=True)
    parser.add_argument("--registry", type=Path, default=Path(__file__).resolve().parents[1] / "onchain.registry.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    # An audit may never overwrite any input or production registry/cache/history.
    protected = {args.exchange_info.resolve(), args.registry.resolve()}
    root = Path(__file__).resolve().parents[1]
    protected.update((root / p).resolve() for p in ("onchain.registry.json", "data/onchain.json", "data/onchain-history.json"))
    if args.output.resolve() in protected:
        parser.error("output must be an isolated audit file")
    try:
        raw = args.exchange_info.read_bytes()
        if len(raw) > c.MAX_FILE:
            raise ValueError("oversize_exchange_info")
        output = audit(json.loads(raw), c.load_json(args.registry))
        c.atomic_json(args.output, output)
        print("mapping audit: " + json.dumps(output["counts"], sort_keys=True))
        return 0
    except (ValueError, OSError, c.CollectionError):
        print("mapping audit: failed (invalid input or provenance)")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
