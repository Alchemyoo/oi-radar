#!/usr/bin/env python3
"""Offline fixtures; no public API calls and no registry edits."""
import copy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_onchain as c

NOW = datetime(2026, 10, 4, 5, 0, tzinfo=timezone.utc)
BASE = "0x" + "a" * 40
OTHER = "0x" + "b" * 40
IDENTITY = {"symbol": "TEST", "chain": "bsc", "chainId": 56, "address": BASE,
            "name": "Fixture token", "verifiedAt": c.stamp(NOW)}
REGISTRY = {"schemaVersion": 1, "tokens": [dict(IDENTITY, sources=["fixture-only"])]}
EMPTY = {"schemaVersion": 1, "tokens": {}}


def pair(index=1, liquidity=100, volume=10):
    return {"chainId": "bsc", "baseToken": {"address": BASE},
            "quoteToken": {"address": OTHER}, "pairAddress": "0x" + f"{index:040x}",
            "dexId": "pancakeswap", "liquidity": {"usd": liquidity},
            "volume": {"h1": volume, "h24": volume * 2}, "priceUsd": "0.25",
            "txns": {"h1": {"buys": 2, "sells": 1}, "h24": {"buys": 4, "sells": 3}},
            "url": "https://attacker.invalid/not-trusted"}


def run(fetcher, previous=EMPTY, history=EMPTY, registry=REGISTRY, now=NOW):
    return c.collect(registry, previous, history, fetcher, lambda: now)


class PoolTests(unittest.TestCase):
    def test_filter_chain_base_case_and_deduplicate(self):
        valid = pair()
        valid["baseToken"]["address"] = BASE.upper().replace("0X", "0x")
        wrong_chain = dict(pair(2), chainId="ethereum")
        quote_only = pair(3)
        quote_only["baseToken"]["address"] = OTHER
        quote_only["quoteToken"]["address"] = BASE
        wrong_case_chain = dict(pair(4), chainId="BSC")
        result = c.snapshot(IDENTITY, [valid, copy.deepcopy(valid), wrong_chain, quote_only, wrong_case_chain], NOW)
        self.assertEqual(result["coverage"]["returnedPools"], 5)
        self.assertEqual(result["coverage"]["acceptedPools"], 1)
        self.assertEqual(result["coverage"]["duplicatePools"], 1)
        self.assertEqual(result["liquidityUsd"], 100)
        self.assertEqual(result["volumeUsd"], {"h1": 10, "h24": 20})
        self.assertEqual(result["txns"]["h1"], {"buys": 2, "sells": 1})
        self.assertIsNone(result["buySellUsd"])
        self.assertTrue(result["pools"][0]["url"].startswith("https://dexscreener.com/bsc/"))

    def test_conflicting_duplicate_fails_instead_of_inflating(self):
        with self.assertRaises(c.CollectionError):
            c.snapshot(IDENTITY, [pair(), pair(liquidity=101)], NOW)

    def test_missing_fields_do_not_become_zero_or_complete(self):
        missing = pair(2)
        del missing["liquidity"]
        del missing["volume"]["h24"]
        del missing["txns"]["h1"]["buys"]
        result = c.snapshot(IDENTITY, [pair(), missing], NOW)
        self.assertIsNone(result["liquidityUsd"])
        self.assertIsNone(result["pools"][1]["liquidityUsd"])
        self.assertEqual(result["volumeUsd"]["h1"], 20)
        self.assertIsNone(result["volumeUsd"]["h24"])
        self.assertIsNone(result["txns"]["h1"]["buys"])
        self.assertEqual(result["txns"]["h1"]["sells"], 2)
        self.assertEqual(result["coverage"]["fields"]["liquidityUsd"],
                         {"knownPools": 1, "totalPools": 2, "complete": False})
        self.assertEqual(c.add_baseline(result, [], NOW), [])
        all_missing = c.snapshot(IDENTITY, [missing], NOW)
        self.assertIsNone(all_missing["primaryPairAddress"])
        self.assertIsNone(all_missing["priceUsd"])

    def test_invalid_metrics_are_rejected(self):
        for field, value in [("liquidity", -1), ("liquidity", float("inf")),
                             ("liquidity", True), ("volume", "NaN"),
                             ("price", "-2"), ("txns", 1.5), ("txns", -1)]:
            with self.subTest(field=field, value=value):
                bad = pair(2)
                if field == "liquidity":
                    bad["liquidity"]["usd"] = value
                elif field == "volume":
                    bad["volume"]["h1"] = value
                elif field == "price":
                    bad["priceUsd"] = value
                else:
                    bad["txns"]["h1"]["buys"] = value
                result = c.snapshot(IDENTITY, [pair(), bad], NOW)
                self.assertEqual(result["coverage"]["invalidPools"], 1)
                self.assertEqual(result["liquidityUsd"], 100)

    def test_top_twenty_and_main_pool(self):
        result = c.snapshot(IDENTITY, [pair(i, i) for i in range(1, 26)], NOW)
        self.assertEqual(len(result["pools"]), 20)
        self.assertEqual(result["primaryPairAddress"], pair(25)["pairAddress"])
        self.assertEqual(result["liquidityUsd"], sum(range(6, 26)))
        self.assertEqual(result["coverage"]["acceptedPools"], 25)
        self.assertTrue(result["coverage"]["truncated"])


