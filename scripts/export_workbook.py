"""
Convert the PSOC/PSIC .xlsx source workbook into data/psa-data.json,
the file the web app (both the static site and the local server) reads.

Uses only the Python standard library (xlsx is a zip of XML files),
so no pandas/openpyxl install is required to keep the data fresh.

Run manually after replacing the workbook:
    python scripts/export_workbook.py
"""
from pathlib import Path, PurePosixPath
import json
import re
import zipfile
import xml.etree.ElementTree as ET

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
OUTPUT_PATH = DATA_DIR / "psa-data.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Trailing-".0" pattern produced when Excel stores whole numbers as floats
# (e.g. a PSOC code exported as "2411.0"). Cleaned to "2411" for display.
_TRAILING_ZERO = re.compile(r"^-?\d+\.0$")

# Friendly display labels, derived from the source column codes themselves
# (PSA census/survey item codes). The raw code is kept in parentheses so the
# mapping stays traceable back to the original workbook column.
COLUMN_LABELS = {
    "C13_OCCUP": "Occupation (C13)",
    "C14_PROCC": "Occupation Code (C14)",
    "C15_INDUSTRY": "Industry (C15)",
    "C16_PKB": "Industry Code (C16)",
    "C23_PCLASS": "Class of Worker (C23)",
    "C07_HGC_LEVEL": "Highest Grade Completed - Level (C07)",
    "C07_GRADE": "Highest Grade Completed - Code (C07)",
    "C07A_GRADE": "Highest Grade Completed - Description (C07A)",
}


def find_workbook():
    files = sorted(DATA_DIR.glob("*.xlsx"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not files:
        raise FileNotFoundError("No .xlsx file found inside the data folder.")
    return files[0]


def column_index(ref):
    letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    number = 0
    for char in letters:
        number = number * 26 + ord(char) - ord("A") + 1
    return max(0, number - 1)


def text_of(element):
    if element is None:
        return ""
    return "".join(element.itertext())


def read_shared_strings(book):
    try:
        root_xml = ET.fromstring(book.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(item.itertext()) for item in root_xml.findall("m:si", NS)]


def normalize_rel_target(target):
    raw = target.lstrip("/")
    parts = []
    path = PurePosixPath(raw)
    if not str(path).startswith("xl/"):
        path = PurePosixPath("xl") / path
    for part in path.parts:
        if part == ".":
            continue
        if part == "..":
            if parts and parts[-1] != "..":
                parts.pop()
            else:
                parts.append(part)
        else:
            parts.append(part)
    return PurePosixPath(*parts).as_posix()


def read_sheet_targets(book):
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    sheets = []
    rid_key = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        target = rel_map.get(sheet.attrib.get(rid_key), "")
        target = normalize_rel_target(target)
        sheets.append((sheet.attrib["name"], target))
    return sheets


def read_cell(cell, strings):
    kind = cell.attrib.get("t")
    value = cell.find("m:v", NS)
    if kind == "s":
        raw = text_of(value)
        if raw.isdigit() and int(raw) < len(strings):
            return strings[int(raw)]
        return raw
    if kind == "inlineStr":
        return text_of(cell.find("m:is", NS))
    if kind == "b":
        return "TRUE" if text_of(value) == "1" else "FALSE"
    return text_of(value)


def clean_value(value):
    """Trim whitespace and strip a spurious trailing '.0' from whole numbers."""
    value = value.strip()
    if _TRAILING_ZERO.match(value):
        return value[:-2]
    return value


def parse_sheet(book, target, strings):
    root_xml = ET.fromstring(book.read(target))
    raw_rows = []
    for row in root_xml.findall("m:sheetData/m:row", NS):
        values = []
        for cell in row.findall("m:c", NS):
            index = column_index(cell.attrib.get("r", "")) if cell.attrib.get("r") else len(values)
            while len(values) <= index:
                values.append("")
            values[index] = clean_value(read_cell(cell, strings))
        if any(values):
            raw_rows.append(values)
    if not raw_rows:
        return {"columns": [], "labels": {}, "rows": []}

    width = max(len(row) for row in raw_rows)
    header = raw_rows[0]
    columns = []
    seen = {}
    for index in range(width):
        name = header[index].strip() if index < len(header) else ""
        name = name or f"Column {index + 1}"
        seen[name] = seen.get(name, 0) + 1
        columns.append(name if seen[name] == 1 else f"{name} {seen[name]}")

    rows = []
    for raw in raw_rows[1:]:
        item = {column: raw[index] if index < len(raw) else "" for index, column in enumerate(columns)}
        if any(item.values()):
            rows.append(item)

    # Drop columns that are empty across every row.
    filtered_columns = [
        column for column in columns
        if column.strip() and any(str(row.get(column, "")).strip() for row in rows)
    ]
    if filtered_columns and len(filtered_columns) != len(columns):
        rows = [{column: row.get(column, "") for column in filtered_columns} for row in rows]
        columns = filtered_columns

    labels = {column: COLUMN_LABELS.get(column, column) for column in columns}
    return {"columns": columns, "labels": labels, "rows": rows}


def export_workbook():
    workbook_path = find_workbook()
    with zipfile.ZipFile(workbook_path) as book:
        strings = read_shared_strings(book)
        sheets = []
        for name, target in read_sheet_targets(book):
            parsed = parse_sheet(book, target, strings)
            sheets.append({
                "name": name,
                "columns": parsed["columns"],
                "labels": parsed["labels"],
                "rows": parsed["rows"],
                "count": len(parsed["rows"]),
            })
    payload = {
        "file": workbook_path.name,
        "generated": True,
        "sheets": sheets,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    result = export_workbook()
    total_rows = sum(sheet["count"] for sheet in result["sheets"])
    print(f"Exported {result['file']} -> {OUTPUT_PATH.relative_to(BASE_DIR)}")
    print(f"Sheets: {len(result['sheets'])}  |  Total rows: {total_rows}")
    for sheet in result["sheets"]:
        print(f"  - {sheet['name']}: {sheet['count']} rows, columns={sheet['columns']}")
