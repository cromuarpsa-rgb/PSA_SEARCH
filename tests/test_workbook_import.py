import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.export_workbook import export_workbook  # noqa: E402


def test_export_workbook_creates_json_payload():
    payload = export_workbook()
    assert payload["file"] == "032026_Sorted PSOC PSIC.xlsx"
    assert len(payload["sheets"]) >= 1
    assert payload["sheets"][0]["name"]
    assert payload["sheets"][0]["rows"] is not None

    output_path = Path(__file__).resolve().parents[1] / "data" / "psa-data.json"
    assert output_path.exists()
    data = json.loads(output_path.read_text(encoding="utf-8"))
    assert data["file"] == payload["file"]


def test_numeric_values_are_cleaned():
    payload = export_workbook()
    sheet = next(s for s in payload["sheets"] if s["name"] == "sorted PSOC PSIC")
    for row in sheet["rows"][:50]:
        for value in row.values():
            assert not value.endswith(".0") or not value[:-2].isdigit()


def test_columns_have_display_labels():
    payload = export_workbook()
    for sheet in payload["sheets"]:
        assert set(sheet["labels"].keys()) == set(sheet["columns"])
