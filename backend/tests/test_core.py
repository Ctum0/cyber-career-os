"""Unit tests for label normalization and JSON column helpers."""
from app.core.labels import normalize_label
from app.core.serialize import as_list, as_dict


class TestNormalizeLabel:
    def test_collapses_whitespace_and_lowercases(self):
        assert normalize_label("  Network   Security ") == "network security"

    def test_unicode_nfc(self):
        # é as combining sequence vs precomposed both normalize identically
        assert normalize_label("caf\u00e9") == normalize_label("cafe\u0301")

    def test_preserves_case_insensitive_identity(self):
        assert normalize_label("NMAP") == normalize_label("nmap")

    def test_distinct_labels_stay_distinct(self):
        # Over-normalizing is a risk: these must NOT collide.
        assert normalize_label("CVE-2026-1234") != normalize_label("CVE-2026-1235")
        assert normalize_label("Python Scripting") != normalize_label("Bash Scripting")


class TestAsList:
    def test_parses_json_string(self):
        assert as_list('["a","b"]') == ["a", "b"]

    def test_passes_through_list(self):
        assert as_list([1, 2]) == [1, 2]

    def test_empty_cases(self):
        assert as_list(None) == []
        assert as_list("") == []
        assert as_list("[]") == []

    def test_malformed_json_returns_empty(self):
        assert as_list("{not json") == []

    def test_non_list_json_returns_empty(self):
        assert as_list('{"a": 1}') == []


class TestAsDict:
    def test_parses_json_string(self):
        assert as_dict('{"k": 1}') == {"k": 1}

    def test_malformed_returns_empty(self):
        assert as_dict("[1,2]") == {}
        assert as_dict("garbage") == {}
        assert as_dict(None) == {}