class HistoryTests(unittest.TestCase):
    def snapshot_and_point(self, age, fingerprint=None, liquidity=100):
        token = c.snapshot(IDENTITY, [pair(liquidity=125)], NOW)
        point = {"at": c.stamp(NOW - age), "liquidityUsd": liquidity,
                 "poolFingerprint": fingerprint or token["poolFingerprint"]}
        return token, point

    def test_baseline_same_fingerprint(self):
        token, point = self.snapshot_and_point(timedelta(minutes=30))
        points = c.add_baseline(token, [point], NOW)
        self.assertEqual(token["liquidityChangePct"], 25)
        self.assertEqual(token["liquidityBaselineAt"], point["at"])
        self.assertEqual(len(points), 2)
        self.assertIn("price_effects_not_net_flow", token["liquidityChangeKind"])

    def test_fingerprint_mismatch_short_and_expired_baseline(self):
        for age, fingerprint in [(timedelta(hours=1), "f" * 64),
                                 (timedelta(minutes=29, seconds=59), None),
                                 (timedelta(hours=6, seconds=1), None)]:
            with self.subTest(age=age, fingerprint=fingerprint):
                token, point = self.snapshot_and_point(age, fingerprint)
                c.add_baseline(token, [point], NOW)
                self.assertIsNone(token["liquidityChangePct"])
                self.assertIsNone(token["liquidityBaselineAt"])

    def test_six_hour_boundary_zero_and_identity_change(self):
        token, point = self.snapshot_and_point(timedelta(hours=6))
        c.add_baseline(token, [point], NOW)
        self.assertEqual(token["liquidityChangePct"], 25)
        token, point = self.snapshot_and_point(timedelta(hours=1), liquidity=0)
        c.add_baseline(token, [point], NOW)
        self.assertIsNone(token["liquidityChangePct"])
        changed = dict(IDENTITY, address=OTHER)
        changed_pair = pair()
        changed_pair["baseToken"]["address"] = OTHER
        other = c.snapshot(changed, [changed_pair], NOW)
        self.assertNotEqual(token["poolFingerprint"], other["poolFingerprint"])

    def test_history_ttl_and_point_limit(self):
        token, current = self.snapshot_and_point(timedelta())
        points = [dict(current, at=c.stamp(NOW - timedelta(minutes=i))) for i in range(400)]
        points += [dict(current, at=c.stamp(NOW - timedelta(hours=72, seconds=1))),
                   dict(current, at=c.stamp(NOW + timedelta(seconds=1)))]
        clean = c.prune_points(points, NOW)
        self.assertEqual(len(clean), 288)
        self.assertEqual(clean[0]["at"], c.stamp(NOW - timedelta(minutes=287)))
        self.assertEqual(c.prune_points([points[-2]], NOW), [])


