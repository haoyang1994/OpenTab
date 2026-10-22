"""Offline release regression tests; deliberately mutate isolated source fixtures."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('packager', ROOT / 'scripts/package-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        self.names = json.loads((ROOT / 'scripts/release-files.json').read_text())
        for name in self.names + ['.gitignore', 'scripts/release-files.json']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.git('init', '-q')
        self.git('add', '.')

    def git(self, *args):
        subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)

    def build(self):
        return packager.build(self.root)

    def reject(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.build()
        self.assertFalse((self.root / 'dist').exists(), 'Validation must finish before creating output')

    def test_deterministic_bytes_metadata_and_complete_inventory(self):
        first = self.build().read_bytes()
        for name in self.names:
            os.utime(self.root / name, (1700000000, 1800000000))
            os.chmod(self.root / name, 0o600)
        second = self.build().read_bytes()
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())
        with zipfile.ZipFile(self.build()) as archive:
            self.assertEqual(archive.namelist(), self.names)
            self.assertNotIn('fixparser.html', archive.namelist())
            self.assertNotIn('fixparser.js', archive.namelist())
            self.assertIsNone(archive.testzip())
            for item in archive.infolist():
                self.assertEqual(item.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(item.external_attr >> 16, 0o100644)
                self.assertEqual(item.compress_type, zipfile.ZIP_STORED)
                self.assertEqual(archive.read(item), (self.root / item.filename).read_bytes())
            self.assertEqual(archive.read('manifest.json'), (ROOT / 'manifest.json').read_bytes())
            extracted = Path(self.temp.name) / 'extracted'
            archive.extractall(extracted)
            packager.validate_closure({n: (extracted / n).read_bytes() for n in self.names})

    def test_non_runtime_and_untracked_files_never_leak(self):
        for name in ['secret.pem', '.env', 'ssh-gateway.mjs', 'package.json', 'scripts/debug.js', 'node_modules/a.js', 'tests/debug.js', 'assets/unreviewed.png']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('not runtime')
        with zipfile.ZipFile(self.build()) as archive:
            self.assertEqual(archive.namelist(), self.names)
            self.assertNotIn('fixparser.html', archive.namelist())
            self.assertNotIn('fixparser.js', archive.namelist())

    def test_missing_file(self):
        (self.root / 'home.js').unlink()
        self.reject('Missing regular file')

    def test_new_tracked_runtime_requires_review(self):
        (self.root / 'new-runtime.js').write_text('')
        self.git('add', 'new-runtime.js')
        self.reject('inventory differs')

    def test_ignored_file_even_when_tracked(self):
        with (self.root / '.gitignore').open('a') as f:
            f.write('\nhome.js\n')
        self.reject('Ignored file')

    def test_file_symlink(self):
        (self.root / 'home.js').unlink()
        (self.root / 'home.js').symlink_to(ROOT / 'home.js')
        self.reject('Symlink forbidden')

    def test_directory_symlink(self):
        shutil.rmtree(self.root / 'assets')
        (self.root / 'assets').symlink_to(ROOT / 'assets', target_is_directory=True)
        self.reject('Symlink forbidden')

    def test_unsafe_names(self):
        for name in ['../home.js', '/home.js', 'assets/../home.js', 'assets//x.js', 'assets/./x.js', 'assets\\x.js', '.git/config', 'node_modules/a.js', 'ssh-gateway.mjs', 'package.json', 'vendor/key.pem']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.safe_name(name)

    def test_allowlist_must_be_sorted_and_unique(self):
        (self.root / 'scripts/release-files.json').write_text(json.dumps(self.names + ['home.js']))
        self.reject('sorted and unique')

    def test_html_reference_closure(self):
        with (self.root / 'home.html').open('a') as f:
            f.write('<script src="missing.js"></script>')
        self.reject('Missing packaged asset')

    def test_css_reference_closure(self):
        with (self.root / 'home.css').open('a') as f:
            f.write('body { background:url(missing.png) }')
        self.reject('Missing packaged asset')

    def test_worker_reference_closure(self):
        with (self.root / 'background.js').open('a') as f:
            f.write("importScripts('missing.js');")
        self.reject('Missing packaged asset')

    def test_manifest_reference_closure(self):
        manifest = json.loads((self.root / 'manifest.json').read_text())
        manifest['action']['default_popup'] = 'missing.html'
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        self.reject('Missing packaged asset')

    def test_locale_completeness(self):
        (self.root / '_locales/zh_CN/messages.json').write_text('{}')
        self.reject('Incomplete manifest messages')

    def test_icon_catalog_closure(self):
        (self.root / 'icons/library/catalog.json').write_text('[{"slug":"missing"}]')
        self.reject('Missing packaged asset')


if __name__ == '__main__':
    unittest.main()
