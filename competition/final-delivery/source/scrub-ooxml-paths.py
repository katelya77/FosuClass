from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import sys


target = Path(sys.argv[1]).resolve()
workspace = Path.cwd().resolve()
temp = target.with_name(f"{target.stem}.scrubbed{target.suffix}")
replacements = (
    str(workspace),
    str(workspace).replace("\\", "/"),
    workspace.name,
)

changed = 0
with ZipFile(target, "r") as source, ZipFile(temp, "w", ZIP_DEFLATED) as output:
    for info in source.infolist():
        data = source.read(info.filename)
        if info.filename.endswith((".xml", ".rels")):
            text = data.decode("utf-8", errors="strict")
            updated = text
            for value in replacements:
                updated = updated.replace(value, "competition-project")
            if updated != text:
                changed += 1
                data = updated.encode("utf-8")
        output.writestr(info, data)

temp.replace(target)
print(f"scrubbed={changed} target={target.name}")
