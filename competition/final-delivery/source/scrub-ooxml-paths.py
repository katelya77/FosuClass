from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import re
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
            # PowerPoint stores the source image path in cNvPr@descr.  It is
            # not needed for playback and must never expose a workstation.
            updated = re.sub(
                r'descr="(?:[A-Za-z]:\\|file:///|/Users/|/home/)[^"]*[\\/](?P<name>[^"\\/]+)"',
                r'descr="\g<name>"',
                updated,
                flags=re.I,
            )
            if info.filename == "docProps/core.xml":
                updated = re.sub(
                    r"<cp:lastModifiedBy>.*?</cp:lastModifiedBy>",
                    "<cp:lastModifiedBy>校园智序·小序</cp:lastModifiedBy>",
                    updated,
                    flags=re.S,
                )
            if updated != text:
                changed += 1
                data = updated.encode("utf-8")
        output.writestr(info, data)

temp.replace(target)
print(f"scrubbed={changed} target={target.name}")
