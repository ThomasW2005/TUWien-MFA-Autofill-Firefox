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

# Safari: non-persistent service worker only, no Firefox/Chrome-specific keys.
safari_manifest = {k: v for k, v in manifest.items() if k not in {'browser_specific_settings', 'minimum_chrome_version'}}
safari_manifest['background'] = {'service_worker': manifest['background']['service_worker']}

# Firefox and Chrome use the exact same MV3 manifest; Safari gets a trimmed copy
# (unpacked folder only, consumed by the Xcode project under safari/).
for browser_name, archive_name, browser_manifest in [
    ('firefox', f'TUWien-MFA-Autofill-Firefox-{version}-unsigned.xpi', manifest),
    ('chrome', f'TUWien-MFA-Autofill-Firefox-{version}-chrome.zip', manifest),
    ('safari', None, safari_manifest),
]:
    folder = out / browser_name
    # Remove stale generated assets while keeping each installation path stable.
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir()
    for file in assets:
        if file.name != 'manifest.json':
            shutil.copy2(file, folder / file.name)
    (folder / 'manifest.json').write_text(json.dumps(browser_manifest, indent=2) + '\n')
    if archive_name is None:
        print(f'{browser_name}: {folder}')
        continue
    archive = out / archive_name
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(folder.iterdir()):
            bundle.write(file, file.name)
    print(archive)
    print(f'{browser_name}: {folder}')