class FailureTests(unittest.TestCase):
    @staticmethod
    def fail(_):
        raise c.CollectionError("network_error")

    def test_failure_keeps_good_then_stale_snapshot(self):
        previous, history, code = run(lambda _: [pair()])
        self.assertEqual(code, 0)
        later = NOW + timedelta(hours=1)
        output, cache, code = run(self.fail, previous, history, now=later)
        token = output["tokens"]["TEST"]
        self.assertEqual(code, 0)
        self.assertEqual(output["status"], "stale")
        self.assertEqual(token["status"], "stale")
        self.assertEqual(token["fetchedAt"], c.stamp(NOW))
        self.assertEqual(token["lastAttemptAt"], c.stamp(later))
        self.assertEqual(token["liquidityUsd"], 100)
        self.assertEqual(len(cache["tokens"]["TEST"]), 1)
        repeat, _, _ = run(self.fail, output, cache, now=later + timedelta(hours=1))
        self.assertEqual(repeat["tokens"]["TEST"]["fetchedAt"], c.stamp(NOW))
        recovered, _, _ = run(lambda _: [pair()], repeat, cache, now=later)
        self.assertEqual(recovered["tokens"]["TEST"]["status"], "ok")
        self.assertNotIn("error", recovered["tokens"]["TEST"])

    def test_initial_all_failure_nonzero_and_no_fake_freshness(self):
        output, _, code = run(self.fail)
        self.assertEqual(code, 1)
        self.assertEqual(output["status"], "error")
        self.assertIsNone(output["tokens"]["TEST"]["fetchedAt"])
        self.assertIsNone(output["tokens"]["TEST"]["liquidityUsd"])

    def test_mixed_success_and_failure(self):
        registry = copy.deepcopy(REGISTRY)
        registry["tokens"].append(dict(IDENTITY, symbol="OTHER", address=OTHER))
        def fetch(identity):
            return [pair()] if identity["symbol"] == "TEST" else self.fail(identity)
        output, _, code = run(fetch, registry=registry)
        self.assertEqual(code, 0)
        self.assertEqual(output["status"], "partial")
        self.assertEqual(output["tokens"]["OTHER"]["status"], "error")

    def test_rate_limit_stops_remaining_token_requests(self):
        registry = copy.deepcopy(REGISTRY)
        registry["tokens"].append(dict(IDENTITY, symbol="OTHER", address=OTHER))
        calls = []
        def fetch(identity):
            calls.append(identity["symbol"])
            raise c.RateLimited("rate_limited")
        output, _, code = run(fetch, registry=registry)
        self.assertEqual(calls, ["TEST"])
        self.assertEqual(code, 1)
        self.assertEqual(output["tokens"]["OTHER"]["error"], "rate_limited")

    def test_registry_identity_change_never_reuses_old_snapshot(self):
        previous, history, _ = run(lambda _: [pair()])
        registry = copy.deepcopy(REGISTRY)
        registry["tokens"][0]["address"] = OTHER
        output, _, code = run(self.fail, previous, history, registry=registry)
        self.assertEqual(code, 1)
        self.assertEqual(output["tokens"]["TEST"]["status"], "error")

    def test_invalid_registry_symbol_address_and_chain(self):
        for key, value in [("symbol", "X\nspoof"), ("address", "0x123"),
                           ("chain", "ethereum"), ("chainId", True)]:
            with self.subTest(key=key):
                registry = copy.deepcopy(REGISTRY)
                registry["tokens"][0][key] = value
                with self.assertRaises(c.CollectionError):
                    c.registry_tokens(registry)

    def test_chinese_binance_symbol_is_valid(self):
        registry = copy.deepcopy(REGISTRY)
        registry["tokens"][0]["symbol"] = "龙虾USDT"
        self.assertEqual(c.registry_tokens(registry)[0]["symbol"], "龙虾USDT")

    def test_error_messages_do_not_echo_external_text(self):
        def malicious(_):
            raise c.CollectionError("\nforged log/token=secret")
        output, _, _ = run(malicious)
        self.assertEqual(output["tokens"]["TEST"]["error"], "collection_error")


    def test_new_missing_liquidity_is_null_not_old_or_zero(self):
        previous, history, _ = run(lambda _: [pair()])
        missing = pair()
        del missing["liquidity"]
        output, cache, code = run(lambda _: [missing], previous, history,
                                  now=NOW + timedelta(minutes=30))
        token = output["tokens"]["TEST"]
        self.assertEqual(code, 0)
        self.assertEqual(token["status"], "ok")
        self.assertIsNone(token["liquidityUsd"])
        self.assertIsNone(token["liquidityChangePct"])
        self.assertEqual(len(cache["tokens"]["TEST"]), 1)

    def test_all_quote_only_is_failure_not_zero(self):
        quote_only = pair()
        quote_only["baseToken"]["address"] = OTHER
        quote_only["quoteToken"]["address"] = BASE
        output, _, code = run(lambda _: [quote_only])
        self.assertEqual(code, 1)
        self.assertEqual(output["tokens"]["TEST"]["error"], "no_accepted_base_pools")
        self.assertIsNone(output["tokens"]["TEST"]["liquidityUsd"])


