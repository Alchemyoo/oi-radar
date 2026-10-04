#!/usr/bin/env python3
"""Offline safety/regression tests for optional DEX/transfer evidence and mapping audit."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import collect_onchain as c
import onchain_evidence as e
import audit_onchain_mappings as a
from test_onchain import NOW, IDENTITY, REGISTRY, EMPTY, pair, run


def payload():
    event = {"tokenAddress": IDENTITY["address"], "from": "0x" + "b" * 40,
             "to": "0x" + "c" * 40, "transactionHash": "0x" + "1" * 64,
             "blockHash": "0x" + "2" * 64, "blockNumber": 100, "logIndex": 0,
             "blockTime": "2026-10-04T04:30:00Z", "finality": "finalized", "removed": False,
             "amountRaw": "100000000000000000000000", "decimals": 18, "usdValue": 100000,
             "valuation": {"source": "fixture-pricing", "at": "2026-10-04T04:30:00Z"}}
    return {"identity": IDENTITY, "source": "https://provider.invalid/logs",
            "fetchedAt": c.stamp(NOW), "lastAttemptAt": c.stamp(NOW),
            "window": {"from": "2026-10-04T04:00:00Z", "to": c.stamp(NOW)},
            "coverage": {"complete": True, "finality": "finalized"}, "events": [event]}


class EvidenceTests(unittest.TestCase):
    def test_default_collector_preserves_v1_and_has_no_evidence(self):
        output, _, _ = run(lambda _: [pair()])
        self.assertNotIn("evidence", output["tokens"]["TEST"])
        original = copy.deepcopy(output)
        e.attach_evidence(output)
        row = output["tokens"]["TEST"]
        channels = row.pop("evidence")
        self.assertEqual(output, original)
        self.assertEqual(channels["transfers"]["status"], "disabled")
        self.assertIsNone(channels["transfers"]["fetchedAt"])
        self.assertEqual(channels["transfers"]["anomalies"], [])

    def test_opt_in_cli_no_new_network_and_no_history_change(self):
        output, history, code = run(lambda _: [pair()])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            c.atomic_json(root / "registry.json", REGISTRY)
            for enabled in (False, True):
                data = root / str(enabled)
                argv = ["--registry", str(root / "registry.json"), "--data-dir", str(data)]
                if enabled:
                    argv.append("--include-evidence")
                with patch.object(c, "collect", return_value=(copy.deepcopy(output), history, code)):
                    self.assertEqual(c.main(argv), 0)
                result = c.load_json(data / "onchain.json")
                self.assertEqual("evidence" in result["tokens"]["TEST"], enabled)
                self.assertEqual(c.load_json(data / "onchain-history.json"), history)

    def test_dex_thresholds_and_stale_suppression(self):
        row = c.snapshot(IDENTITY, [pair(liquidity=900000)], NOW)
        row.update(liquidityChangePct=-10, liquidityBaselineAt="2026-10-04T04:00:00Z")
        channel = e.dex_channel(row)
        self.assertEqual(len(channel["anomalies"]), 1)
        self.assertTrue(channel["anomalies"][0]["notNetFlow"])
        for changes in ({"status": "stale"}, {"liquidityChangePct": -9.99},
                        {"liquidityUsd": 9000}, {"liquidityUsd": None},
                        {"liquidityChangePct": -100}, {"liquidityBaselineAt": "bad"},
                        {"poolFingerprint": "bad"}, {"liquidityBaselineAt": "2026-10-04T04:59:00Z"}):
            self.assertEqual(e.dex_channel(dict(row, **changes))["anomalies"], [])

    def test_dedup_exact_logs_and_threshold(self):
        source = payload()
        source["events"] *= 2
        channel = e.transfer_channel(IDENTITY, source)
        self.assertEqual(len(channel["events"]), 1)
        self.assertEqual(len(channel["anomalies"]), 1)
        self.assertTrue(channel["anomalies"][0]["notTrade"])
        self.assertEqual(channel["events"][0]["amountRaw"], "100000000000000000000000")

    def test_null_valuation_is_not_zero_or_anomaly(self):
        source = payload()
        source["events"][0]["usdValue"] = None
        del source["events"][0]["valuation"]
        channel = e.transfer_channel(IDENTITY, source)
        self.assertIsNone(channel["events"][0]["usdValue"])
        self.assertEqual(channel["anomalies"], [])

    def test_invalid_logs_fail_closed(self):
        for key, value in (("tokenAddress", "0x" + "f" * 40), ("removed", True),
                           ("finality", "pending"), ("amountRaw", 100000),
                           ("amountRaw", "-1"), ("decimals", True), ("logIndex", -1),
                           ("transactionHash", "bad"), ("usdValue", float("inf")),
                           ("usdValue", "100000"), ("blockTime", "2026-10-04T05:00:00Z"),
                           ("valuation", {"source": "fixture", "at": "2026-10-04T04:00:00Z"})):
            source = payload()
            source["events"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                e.transfer_channel(IDENTITY, source)

    def test_conflicting_logs_wrong_identity_incomplete_coverage(self):
        source = payload()
        source["events"].append(dict(source["events"][0], usdValue=200000))
        with self.assertRaises(ValueError):
            e.transfer_channel(IDENTITY, source)
        for change in ({"identity": dict(IDENTITY, chainId=1)},
                       {"coverage": {"complete": False, "finality": "finalized"}},
                       {"source": "https://user:pass@provider.invalid/logs"},
                       {"events": [payload()["events"][0]] * 1001}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                e.transfer_channel(IDENTITY, dict(payload(), **change))


class MappingAuditTests(unittest.TestCase):
    def registry(self):
        registry = copy.deepcopy(REGISTRY)
        registry["tokens"][0]["sources"] = [{"url": "https://official.invalid/archived-evidence"}]
        return registry

    def exchange(self):
        return {"serverTime": 1, "symbols": [
            {"symbol": "TEST", "baseAsset": "TEST", "contractType": "PERPETUAL", "status": "TRADING"},
            {"symbol": "1000TESTUSDT", "baseAsset": "1000TEST", "contractType": "PERPETUAL", "status": "TRADING"},
            {"symbol": "ETHUSDC", "baseAsset": "ETH", "contractType": "PERPETUAL", "status": "TRADING"},
            {"symbol": "OLD", "contractType": "PERPETUAL", "status": "SETTLING"},
            {"symbol": "TEST_260925", "contractType": "CURRENT_QUARTER", "status": "TRADING"}]}

    def test_all_quotes_and_multipliers_are_pending_not_guessed(self):
        registry = self.registry()
        original = copy.deepcopy(registry)
        result = a.audit(self.exchange(), registry)
        self.assertEqual(result["counts"], {"tradingPerpetuals": 3, "registered": 1, "pending": 2})
        self.assertIsNone(result["symbols"][0]["identity"])
        self.assertEqual(registry, original)

    def test_missing_provenance_duplicate_symbols_fail(self):
        with self.assertRaises(ValueError):
            a.audit(self.exchange(), REGISTRY)
        exchange = self.exchange()
        exchange["symbols"].append(exchange["symbols"][0])
        with self.assertRaises(ValueError):
            a.audit(exchange, self.registry())


if __name__ == "__main__":
    unittest.main()
