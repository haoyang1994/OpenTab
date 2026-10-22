#!/usr/bin/env python3
"""Offline, fail-closed, reproducible extension ZIP. No npm install required."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_DIRS = {'assets', 'icons', 'lib', 'locales', '_locales', 'vendor'}
LEGAL = {'LICENSE', 'NOTICE', 'icons/library/SIMPLE-ICONS-LICENSE.md',
         'vendor/flatpickr/LICENSE.md', 'vendor/xterm/LICENSE', 'vendor/xterm-addon-fit/LICENSE'}
# Migration keys are old user settings, not resources loaded by the extension.
LEGACY_BACKGROUNDS = {
    'assets/default_background/pexels-pixabay-40896.jpg',
    'assets/default_background/pexels-elina-sazonova-4275497.jpg',
    'assets/default_background/pexels-souvenirpixels-417074.jpg',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def runtime_path(name):
    p = PurePosixPath(name)
    return (len(p.parts) == 1 and (p.suffix in {'.js', '.css', '.html'} or name in {'manifest.json', 'LICENSE', 'NOTICE'})) or p.parts[0] in RUNTIME_DIRS


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name, f'Unsafe path: {name!r}')
    p = PurePosixPath(name)
    require(not p.is_absolute() and str(p) == name and all(x not in {'.', '..'} and not x.startswith('.') for x in p.parts), f'Unsafe path: {name}')
    require(runtime_path(name), f'Non-runtime path: {name}')
    require(p.suffix not in {'.map', '.pem', '.zip', '.crx', '.log', '.tmp', '.mjs'} and not ({'node_modules', 'tests', 'scripts', 'docs', 'specs', 'screenshots', '__pycache__'} & set(p.parts)), f'Development/secret path: {name}')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in {'src', 'href', 'data-value'}:
                if key != 'data-value' or value.startswith('assets/'):
                    self.refs.append(value)


def validate_closure(blobs):
    manifest = json.loads(blobs['manifest.json'])
    require(manifest.get('manifest_version') == 3, 'Expected MV3 manifest')
    require(re.fullmatch(r'\d+(?:\.\d+){0,3}', manifest['version']), 'Invalid version')

    def reference(source, ref):
        if not ref or re.match(r'^(?:[a-zA-Z][\w+.-]*:|//|#)', ref):
            return
        ref = ref.split('?', 1)[0].split('#', 1)[0]
        # Normalize relative CSS/module references, but never permit escape.
        parts = list(PurePosixPath(source).parent.parts)
        require(not ref.startswith('/'), f'Absolute asset in {source}: {ref}')
        for part in ref.split('/'):
            if part == '..':
                require(parts, f'Escaping asset in {source}: {ref}')
                parts.pop()
            elif part not in {'', '.'}:
                parts.append(part)
        target = '/'.join(parts)
        require(target in blobs, f'Missing packaged asset: {source} -> {ref}')

    refs = list(manifest.get('chrome_url_overrides', {}).values())
    refs += list(manifest.get('icons', {}).values())
    refs += [manifest.get('background', {}).get('service_worker', '')]
    action = manifest.get('action', {})
    refs += [action.get('default_popup', '')]
    icons = action.get('default_icon', {})
    refs += [icons] if isinstance(icons, str) else list(icons.values())
    for ref in refs:
        reference('manifest.json', ref)
    default = manifest.get('default_locale')
    require(f'_locales/{default}/messages.json' in blobs, 'Missing default locale')
    keys = set(re.findall(r'__MSG_(\w+)__', blobs['manifest.json'].decode()))
    for name, data in blobs.items():
        if name.startswith('_locales/') and name.endswith('/messages.json'):
            messages = json.loads(data)
            require(all(isinstance(messages.get(k, {}).get('message'), str) and messages[k]['message'].strip() for k in keys), f'Incomplete manifest messages: {name}')
        if Path(name).suffix not in {'.html', '.css', '.js'}:
            continue
        text = data.decode('utf-8')
        if name.endswith('.html'):
            parser = References()
            parser.feed(text)
            for ref in parser.refs:
                reference(name, ref)
        if name.endswith(('.html', '.css')):
            for ref in re.findall(r'url\(\s*[\'"]?([^\s\)\'"]+)', text):
                reference(name, ref)
        if name.endswith('.js') and not name.startswith('vendor/'):
            for call in re.findall(r'importScripts\((.*?)\)', text, re.S):
                for ref in re.findall(r'[\'"]([^\'"]+)[\'"]', call):
                    reference(name, ref)
            for ref in re.findall(r'(?:from\s+|import\s*\()[\'"]([^\'"]+)[\'"]', text):
                reference(name, ref)
            # Local literal paths, including dynamic page routing and wallpapers.
            for ref in re.findall(r'[\'"`]((?:assets/|icons/|locales/|vendor/|lib/)[^\'"`$]+\.(?:js|css|json|svg|png|jpg|webp)|[\w-]+\.html)(?:[?][^\'"`]*)?[\'"`]', text):
                if ref not in LEGACY_BACKGROUNDS:
                    reference(name, ref)
    for entry in json.loads(blobs['icons/library/catalog.json']):
        reference('manifest.json', f"icons/library/{entry['slug']}.svg")
    require(LEGAL <= blobs.keys(), 'Missing redistribution licenses/notices')


def collect(root=ROOT, allowlist=None):
    names = json.loads((allowlist or root / 'scripts/release-files.json').read_text())
    require(isinstance(names, list) and names == sorted(set(names)), 'Allowlist must be sorted and unique')
    tracked = set(git(root, 'ls-files', '-z').decode().split('\0')) - {''}
    require({n for n in tracked if runtime_path(n)} == set(names), 'Runtime inventory differs from reviewed allowlist; review scripts/release-files.json')
    blobs = {}
    for name in names:
        safe_name(name)
        p = root
        for part in PurePosixPath(name).parts:
            p /= part
            require(not p.is_symlink(), f'Symlink forbidden: {name}')
        check = subprocess.run(['git', '-C', str(root), 'check-ignore', '--no-index', '-q', '--', name], check=False)
        require(check.returncode == 1, f'Ignored file (or git error): {name}')
        require(p.is_file(), f'Missing regular file: {name}')
        blobs[name] = p.read_bytes()
    validate_closure(blobs)
    return blobs


def build(root=ROOT, output=None, allowlist=None):
    blobs = collect(root, allowlist)
    version = json.loads(blobs['manifest.json'])['version']
    output = Path(output or root / 'dist' / f'opentab-{version}.zip').absolute()
    require(output.suffix == '.zip', 'Output must end in .zip')
    require(output not in {root / n for n in blobs}, 'Cannot overwrite runtime input')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Stored entries avoid zlib-version differences; timestamps, mode and order are fixed.
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.tmp', delete=False) as tmp:
        temporary = Path(tmp.name)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as archive:
            for name, data in blobs.items():
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = build(output=args.output)
        print(f'{result}\nSHA256 {hashlib.sha256(result.read_bytes()).hexdigest()}')
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Release packaging failed: {error}\n')
