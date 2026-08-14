import base64
import hashlib
import json
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUTPUT = REPO / "output" / "competition-adp" / "r5"

from bind_runtime_environment import (  # noqa: E402
    EXPECTED_HERO_DEFAULT_SHA256,
    EXPECTED_HERO_EXPORT_SHA256,
    EXPECTED_HERO_SCHEMA_SHA256,
    EXPECTED_HERO_SOURCE_VIEW_SHA256,
    EXPECTED_HERO_TENCENT_VIEW_SHA256,
    EXPECTED_HERO_WIDGET_ID,
    parse_widget,
)
from widget_semantic_view import (  # noqa: E402
    assert_runtime_safe_view,
    assert_semantically_equal,
    semantic_view_sha256,
)


def expect_red(callable_value, message):
    try:
        callable_value()
    except AssertionError:
        return
    raise AssertionError(f"expected semantic RED gate: {message}")


def main():
    evidence = OUTPUT / "05-Tencent-Widget-Evidence.widget"
    assert hashlib.sha256(evidence.read_bytes()).hexdigest() == EXPECTED_HERO_EXPORT_SHA256
    parsed = parse_widget(evidence)
    record = parsed["record"]
    inner = parsed["inner"]
    source = (ROOT / "campus-overview-v1" / "template.txt").read_text(encoding="utf-8")
    exported = inner["view"]

    assert parsed["kind"] == "CampusOverview"
    assert record["realWidgetId"] == EXPECTED_HERO_WIDGET_ID
    assert record["sourceTemplateSha256"] == EXPECTED_HERO_SOURCE_VIEW_SHA256
    assert record["tencentExportViewSha256"] == EXPECTED_HERO_TENCENT_VIEW_SHA256
    assert record["schemaSha256"] == EXPECTED_HERO_SCHEMA_SHA256
    assert record["defaultStateSha256"] == EXPECTED_HERO_DEFAULT_SHA256
    assert record["validity"] == {"schema": "valid", "view": "valid", "defaultState": "valid"}
    assert EXPECTED_HERO_SOURCE_VIEW_SHA256 != EXPECTED_HERO_TENCENT_VIEW_SHA256
    assert_semantically_equal(source, exported)
    assert record["semanticViewSha256"] == semantic_view_sha256(source)
    assert_runtime_safe_view(exported)

    formatter_only = source.replace('type: "sys.chat", payload:', "type: 'sys.chat',\n          payload:")
    formatter_only = formatter_only.replace("}}} />", "},},} />")
    assert_semantically_equal(source, formatter_only)

    expect_red(lambda: assert_semantically_equal(source, source.replace("{title}", '"title"', 1)), "variable removed")
    expect_red(lambda: assert_semantically_equal(source, source.replace("sys.chat", "sys.go_to_url", 1)), "sys.chat changed")
    expect_red(lambda: assert_semantically_equal(source, source.replace("action0Message", "action1Message", 1)), "Action message field changed")
    expect_red(lambda: assert_semantically_equal(source, source.replace("<Card", "<Col", 1)), "component changed")
    expect_red(lambda: assert_runtime_safe_view(source.replace("<Divider />", "<Chart data={title} />", 1)), "Chart added")

    mutated = dict(parsed["outer"])
    mutated_inner = dict(inner)
    mutated_inner["id"] = "0" * 32
    mutated["encodedWidget"] = base64.b64encode(
        json.dumps(mutated_inner, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "changed.widget"
        path.write_text(json.dumps(mutated, ensure_ascii=False), encoding="utf-8")
        expect_red(lambda: parse_widget(path), "synthetic WidgetID/export hash")
    print("test_widget_semantic_r5 passed")


if __name__ == "__main__":
    main()
