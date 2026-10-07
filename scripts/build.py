#!/usr/bin/env python3
"""Generate both distributions from extension/; never edit dist/ by hand."""
from pathlib import Path
import json
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'extension'
manifest = json.loads((source / 'manifest.json').read_text())
version = manifest['version']
out = root / 'dist'
out.mkdir(exist_ok=True)
assets = sorted(f for f in source.iterdir() if f.is_file() and f.suffix in {'.js', '.json', '.html', '.css'})

# Both packages use the exact same MV3 manifest and source assets.
for browser_name, archive_name in [
    ('firefox', f'tuwien-auto-login-{version}-unsigned.xpi'),
    ('chrome', f'tuwien-auto-login-{version}-chrome.zip'),
]:
    folder = out / browser_name
    # Remove stale generated assets while keeping each installation path stable.
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir()
    for file in assets:
        if file.name != 'manifest.json':
            shutil.copy2(file, folder / file.name)
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = out / archive_name
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(folder.iterdir()):
            bundle.write(file, file.name)
    print(archive)
    print(f'{browser_name}: {folder}')
