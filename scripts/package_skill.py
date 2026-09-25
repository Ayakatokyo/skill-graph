#!/usr/bin/env python3
"""Package the runtime skill, without development dependencies or example sources."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
skill = root / "skill-graph"
required = ["SKILL.md", "scripts/skill-graph.mjs", "assets/viewer/index.html", "THIRD_PARTY_NOTICES.md"]
for name in required:
    if not (skill / name).is_file():
        raise SystemExit(f"Missing {name}; run npm run build and node scripts/notices.mjs first.")
output = root / "artifacts" / "skill-graph-v0.1.0.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(skill.rglob("*")):
        if file.is_file() and not any(p in {"__pycache__", ".DS_Store", "node_modules"} for p in file.parts):
            archive.write(file, file.relative_to(root))
print(f"{output} ({output.stat().st_size:,} bytes)")
