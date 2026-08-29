"""Formatter-tolerant, fail-closed semantic hashing for Tencent ADP Widget JSX.

Tencent may reformat JSX when a Widget is saved.  The token stream below ignores
only comments and whitespace outside string literals and canonicalizes single /
double quoted JavaScript strings.  Component names, property names, variables,
operators, literals and Action payload structure remain part of the digest.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re


IDENTIFIER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$.-]*")
NUMBER = re.compile(r"(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)")
OPERATORS = (
    "===", "!==", ">>>", "**=", "=>", "==", "!=", "<=", ">=", "&&", "||",
    "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>",
)


def _read_string(source: str, start: int) -> tuple[str, int]:
    quote = source[start]
    index = start + 1
    escaped = False
    while index < len(source):
        char = source[index]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == quote:
            raw = source[start:index + 1]
            if quote == "`":
                # Template literals can contain interpolation; preserve their raw
                # token so a payload or variable change cannot be normalized away.
                value = raw
            else:
                try:
                    value = ast.literal_eval(raw)
                except (SyntaxError, ValueError) as error:
                    raise AssertionError("invalid JavaScript string in Widget view") from error
            return json.dumps(value, ensure_ascii=False, separators=(",", ":")), index + 1
        index += 1
    raise AssertionError("unterminated string in Widget view")


def normalize_widget_view(view: str) -> str:
    """Return a canonical token stream without erasing Widget semantics."""
    if not isinstance(view, str) or not view.strip():
        raise AssertionError("Widget view is empty")
    tokens: list[str] = []
    index = 0
    while index < len(view):
        char = view[index]
        if char.isspace():
            index += 1
            continue
        if view.startswith("//", index):
            newline = view.find("\n", index + 2)
            index = len(view) if newline < 0 else newline + 1
            continue
        if view.startswith("/*", index):
            end = view.find("*/", index + 2)
            if end < 0:
                raise AssertionError("unterminated comment in Widget view")
            index = end + 2
            continue
        if char in {"'", '"', "`"}:
            value, index = _read_string(view, index)
            tokens.append(f"string:{value}")
            continue
        match = IDENTIFIER.match(view, index)
        if match:
            tokens.append(f"identifier:{match.group(0)}")
            index = match.end()
            continue
        match = NUMBER.match(view, index)
        if match:
            tokens.append(f"number:{match.group(0).lower()}")
            index = match.end()
            continue
        operator = next((value for value in OPERATORS if view.startswith(value, index)), None)
        if operator:
            tokens.append(f"operator:{operator}")
            index += len(operator)
            continue
        tokens.append(f"punctuation:{char}")
        index += 1
    # JavaScript permits formatter-added trailing commas in object/array
    # literals.  Remove only commas immediately before a closing brace/bracket;
    # commas separating values remain semantic tokens.
    normalized_tokens: list[str] = []
    for token_index, token in enumerate(tokens):
        next_token = tokens[token_index + 1] if token_index + 1 < len(tokens) else None
        if token == "punctuation:," and next_token in {"punctuation:}", "punctuation:]"}:
            continue
        normalized_tokens.append(token)
    return "\n".join(normalized_tokens) + "\n"


def semantic_view_sha256(view: str) -> str:
    normalized = normalize_widget_view(view)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def assert_semantically_equal(source_view: str, exported_view: str) -> str:
    source_hash = semantic_view_sha256(source_view)
    exported_hash = semantic_view_sha256(exported_view)
    if source_hash != exported_hash:
        raise AssertionError(
            "Widget semantic view drift: component, variable, literal, or Action payload changed"
        )
    return source_hash


def assert_runtime_safe_view(view: str) -> None:
    normalized = normalize_widget_view(view)
    forbidden_components = {"Chart", "Table", "ListView"}
    components = set(re.findall(r"<\s*([A-Z][A-Za-z0-9_.]*)", view))
    dangerous = sorted(components & forbidden_components)
    if dangerous:
        raise AssertionError(f"RuntimeSafe Widget contains forbidden dynamic component: {dangerous}")
    if "identifier:sys.chat" not in normalized and "string:\"sys.chat\"" not in normalized:
        raise AssertionError("RuntimeSafe Widget must preserve sys.chat actions")
