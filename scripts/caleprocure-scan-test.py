#!/usr/bin/env python3
"""Unit test for the sidecar the Cal eProcure scan writes.

Run:  python3 scripts/caleprocure-scan-test.py

The scan imports qual_table_automations at module level and that clone exists
only on the mini, so the modules are stubbed here with the handful of names the
import block touches. The serializer is then exercised with a fake row and fake
verdict objects, which is exactly the duck-typed contract it declares. Two
facts under test: `end_date` is the PACIFIC date (a 5 PM PT close is tomorrow
in UTC), and both lens verdicts land under `lenses` with score, bucket, reasons.
"""
import importlib.util
import json
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS


def install_stubs() -> None:
    def module(name: str, **attrs) -> types.ModuleType:
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m

    module("app")
    module("app.core")
    module("app.services")
    module("app.core.eprocure_config", get_eprocure_config=lambda: NS(is_enabled=False))
    module("app.services.eprocure_parser", EprocureParseError=type("EprocureParseError", (Exception,), {}))
    module("app.services.eprocure_relevance",
           CONSULTING=NS(key="consulting"), PRODUCT=NS(key="product"), RELEVANCE_VERSION=3)
    module("app.services.eprocure_discovery_service")
    module("app.services.eprocure_client",
           EprocureTransportError=type("EprocureTransportError", (Exception,), {}), HttpEprocureClient=object)


def load_scan():
    install_stubs()
    path = Path(__file__).with_name("caleprocure-scan.py")
    spec = importlib.util.spec_from_file_location("caleprocure_scan", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class SidecarEventTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scan = load_scan()

    def test_edd_event_serialises_with_both_lenses(self):
        # EDD RFP 3475: closes 9/21/2026 12:00 PM PT = 19:00 UTC the same day.
        row = NS(event_id="0000039456", department_code="7100", department_name="Employment Development Dept",
                 event_name="EDD RFP 3475 for Salesforce M&O",
                 end_date=datetime(2026, 9, 21, 19, 0, tzinfo=timezone.utc), end_date_raw="09/21/2026 12:00PM")
        verdicts = {
            "consulting": NS(score=75, bucket="likely", reasons=["title: enterprise platform", "buyer we know: EDD"]),
            "product": NS(score=0, bucket="unlikely", reasons=[]),
        }
        ev = self.scan.sidecar_event(row, verdicts, 3)
        self.assertEqual(ev["event_id"], "0000039456")
        self.assertEqual(ev["business_unit"], "7100")     # no business_unit attr: department_code stands in
        self.assertEqual(ev["name"], "EDD RFP 3475 for Salesforce M&O")
        self.assertEqual(ev["end_date"], "2026-09-21")
        self.assertEqual(ev["end_at"], "2026-09-21T19:00:00+00:00")
        self.assertEqual(ev["rules_version"], 3)
        self.assertIsNone(ev["url"])
        self.assertEqual(ev["lenses"]["consulting"], {
            "score": 75, "bucket": "likely", "reasons": ["title: enterprise platform", "buyer we know: EDD"],
        })
        self.assertEqual(ev["lenses"]["product"], {"score": 0, "bucket": "unlikely", "reasons": []})
        json.dumps(ev)   # nothing non-serialisable slipped in

    def test_end_date_is_the_pacific_date(self):
        # 5:00 PM PT on 9/15 is 00:00 UTC on 9/16; the lead store must see 9/15.
        row = NS(event_id="0000039886", department_code="7730", department_name="Franchise Tax Board",
                 event_name="IFB Axway renewal", business_unit="7730",
                 end_date=datetime(2026, 9, 16, 0, 0, tzinfo=timezone.utc), end_date_raw="09/15/2026 05:00PM")
        ev = self.scan.sidecar_event(row, {"consulting": NS(score=45, bucket="likely", reasons=None)}, 3)
        self.assertEqual(ev["end_date"], "2026-09-15")
        self.assertEqual(ev["lenses"]["consulting"]["reasons"], [])

    def test_undated_event(self):
        row = NS(event_id="X1", department_code="0840", department_name="State Controller",
                 event_name="Undated", end_date=None, end_date_raw=None)
        ev = self.scan.sidecar_event(row, {}, 3)
        self.assertIsNone(ev["end_date"])
        self.assertIsNone(ev["end_at"])
        self.assertEqual(ev["lenses"], {})


if __name__ == "__main__":
    unittest.main(verbosity=1)
