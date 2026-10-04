#!/usr/bin/env python3
"""Build a review-only registry from archived evidence; never query live APIs.

Default scope is EVERY TRADING PERPETUAL, without a quote-asset filter. Use
--include-inactive for pending/settling PERPETUALs too. Identity is established by
exact Alpha cexCoinName, or exact Binance assetCode plus a UNIQUE CoinGecko id
matching BOTH official assetName (case/whitespace only) and symbol (casefold).
CoinGecko addresses are provider_matched, NOT independently project-verified.

Optional --overrides JSON: {"schemaVersion": 1, "overrides": {"BASE": {
  "coingeckoId": "explicit-id", "expectedName": "Vetted name",
  "expectedSymbol": "base", "reason": "Evidence for rename/identity",
  "sources": [{"label": "Official evidence", "url": "https://..."}],
  "denomination": 1
}}}. A changed symbol requires an explicit denomination (even if 1). Numeric
prefixes are NEVER stripped. Overrides are caller-vetted evidence, not a claim
that this builder independently verified the project.
"""
import argparse
import copy
import hashlib
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
SOURCE_URLS = {
    "exchange_info": "https://fapi.binance.com/fapi/v1/exchangeInfo",
    "binance_assets": "https://www.binance.com/bapi/asset/v2/public/asset/asset/get-all-asset",
    "binance_alpha": "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list",
    "coingecko": "https://api.coingecko.com/api/v3/coins/list?include_platform=true",
}
# platform -> (collector/DexScreener chain key, Binance chain id, address kind)
CHAIN_ADAPTERS = {
    "ethereum": ("ethereum", 1, "evm"),
    "binance-smart-chain": ("bsc", 56, "evm"),
    "base": ("base", 8453, "evm"),
    "arbitrum-one": ("arbitrum", 42161, "evm"),
    "optimistic-ethereum": ("optimism", 10, "evm"),
    "polygon-pos": ("polygon", 137, "evm"),
    "avalanche": ("avalanche", 43114, "evm"),
    "solana": ("solana", "CT_501", "solana"),
    "linea": ("linea", 59144, "evm"),
    "sui": ("sui", "CT_784", "sui"),
}
ALPHA_PLATFORMS = {str(value[1]): key for key, value in CHAIN_ADAPTERS.items()}
PLATFORM_PRIORITY = {key: rank for rank, key in enumerate(CHAIN_ADAPTERS)}
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
EVM = re.compile(r"0x[0-9a-fA-F]{40}\Z")
SUI = re.compile(r"0x([0-9a-fA-F]{1,64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)\Z")


def normalized_name(value):
    # Do NOT remove punctuation, transliterate, or apply fuzzy/alias matching.
    return " ".join(value.split()).casefold()


def record_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def source_ref(source_id, record, record_id, manifest):
    result = {"sourceId": source_id, "recordId": str(record_id),
              "recordSha256": record_hash(record),
              "inputSha256": manifest[source_id]["sha256"]}
    if manifest[source_id].get("url"):
        result["url"] = manifest[source_id]["url"]
    return result


def merge_sources(*groups):
    seen, result = set(), []
    for group in groups:
        for source in group:
            key = json.dumps(source, sort_keys=True, ensure_ascii=False)
            if key not in seen:
                seen.add(key)
                result.append(copy.deepcopy(source))
    return result


