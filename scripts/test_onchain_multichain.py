#!/usr/bin/env python3
"""Offline multichain tests: no network and no production registry edits."""
import copy
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_onchain as c

NOW = datetime(2026, 10, 5, tzinfo=timezone.utc)
EVM = "0x" + "a" * 40
SOL = "J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd"
SUI = "0x2::test_module::TEST"


def ident(symbol, chain, chain_id, address):
    return {"symbol": symbol, "chain": chain, "chainId": chain_id,
            "address": address, "name": None, "verifiedAt": None}


def registry(*tokens):
    return {"schemaVersion": 1, "tokens": list(tokens)}


def pool(identity, pair_address="0x" + "b" * 40, base=None):
    base = base or identity["address"]
    return {"chainId": identity["chain"], "baseToken": {"address": base},
            "quoteToken": {"address": "0x" + "c" * 40},
            "pairAddress": pair_address, "dexId": "testdex",
            "liquidity": {"usd": 12}, "volume": {"h1": 3, "h24": 6},
            "priceUsd": "1.5", "txns": {"h1": {"buys": 1, "sells": 2},
            "h24": {"buys": 3, "sells": 4}}}


class RegistryTests(unittest.TestCase):
    def test_evm_solana_and_sui_catalog_validation(self):
        rows = c.registry_tokens(registry(
            ident("ETHUSDT", "ethereum", 1, EVM.upper()),
            ident("SOLUSDT", "solana", "CT_501", SOL),
            ident("SUIUSDT", "sui", "CT_784", SUI)))
        self.assertEqual(rows[0]["address"], EVM)
        self.assertTrue(rows[0]["adapterSupported"])
        self.assertTrue(rows[1]["adapterSupported"])
        self.assertFalse(rows[2]["adapterSupported"])

    def test_solana_is_case_sensitive_and_quote_never_flips(self):
        identity = ident("SOLUSDT", "solana", "CT_501", SOL)
        good = pool(identity, pair_address=SOL, base=SOL)
        wrong_case = copy.deepcopy(good)
        wrong_case["baseToken"]["address"] = SOL.lower()
        quote_only = copy.deepcopy(good)
        quote_only["baseToken"]["address"] = "So11111111111111111111111111111111111111112"
        quote_only["quoteToken"] = {"address": SOL}
        result = c.snapshot(identity, [good, wrong_case, quote_only], NOW)
        self.assertEqual(result["coverage"]["acceptedPools"], 1)
        self.assertEqual(result["coverage"]["unmatchedPools"], 2)


class BatchTests(unittest.TestCase):
    def test_batches_same_chain_at_thirty_and_preserves_partial_batch_failure(self):
        identities = [ident("T%03dUSDT" % n, "ethereum", 1,
                            "0x%040x" % (n + 1)) for n in range(31)]
        calls = []
        def opener(request, timeout):
            calls.append(request.full_url)
            if "," in request.full_url:
                raise HTTPError(request.full_url, 503, "fixture", None, None)
            self.assertTrue(request.full_url.startswith(c.BATCH_API + "/ethereum/"))
            addresses = request.full_url.rsplit("/", 1)[1].split(",")
            rows = []
            for address in addresses:
                row = next(i for i in identities if i["address"] == address)
                rows.append(pool(row, pair_address="0x" + ("d" * 39) + address[-1]))
            return io.BytesIO(json.dumps(rows).encode())
        pairs, errors = c.fetch_pairs_batched(identities, opener=opener,
                                              pause=lambda _: None, workers=1, interval=0)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(url.startswith(c.BATCH_API + "/") for url in calls))
        self.assertEqual(len([url for url in calls if "," in url]), 2)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(len(errors), 30)
        self.assertIn("T030USDT", pairs)

    def test_collect_keeps_sui_explicitly_unsupported(self):
        reg = registry(ident("SUIUSDT", "sui", "CT_784", SUI),
                       ident("ETHUSDT", "ethereum", 1, EVM))
        def fetch(identity):
            return [pool(identity, pair_address="0x" + "d" * 40)]
        output, _, code = c.collect(reg, {"tokens": {}}, {"tokens": {}},
                                    fetcher=fetch, clock=lambda: NOW)
        self.assertEqual(code, 0)
        self.assertEqual(output["tokens"]["SUIUSDT"]["status"], "unsupported")
        self.assertEqual(output["tokens"]["SUIUSDT"]["error"], "unsupported_chain_adapter")
        self.assertEqual(output["tokens"]["ETHUSDT"]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