class FetchAndFileTests(unittest.TestCase):
    def test_fetch_url_timeout_and_parse(self):
        def opener(request, timeout):
            self.assertEqual(request.full_url, c.API + "/bsc/" + BASE)
            self.assertEqual(timeout, 10)
            return io.BytesIO(json.dumps([pair()]).encode())
        self.assertEqual(c.fetch_pairs(IDENTITY, opener)[0]["dexId"], "pancakeswap")

    def test_bounded_retry_and_429_no_retry(self):
        for code, expected_calls in [(429, 1), (404, 1), (503, 2)]:
            calls, waits = [], []
            def opener(request, timeout):
                calls.append(request)
                raise HTTPError(request.full_url, code, "untrusted detail", None, None)
            with self.subTest(code=code), self.assertRaises(c.CollectionError):
                c.fetch_pairs(IDENTITY, opener, waits.append)
            self.assertEqual(len(calls), expected_calls)
            self.assertEqual(len(waits), expected_calls - 1)
        calls = []
        def network(request, timeout):
            calls.append(request)
            raise URLError("untrusted detail")
        with self.assertRaisesRegex(c.CollectionError, "network_error"):
            c.fetch_pairs(IDENTITY, network, lambda _: None)
        self.assertEqual(len(calls), 2)

    def test_truncated_http_response_is_bounded_network_failure(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            raise c.HTTPException("untrusted server detail")
        with self.assertRaisesRegex(c.CollectionError, "network_error"):
            c.fetch_pairs(IDENTITY, opener, lambda _: None)
        self.assertEqual(len(calls), 2)

    def test_invalid_cache_fails_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            c.atomic_json(root / "registry.json", REGISTRY)
            data = root / "data"
            data.mkdir()
            snapshot = data / "onchain.json"
            snapshot.write_text("{broken", encoding="utf-8")
            with patch.object(c, "collect") as collect_mock:
                self.assertEqual(c.main(["--registry", str(root / "registry.json"), "--data-dir", str(data)]), 1)
                collect_mock.assert_not_called()
            self.assertEqual(snapshot.read_text(encoding="utf-8"), "{broken")
            self.assertFalse((data / "onchain-history.json").exists())

    def test_response_limit_and_bad_json(self):
        for payload in [b"x" * (c.MAX_RESPONSE + 1), b"<html>", b"{}"]:
            with self.subTest(size=len(payload)), self.assertRaises(c.CollectionError):
                c.fetch_pairs(IDENTITY, lambda *args, **kwargs: io.BytesIO(payload))

    def test_cli_only_writes_expected_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            c.atomic_json(root / "registry.json", REGISTRY)
            # Inject at collect boundary so the CLI cannot make a real request.
            real_collect = c.collect
            with patch.object(c, "collect", side_effect=lambda r, p, h: real_collect(r, p, h, lambda _: [pair()], lambda: NOW)):
                self.assertEqual(c.main(["--registry", str(root / "registry.json"), "--data-dir", str(root / "data")]), 0)
            self.assertEqual({p.name for p in (root / "data").iterdir()}, {"onchain.json", "onchain-history.json"})
            data = c.load_json(root / "data" / "onchain.json")
            self.assertEqual(data["schemaVersion"], 1)
            self.assertFalse(data["sourceTimestampAvailable"])


if __name__ == "__main__":
    unittest.main()