def positive_integer(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    if isinstance(value, str) and not re.fullmatch(r"[1-9][0-9]*", value):
        return None
    number = int(value)
    return number if number > 0 else None


def validate_address(platform, address):
    """None means no known validator, NOT that an unsupported address is valid."""
    if not isinstance(address, str) or not address:
        return False
    spec = CHAIN_ADAPTERS.get(platform)
    if not spec:
        return None
    kind = spec[2]
    if kind == "evm":
        return bool(EVM.fullmatch(address)) and int(address[2:], 16) != 0
    if kind == "sui":
        match = SUI.fullmatch(address)
        return bool(match) and int(match[1], 16) != 0
    if not 32 <= len(address) <= 44 or any(char not in BASE58 for char in address):
        return False
    number = 0
    for char in address:
        number = number * 58 + BASE58.index(char)
    leading_zeroes = len(address) - len(address.lstrip("1"))
    return leading_zeroes + (number.bit_length() + 7) // 8 == 32


def normalized_address(platform, address):
    if validate_address(platform, address) is not True:
        return address
    kind = CHAIN_ADAPTERS[platform][2]
    if kind == "evm":
        return address.lower()
    if kind == "sui":
        package, module, struct = address.split("::")
        return "0x" + package[2:].lower().zfill(64) + "::" + module + "::" + struct
    return address  # Solana base58 addresses are CASE-SENSITIVE.


def platform_record(platform, address, verification, sources, alpha_chain_id=None):
    spec = CHAIN_ADAPTERS.get(platform)
    valid = validate_address(platform, address)
    return {"platform": platform, "chain": spec[0] if spec else platform,
            "chainId": spec[1] if spec else alpha_chain_id,
            "address": normalized_address(platform, address), "rawAddress": address,
            "addressValid": valid, "adapterSupported": spec is not None,
            "identityVerification": verification, "sources": merge_sources(sources)}


def choose_mapping(platforms):
    """Ethereum first, then official Alpha canonical chain, then fixed priority.

    Ambiguous addresses on the preferred chain fail closed. Never sum chains,
    prefer liquidity, or silently fall back from a conflicting preferred chain.
    """
    usable = [p for p in platforms if p["adapterSupported"] and p["addressValid"] is True]
    if not usable:
        nonempty = [p for p in platforms if p["rawAddress"]]
        if not nonempty:
            return None, "native_no_dex_contract", "identity_has_no_platform_contract"
        if any(p["adapterSupported"] for p in nonempty):
            return None, "invalid_contract_address", "no_valid_supported_platform_address"
        return None, "no_adapter", "identity_platforms_have_no_supported_adapter"
    ethereum = [p for p in usable if p["platform"] == "ethereum"]
    official = [p for p in usable if p["identityVerification"] == "official"]
    pool = ethereum or official or usable
    best = min(pool, key=lambda p: (PLATFORM_PRIORITY[p["platform"]], p["platform"]))["platform"]
    preferred = [p for p in usable if p["platform"] == best]
    if len({p["address"] for p in preferred}) != 1:
        return None, "ambiguous_identity", "conflicting_addresses_on_preferred_platform"
    selected = copy.deepcopy(min(preferred, key=lambda p: (p["identityVerification"] != "official", p["address"])))
    selected["sources"] = merge_sources(*(p["sources"] for p in preferred))
    selected["selectionReason"] = ("preferred_ethereum" if ethereum else
                                   "official_alpha_canonical_chain" if official else
                                   "deterministic_supported_platform_priority")
    return selected, "mapped", "single_chain_single_contract_selected"


def unwrap(data, key, label):
    if isinstance(data, dict) and "success" in data and data["success"] is not True:
        raise ValueError(label + "_upstream_failed")
    records = data.get(key) if isinstance(data, dict) else data
    if not isinstance(records, list) or any(not isinstance(r, dict) for r in records):
        raise ValueError(label + "_invalid_records")
    return records


def required_strings(records, keys, label):
    for record in records:
        if any(not isinstance(record.get(key), str) or not record[key].strip() for key in keys):
            raise ValueError(label + "_missing_identity_fields")


def make_manifest(documents, paths=None, raw_bytes=None):
    paths, raw_bytes = paths or {}, raw_bytes or {}
    result = {}
    for source_id, document in documents.items():
        data = raw_bytes.get(source_id)
        if data is None:
            data = json.dumps(document, ensure_ascii=False, sort_keys=True).encode("utf-8")
        result[source_id] = {"sourceId": source_id, "sha256": hashlib.sha256(data).hexdigest(),
                             "hashAlgorithm": "sha256", "url": SOURCE_URLS.get(source_id),
                             "path": str(paths[source_id]) if source_id in paths else None,
                             "hashScope": "archived_file_bytes" if source_id in raw_bytes else "serialized_input_fixture"}
    return result


def validate_overrides(document, coins_by_id):
    if document is None:
        return {}
    if (not isinstance(document, dict) or type(document.get("schemaVersion")) is not int
            or document["schemaVersion"] != 1 or not isinstance(document.get("overrides"), dict)):
        raise ValueError("invalid_overrides_schema")
    for base, override in document["overrides"].items():
        if not isinstance(base, str) or not base or not isinstance(override, dict):
            raise ValueError("invalid_override")
        for key in ("coingeckoId", "expectedName", "expectedSymbol", "reason"):
            if not isinstance(override.get(key), str) or not override[key].strip():
                raise ValueError("override_requires_explicit_id_name_symbol_reason:" + base)
        coin = coins_by_id.get(override["coingeckoId"])
        if (coin is None or normalized_name(coin["name"]) != normalized_name(override["expectedName"])
                or coin["symbol"].casefold() != override["expectedSymbol"].casefold()):
            raise ValueError("override_identity_not_in_archive:" + base)
        sources = override.get("sources")
        if (not isinstance(sources, list) or not sources or any(
                not isinstance(s, dict) or not isinstance(s.get("url"), str)
                or not re.fullmatch(r"https://[^\s/]+(?:/[^\s]*)?", s["url"])
                or not isinstance(s.get("label"), str) or not s["label"].strip() for s in sources)):
            raise ValueError("override_requires_evidence_urls:" + base)
        denomination = positive_integer(override.get("denomination", 1))
        if denomination is None or (base.casefold() != coin["symbol"].casefold() and "denomination" not in override):
            raise ValueError("override_requires_explicit_denomination:" + base)
    return document["overrides"]


def resolve_base(base, alpha_rows, asset_rows, coin_index, coins_by_id, overrides, manifest):
    result = {"mappingStatus": "pending_verification", "reason": "official_asset_metadata_missing",
              "identityVerification": "unmapped", "identityMethod": None,
              "name": None, "denomination": None, "denominationSource": None,
              "coingeckoId": None, "allPlatforms": [], "selectedMapping": None,
              "officialAssets": [], "alphaRecords": [], "candidateCoinGeckoIds": [],
              "sources": [], "warnings": [], "independentlyProjectVerified": False}
    assets = asset_rows.get(base, [])
    alpha = alpha_rows.get(base, [])
    asset_sources = [source_ref("binance_assets", a, a.get("id", base), manifest) for a in assets]
    result["officialAssets"] = [{"assetCode": a["assetCode"], "assetName": a["assetName"],
                                 "assetId": a.get("id")} for a in assets]
    result["sources"] = asset_sources
    matches = {}
    for asset in assets:
        key = (normalized_name(asset["assetName"]), base.casefold())
        for coin in coin_index.get(key, []):
            matches[coin["id"]] = coin
    result["candidateCoinGeckoIds"] = sorted(matches)
    coin = next(iter(matches.values())) if len(matches) == 1 else None
    override = overrides.get(base)
    if override:
        coin = coins_by_id[override["coingeckoId"]]
        override_sources = [source_ref("overrides", override, base, manifest)] + override["sources"]
        result["sources"] = merge_sources(result["sources"], override_sources)
        result["override"] = copy.deepcopy(override)
    if alpha:
        denominators = {positive_integer(a.get("denomination")) for a in alpha}
        if None in denominators or len(denominators) != 1:
            result.update(mappingStatus="ambiguous_identity", reason="alpha_denomination_missing_or_conflicting")
            result["sources"] = merge_sources(result["sources"], [
                source_ref("binance_alpha", a, a.get("alphaId", base), manifest) for a in alpha])
            return result
        if len({a["symbol"].casefold() for a in alpha}) != 1 or len({normalized_name(a["name"]) for a in alpha}) != 1:
            result.update(mappingStatus="ambiguous_identity", reason="alpha_identity_records_conflict")
            result["sources"] = merge_sources(result["sources"], [
                source_ref("binance_alpha", a, a.get("alphaId", base), manifest) for a in alpha])
            return result
        result.update(name=alpha[0]["name"], denomination=next(iter(denominators)),
                      denominationSource="binance_alpha_explicit", identityMethod="alpha_exact_cex_coin_name",
                      identityVerification="official")
        if override and positive_integer(override.get("denomination", 1)) != result["denomination"]:
            raise ValueError("override_conflicts_with_alpha_denomination:" + base)
        for row in alpha:
            source = source_ref("binance_alpha", row, row.get("alphaId", row.get("tokenId", base)), manifest)
            chain_id = str(row["chainId"])
            platform = ALPHA_PLATFORMS.get(chain_id, "alpha-chain:" + chain_id)
            result["allPlatforms"].append(platform_record(
                platform, row.get("contractAddress", ""), "official", [source], row["chainId"]))
            result["sources"] = merge_sources(result["sources"], [source])
            result["alphaRecords"].append({"alphaId": row.get("alphaId"), "tokenId": row.get("tokenId"),
                                           "cexCoinName": row["cexCoinName"], "symbol": row["symbol"],
                                           "name": row["name"], "chainId": row["chainId"],
                                           "contractAddress": row.get("contractAddress", ""),
                                           "denomination": row["denomination"], "offline": row.get("offline"),
                                           "fullyDelisted": row.get("fullyDelisted")})
        if any(a.get("offline") or a.get("fullyDelisted") for a in alpha):
            result["warnings"].append("alpha_listing_inactive_identity_evidence_only_not_live_dex_availability")
        if len(matches) > 1 and not override:
            result["warnings"].append("ambiguous_provider_bridge_not_used_alpha_identity_preserved")
    elif coin is None:
        if len(matches) > 1:
            result.update(mappingStatus="ambiguous_identity", reason="multiple_coingecko_ids_match_official_name_and_symbol")
        elif assets:
            result["reason"] = "official_name_and_symbol_no_exact_coingecko_match"
        if re.match(r"(?:[1-9][0-9]{3,}|[1-9][0-9]*M)(?:[A-Za-z_]|[^\x00-\x7f])", base):
            result["warnings"].append("numeric_multiplier_unproven_no_automatic_prefix_stripping")
        return result
    else:
        result.update(name=coin["name"], denomination=positive_integer(override.get("denomination", 1)) if override else 1,
                      denominationSource="explicit_vetted_override" if override else "exact_base_identity_no_prefix_transform",
                      identityMethod="explicit_vetted_override" if override else "binance_asset_name_and_symbol_unique_coingecko_id",
                      identityVerification="provider_matched")
    if coin:
        result["coingeckoId"] = coin["id"]
        cg_source = source_ref("coingecko", coin, coin["id"], manifest)
        bridge_sources = merge_sources(asset_sources, [cg_source], override_sources if override else [])
        result["sources"] = merge_sources(result["sources"], bridge_sources)
        # Exact provider entries remain available, including unsupported
        # networks or non-contract native markers, but never become adapters by guess.
        result["coingeckoPlatforms"] = copy.deepcopy(coin["platforms"])
        for platform, address in sorted(coin["platforms"].items()):
            result["allPlatforms"].append(platform_record(platform, address, "provider_matched", bridge_sources))
    combined = {}
    for platform in result["allPlatforms"]:
        key = (platform["platform"], platform["address"])
        if key in combined:
            existing = combined[key]
            existing["sources"] = merge_sources(existing["sources"], platform["sources"])
            if platform["identityVerification"] == "official":
                existing["identityVerification"] = "official"
        else:
            combined[key] = platform
    result["allPlatforms"] = sorted(combined.values(), key=lambda p: (p["platform"], p["address"]))
    selected, status, reason = choose_mapping(result["allPlatforms"])
    result.update(selectedMapping=selected, mappingStatus=status, reason=reason)
    if selected:
        # Official Alpha identity does not upgrade a different CG platform address.
        result["identityVerification"] = selected["identityVerification"]
    return result


def build_universe(exchange_info, binance_assets, binance_alpha, coingecko,
                   *, overrides=None, manifest=None, generated_at=None, include_inactive=False):
    documents = {"exchange_info": exchange_info, "binance_assets": binance_assets,
                 "binance_alpha": binance_alpha, "coingecko": coingecko}
    if overrides is not None:
        documents["overrides"] = overrides
    manifest = copy.deepcopy(manifest) if manifest is not None else make_manifest(documents)
    if any(source_id not in manifest or not re.fullmatch(r"[0-9a-f]{64}", manifest[source_id].get("sha256", ""))
           for source_id in documents):
        raise ValueError("invalid_input_hash_manifest")
    futures = unwrap(exchange_info, "symbols", "exchange_info")
    assets = unwrap(binance_assets, "data", "binance_assets")
    alpha = unwrap(binance_alpha, "data", "binance_alpha")
    coins = unwrap(coingecko, "data", "coingecko")
    required_strings(futures, ("symbol", "baseAsset", "quoteAsset", "contractType", "status"), "futures")
    required_strings(assets, ("assetCode", "assetName"), "binance_assets")
    required_strings(alpha, ("symbol", "name", "chainId"), "binance_alpha")
    required_strings(coins, ("id", "name"), "coingecko")
    coins_by_id, coin_index = {}, defaultdict(list)
    unindexable_coin_ids = []
    for coin in coins:
        if not isinstance(coin.get("symbol"), str):
            raise ValueError("coingecko_symbol_not_string")
        if (not isinstance(coin.get("platforms"), dict) or any(
                not isinstance(k, str) or not isinstance(v, str) for k, v in coin["platforms"].items())):
            raise ValueError("coingecko_platforms_not_string_address_map")
        if coin["id"] in coins_by_id:
            if coin != coins_by_id[coin["id"]]:
                raise ValueError("conflicting_coingecko_id:" + coin["id"])
            continue
        coins_by_id[coin["id"]] = coin
        if coin["symbol"].strip():
            coin_index[(normalized_name(coin["name"]), coin["symbol"].casefold())].append(coin)
        else:
            unindexable_coin_ids.append(coin["id"])
    validated_overrides = validate_overrides(overrides, coins_by_id)
    alpha_index, asset_index = defaultdict(list), defaultdict(list)
    for row in alpha:
        cex = row.get("cexCoinName", "")
        if not isinstance(cex, str) or not isinstance(row.get("contractAddress", ""), str):
            raise ValueError("alpha_invalid_identity_fields")
        if cex:
            alpha_index[cex].append(row)
    for row in assets:
        asset_index[row["assetCode"]].append(row)
    catalog = sorted((r for r in futures if r["contractType"] == "PERPETUAL"
                      and (include_inactive or r["status"] == "TRADING")), key=lambda r: r["symbol"])
    if not catalog:
        raise ValueError("empty_perpetual_catalog")
    if len({r["symbol"] for r in catalog}) != len(catalog):
        raise ValueError("duplicate_futures_symbol")
    timestamp = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    resolved = {}
    universe, tokens = [], []
    for future in catalog:
        base = future["baseAsset"]
        if base not in resolved:
            resolved[base] = resolve_base(base, alpha_index, asset_index, coin_index,
                                          coins_by_id, validated_overrides, manifest)
        identity = copy.deepcopy(resolved[base])
        future_source = source_ref("exchange_info", future, future["symbol"], manifest)
        identity.update(symbol=future["symbol"], baseAsset=base, quoteAsset=future["quoteAsset"],
                        contractType=future["contractType"], futuresStatus=future["status"])
        identity["sources"] = merge_sources([future_source], identity["sources"])
        universe.append(identity)
        if identity["mappingStatus"] == "mapped":
            selected = identity["selectedMapping"]
            token = {key: copy.deepcopy(identity[key]) for key in (
                "symbol", "baseAsset", "quoteAsset", "name", "denomination", "denominationSource",
                "identityMethod", "identityVerification", "independentlyProjectVerified", "coingeckoId",
                "selectedMapping", "allPlatforms", "sources", "warnings")}
            token.update(chain=selected["chain"], chainId=selected["chainId"], address=selected["address"],
                         mappingStatus="mapped", evidenceGeneratedAt=timestamp)
            # No verifiedAt: build time is not independent verification time.
            tokens.append(token)
    status_counts = dict(sorted(Counter(r["mappingStatus"] for r in universe).items()))
    coverage = {"totalPerpetualSymbols": len(universe), "totalBaseAssets": len(resolved),
                "mappedSymbols": len(tokens), "unmappedSymbols": len(universe) - len(tokens),
                "mappingStatusCounts": status_counts,
                "baseMappingStatusCounts": dict(sorted(Counter(r["mappingStatus"] for r in resolved.values()).items())),
                "mappedVerificationCounts": dict(sorted(Counter(t["identityVerification"] for t in tokens).items())),
                "mappedChainCounts": dict(sorted(Counter(t["chain"] for t in tokens).items())),
                "quoteAssetCounts": dict(sorted(Counter(r["quoteAsset"] for r in universe).items()))}
    return {"schemaVersion": 1, "generatedAt": timestamp, "reviewOnly": True,
            "scope": {"contractType": "PERPETUAL", "statuses": "all" if include_inactive else ["TRADING"],
                      "quoteAssets": "all", "includesTradifi": False},
            "policy": {"identity": "exact_alpha_cexCoinName_or_official_assetCode_name_and_symbol_unique_provider_id",
                       "noSymbolOnlyMatching": True, "noAutomaticNumericPrefixStripping": True,
                       "selection": "ethereum_then_official_alpha_canonical_then_fixed_supported_priority",
                       "noCrossChainAggregation": True, "unsupportedPlatformsPreserved": True,
                       "noHyperliquidFeature": True,
                       "providerMatchedDisclaimer": "Provider identity/address match, not independently project-verified; not live DEX availability."},
            "inputSources": manifest, "inputWarnings": {
                "coingeckoEmptySymbolIdsExcludedFromMatching": sorted(unindexable_coin_ids)},
            "coverage": coverage, "tokens": tokens, "universe": universe}


def validate_output_path(output, input_paths):
    target = Path(output).resolve()
    if target in {Path(p).resolve() for p in input_paths}:
        raise ValueError("output_must_not_overwrite_input")
    if target == ROOT or ROOT in target.parents or target.name == "onchain.registry.json":
        raise ValueError("output_must_be_isolated_from_production_repository")
    return target


def write_atomic(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exchange-info", type=Path, default=WORKSPACE / "chain-exchange-info.json")
    parser.add_argument("--binance-assets", type=Path, default=WORKSPACE / "allchain/binance-assets.json")
    parser.add_argument("--binance-alpha", type=Path, default=WORKSPACE / "allchain/binance-alpha.json")
    parser.add_argument("--coingecko-list", type=Path, default=WORKSPACE / "allchain/coingecko-list.json")
    parser.add_argument("--overrides", type=Path, help="Caller-vetted per-base explicit identity overrides; see module docstring")
    parser.add_argument("--include-inactive", action="store_true", help="Include pending/settling PERPETUALs; default is all 571 trading symbols")
    parser.add_argument("--output", type=Path, default=WORKSPACE / "allchain/proposed-registry.json")
    args = parser.parse_args(argv)
    paths = {"exchange_info": args.exchange_info, "binance_assets": args.binance_assets,
             "binance_alpha": args.binance_alpha, "coingecko": args.coingecko_list}
    if args.overrides is not None:
        paths["overrides"] = args.overrides
    try:
        output_path = validate_output_path(args.output, paths.values())
        raw = {source_id: path.read_bytes() for source_id, path in paths.items()}
        documents = {source_id: json.loads(data) for source_id, data in raw.items()}
        manifest = make_manifest(documents, {source_id: path.resolve() for source_id, path in paths.items()}, raw)
        result = build_universe(documents["exchange_info"], documents["binance_assets"],
                                documents["binance_alpha"], documents["coingecko"],
                                overrides=documents.get("overrides"), manifest=manifest,
                                include_inactive=args.include_inactive)
        write_atomic(output_path, result)
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    print(json.dumps({"output": str(output_path), "generatedAt": result["generatedAt"],
                      "coverage": result["coverage"], "reviewOnly": True}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
