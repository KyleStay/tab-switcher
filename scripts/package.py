#!/usr/bin/env python3
"""Build reproducible, permission-preserving production and development ZIPs."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def build():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    packages = []
    for channel in ("production", "dev"):
        output = ROOT / "dist" / channel
        if output.exists():
            shutil.rmtree(output)
        output.mkdir(parents=True)
        shutil.copytree(ROOT / "src", output / "src")
        variant = copy.deepcopy(manifest)
        if channel == "dev":
            variant["version"] = version + ".1"
            variant["version_name"] = version + " Dev 1"
            variant["name"] += " Dev"
            variant["action"]["default_title"] += " Dev"
            # Do not compete with existing production command assignments.
            for command in variant["commands"].values():
                command.pop("suggested_key", None)
            for filename in ("switcher.html", "options.html"):
                path = output / "src" / filename
                text = path.read_text().replace("Tab Switcher", "Tab Switcher Dev")
                text = text.replace(
                    "Chrome may reserve shortcuts like Ctrl+Tab. Confirm Command+E, Ctrl+E, Option+E, or Alt+E in extension shortcut settings.",
                    "Development shortcuts start unassigned. Choose unused shortcuts in extension shortcut settings; production remains active."
                )
                path.write_text(text)
        (output / "manifest.json").write_text(json.dumps(variant, indent=2) + "\n")
        archive = ROOT / "dist" / f"tab-switcher-{channel}-{variant['version']}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(output.rglob("*")):
                if path.is_file():
                    info = zipfile.ZipInfo(path.relative_to(output).as_posix(), (2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    bundle.writestr(info, path.read_bytes())
        packages.append({"channel": channel, "version": variant["version"], "path": str(archive),
                         "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()})
    (ROOT / "dist" / "packages.json").write_text(json.dumps(packages, indent=2) + "\n")
    print(json.dumps(packages, indent=2))


if __name__ == "__main__":
    build()
