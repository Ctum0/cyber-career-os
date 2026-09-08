"""Canonical label normalization for knowledge-graph node identity.

The stored `label` keeps the author's original casing/spacing (display value);
`label_norm` is the comparison key used for deduplication. Keep this function
the ONLY place normalization is defined so all ingestion paths agree.
"""
import unicodedata


def normalize_label(label: str) -> str:
    """Return the canonical comparison key for an entity label.

    - Unicode NFC normalization
    - collapse all whitespace runs to a single space, trim
    - lowercase
    """
    text = unicodedata.normalize("NFC", str(label))
    return " ".join(text.split()).strip().lower()
