"""Tests for LLM response parsing fallbacks (no network calls)."""
from app.core.groq_client import _parse_json, _extract_json_list


class TestParseJson:
    def test_direct_json(self):
        assert _parse_json('{"a": 1}') == {"a": 1}

    def test_markdown_fenced_json(self):
        text = 'Here you go:\n```json\n{"vulns": ["CVE-1"]}\n```\nDone.'
        assert _parse_json(text) == {"vulns": ["CVE-1"]}

    def test_invalid_raises(self):
        import pytest
        with pytest.raises(Exception):
            _parse_json("definitely not json")


class TestExtractJsonList:
    def test_list_passthrough(self):
        assert _extract_json_list(["a"]) == ["a"]

    def test_dict_with_skills_key(self):
        assert _extract_json_list({"skills": [{"skill": "x"}]}) == [{"skill": "x"}]

    def test_dict_with_checklist_key(self):
        assert _extract_json_list({"checklist": [1]}) == [1]

    def test_dict_without_list_yields_empty(self):
        assert _extract_json_list({"foo": "bar"}) == []

    def test_garbage_yields_empty(self):
        assert _extract_json_list(42) == []
