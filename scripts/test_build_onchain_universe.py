"""Offline tests for review-only full-market mapping; no network or production edits."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import build_onchain_universe as b

A = "0x" + "a" * 40
B = "0x" + "b" * 40
SOL = "So11111111111111111111111111111111111111112"
NOW = "2026-10-04T00:00:00Z"


def future(base="TEST", quote="USDT", status="TRADING", kind="PERPETUAL"):
    return dict(symbol=base + quote, baseAsset=base, quoteAsset=quote, status=status, contractType=kind)


def asset(base="TEST", name="Test Project"):
    return dict(assetCode=base, assetName=name, id="123")


def coin(id="test-project", symbol="test", name="Test Project", platforms=None):
    return dict(id=id, symbol=symbol, name=name, platforms={"ethereum": A} if platforms is None else platforms)


def alpha(base="TEST", symbol="TEST", chain="56", address=B, denomination=1):
    return dict(cexCoinName=base, symbol=symbol, name="Test Project", chainId=chain,
                contractAddress=address, denomination=denomination, alphaId="ALPHA_1")


def build(futures=None, assets=None, alphas=None, coins=None, **kwargs):
    return b.build_universe({"symbols": [future()] if futures is None else futures},
                            {"data": [asset()] if assets is None else assets},
                            {"data": [] if alphas is None else alphas},
                            [coin()] if coins is None else coins, generated_at=NOW, **kwargs)


class UniverseTests(unittest.TestCase):
    def test_unique_name_and_symbol_bridge_is_provider_not_verified(self):
        r = build(assets=[asset(name="  TEST   Project ")])
        t = r["tokens"][0]
        self.assertEqual(t["identityVerification"], "provider_matched")
        self.assertFalse(t["independentlyProjectVerified"])
        self.assertNotIn("verifiedAt", t)
        self.assertEqual(t["address"], A)

    def test_symbol_alone_never_matches_name_mismatch(self):
        r = build(coins=[coin(name="Unrelated Test")])
        self.assertEqual(r["tokens"], [])
        self.assertEqual(r["universe"][0]["reason"], "official_name_and_symbol_no_exact_coingecko_match")
        self.assertEqual(build(assets=[])['tokens'], [])

    def test_name_alone_never_matches_symbol_mismatch(self):
        self.assertEqual(build(coins=[coin(symbol="wrong")])["tokens"], [])
        self.assertEqual(build(assets=[asset(base="test")])["tokens"], [])

    def test_unique_id_required_even_when_both_name_and_symbol_match(self):
        r = build(coins=[coin(), coin(id="test-2", platforms={"bsc": B})])
        self.assertEqual(r["universe"][0]["mappingStatus"], "ambiguous_identity")
        self.assertEqual(r["tokens"], [])

    def test_alpha_cex_identity_is_exact_and_official(self):
        r = build(assets=[], coins=[], alphas=[alpha(symbol="DifferentTicker")])
        self.assertEqual(r["tokens"][0]["identityVerification"], "official")
        self.assertEqual(r["tokens"][0]["chainId"], 56)
        self.assertEqual(build(assets=[], coins=[], alphas=[alpha(base="test")])["tokens"], [])

    def test_explicit_alpha_multiplier_and_no_prefix_guess(self):
        r = build(futures=[future("1000TEST")], assets=[], coins=[coin()],
                  alphas=[alpha("1000TEST", "TEST", denomination=1000)])
        self.assertEqual(r["tokens"][0]["denomination"], 1000)
        unmapped = build(futures=[future("1000TEST")], assets=[], coins=[coin()])
        self.assertEqual(unmapped["tokens"], [])
        self.assertIsNone(unmapped["universe"][0]["denomination"])
        bad = build(alphas=[alpha(denomination=None)], coins=[])
        self.assertEqual(bad["universe"][0]["mappingStatus"], "ambiguous_identity")

    def test_native_is_not_unavailable_or_zero(self):
        r = build(coins=[coin(platforms={})])
        row = r["universe"][0]
        self.assertEqual(row["mappingStatus"], "native_no_dex_contract")
        self.assertIsNone(row["selectedMapping"])
        self.assertEqual(r["tokens"], [])
        self.assertNotIn("liquidityUsd", row)
        self.assertEqual(build(coins=[coin(platforms={"ethereum": ""})])["universe"][0]["mappingStatus"], "native_no_dex_contract")

    def test_solana_case_preserved_and_invalid_address_rejected(self):
        r = build(assets=[], coins=[], alphas=[alpha(chain="CT_501", address=SOL)])
        self.assertEqual(r["tokens"][0]["address"], SOL)
        self.assertNotEqual(SOL, SOL.lower())
        self.assertEqual(r["tokens"][0]["chainId"], "CT_501")
        self.assertFalse(b.validate_address("solana", "0x" + "a" * 40))
        self.assertEqual(build(coins=[coin(platforms={"ethereum": "0x123"})])["universe"][0]["mappingStatus"], "invalid_contract_address")

    def test_sui_move_type_supported_case_preserved(self):
        address = "0x2::test_module::TEST"
        r = build(assets=[], coins=[], alphas=[alpha(chain="CT_784", address=address)])
        self.assertEqual(r["tokens"][0]["chainId"], "CT_784")
        self.assertTrue(r["tokens"][0]["address"].endswith("::test_module::TEST"))
        self.assertFalse(b.validate_address("sui", "0x2"))

    def test_preferred_ethereum_does_not_upgrade_provider_evidence(self):
        r = build(alphas=[alpha()], coins=[coin(platforms={"ethereum": A, "binance-smart-chain": B})])
        t = r["tokens"][0]
        self.assertEqual(t["chain"], "ethereum")
        self.assertEqual(t["identityVerification"], "provider_matched")
        self.assertEqual(len(t["allPlatforms"]), 2)
        self.assertEqual(t["selectedMapping"]["selectionReason"], "preferred_ethereum")
        without_eth = build(alphas=[alpha()], coins=[coin(platforms={"base": A})])
        self.assertEqual(without_eth["tokens"][0]["chain"], "bsc")

    def test_conflicting_preferred_addresses_fail_closed(self):
        r = build(alphas=[alpha(chain="1", address=B)])
        self.assertEqual(r["tokens"], [])
        self.assertEqual(r["universe"][0]["reason"], "conflicting_addresses_on_preferred_platform")

    def test_unsupported_provider_chain_is_ordinary_catalog_record(self):
        r = build(futures=[future("EXAMPLE")], assets=[asset("EXAMPLE", "Example")],
                  coins=[coin("provider-x", "example", "Example", {"unsupported-chain": A})])
        self.assertEqual(r["universe"][0]["mappingStatus"], "no_adapter")
        self.assertEqual(r["universe"][0]["allPlatforms"][0]["rawAddress"], A)
        self.assertEqual(r["tokens"], [])

    def test_all_quotes_and_trading_scope_no_base_dedup_of_symbols(self):
        fs = [future(quote=q) for q in ("USDT", "USDC", "BTC", "U", "USD1")]
        fs += [future("OTHER", status="SETTLING"), future("STOCK", kind="TRADIFI_PERPETUAL")]
        r = build(futures=fs)
        self.assertEqual(len(r["universe"]), 5)
        self.assertEqual(len(r["tokens"]), 5)
        self.assertEqual(r["coverage"]["totalBaseAssets"], 1)
        self.assertEqual(len(build(futures=fs, include_inactive=True)["universe"]), 6)

    def test_provenance_record_and_input_hashes(self):
        r = build()
        refs = r["tokens"][0]["sources"]
        self.assertEqual({s["sourceId"] for s in refs}, {"exchange_info", "binance_assets", "coingecko"})
        for ref in refs:
            self.assertRegex(ref["recordSha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(ref["inputSha256"], r["inputSources"][ref["sourceId"]]["sha256"])
            self.assertTrue(ref["url"].startswith("https://"))
        raw = b'{"test": 1}\n'
        m = b.make_manifest({"coingecko": {}}, raw_bytes={"coingecko": raw})
        self.assertEqual(m["coingecko"]["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(m["coingecko"]["hashScope"], "archived_file_bytes")
        self.assertEqual(r["generatedAt"], NOW)

    def test_explicit_vetted_override_no_fuzzy_rename(self):
        renamed = coin(name="New Project Name")
        self.assertEqual(build(coins=[renamed])["tokens"], [])
        overrides = {"schemaVersion": 1, "overrides": {"TEST": {
            "coingeckoId": "test-project", "expectedName": "New Project Name", "expectedSymbol": "test",
            "reason": "Official rename", "sources": [{"label": "Rename", "url": "https://project.example/rename"}]}}}
        r = build(coins=[renamed], overrides=overrides)
        self.assertEqual(r["tokens"][0]["identityMethod"], "explicit_vetted_override")
        self.assertEqual(r["tokens"][0]["identityVerification"], "provider_matched")
        invalid = copy.deepcopy(overrides)
        invalid["overrides"]["TEST"]["expectedName"] = "Wrong"
        with self.assertRaises(ValueError):
            build(coins=[renamed], overrides=invalid)

    def test_empty_provider_symbol_is_explicitly_excluded(self):
        r = build(coins=[coin(), coin(id="empty", symbol="")])
        self.assertEqual(r["inputWarnings"]["coingeckoEmptySymbolIdsExcludedFromMatching"], ["empty"])
        self.assertEqual(len(r["tokens"]), 1)

    def test_determinism_and_no_mutation(self):
        coins = [coin(platforms={"solana": SOL, "base": B, "ethereum": A})]
        original = copy.deepcopy(coins)
        r = build(coins=coins)
        self.assertEqual(r, build(coins=coins))
        self.assertEqual(original, coins)

    def test_production_and_inputs_cannot_be_overwritten(self):
        with self.assertRaises(ValueError):
            b.validate_output_path(b.ROOT / "onchain.registry.json", [])
        with self.assertRaises(ValueError):
            b.validate_output_path(b.ROOT / "data/onchain.json", [])
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.json"
            with self.assertRaises(ValueError):
                b.validate_output_path(input_path, [input_path])
            output_path = Path(directory) / "proposed.json"
            b.write_atomic(output_path, build())
            self.assertEqual(json.loads(output_path.read_text())["schemaVersion"], 1)


if __name__ == "__main__":
    unittest.main()
