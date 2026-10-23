"""Offline regressions. Never opens a display or loads a native library."""
import importlib.util
import contextlib
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fullscreen_key', Path(__file__).with_name('window-fullscreen-key.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
expected = SimpleNamespace(title='OpenTab fullscreen native 11111111-2222-4333-8444-555555555555',
                           profile='/tmp/opentab-zen-native-unique', extension_root='/workspace/opentab-fixture')
argv = ['chromium', f'--user-data-dir={expected.profile}', f'--load-extension={expected.extension_root}']


class Fake:
    def __init__(self):
        self.calls, self.keys = [], []
        self.xtest = True
        self.codes = {'Control_L': 37, 'Shift_L': 50, 'y': 29}
        self.focus = [{'xid': 81, 'title': 'Renderer child', 'pid': None},
                      {'xid': 80, 'title': expected.title + ' - Chromium', 'pid': 1001}]
        self.fail_down, self.fail_up, self.fail_sync = None, None, False
        self.focus_calls, self.lose_focus = 0, None

    def open(self):
        self.calls.append('open')

    def close(self):
        self.calls.append('close')

    def has_xtest(self):
        return self.xtest

    def keycode(self, name):
        return self.codes[name]

    def focused_ancestors(self):
        self.focus_calls += 1
        return [] if self.focus_calls == self.lose_focus else self.focus

    def key(self, code, pressed):
        self.keys.append((code, pressed))
        if code == (self.fail_down if pressed else self.fail_up):
            raise helper.NativeKeyError('Synthetic XTEST failure')

    def sync(self):
        self.calls.append('sync')
        if self.fail_sync:
            self.fail_sync = False
            raise helper.NativeKeyError('Synthetic asynchronous X error')


def emit(fake, args=None):
    return helper.emit_shortcut(fake, expected, lambda pid: argv if pid == 1001 and args is None else args or [], focus_timeout=0)


class NativeShortcutTests(unittest.TestCase):
    def test_missing_display_fails_without_loading_native_libraries(self):
        args = ['window-fullscreen-key.py', '--title', expected.title, '--profile', expected.profile,
                '--extension-root', expected.extension_root]
        with patch.object(helper.sys, 'argv', args), patch.dict(helper.os.environ, {'DISPLAY': ''}), \
                patch.object(helper, 'X11', side_effect=AssertionError('Native libraries must not be loaded')):
            with self.assertRaisesRegex(helper.NativeKeyError, 'require Linux X11 DISPLAY'):
                helper.main()

    def test_native_order_and_reverse_release(self):
        fake = Fake()
        self.assertEqual(emit(fake), {'xid': 80, 'pid': 1001, 'keys': 'Control_L+Shift_L+y'})
        self.assertEqual(fake.keys, [(37, True), (50, True), (29, True), (29, False), (50, False), (37, False)])
        self.assertEqual(fake.calls, ['open', 'sync', 'sync', 'sync', 'sync', 'close'])
        self.assertEqual(fake.focus_calls, 4, 'focus/identity is rechecked immediately before every keydown')

    def test_readiness_waits_for_native_title_and_focus_before_any_keys(self):
        fake = Fake()
        fake.lose_focus = 1
        with patch.object(helper.time, 'monotonic', side_effect=[0, 0.1]), patch.object(helper.time, 'sleep') as sleep:
            helper.emit_shortcut(fake, expected, lambda pid: argv if pid == 1001 else [], focus_timeout=1)
        sleep.assert_called_once_with(0.025)
        self.assertEqual(fake.focus_calls, 5)
        self.assertEqual(fake.keys, [(37, True), (50, True), (29, True), (29, False), (50, False), (37, False)])

    def test_missing_xtest_or_keys_fails_before_emission(self):
        for failure in ('xtest', 'missing', 'duplicate'):
            fake = Fake()
            if failure == 'xtest':
                fake.xtest = False
            elif failure == 'missing':
                fake.codes['y'] = 0
            else:
                fake.codes['y'] = 50
            with self.assertRaises(helper.NativeKeyError):
                emit(fake)
            self.assertEqual(fake.keys, [])
            self.assertEqual(fake.calls[-1], 'close')

    def test_wrong_title_pid_profile_or_extension_never_emits(self):
        for failure in ('title', 'invalid-title', 'pid', 'profile', 'extension', 'prefix', 'no-focus'):
            fake, args = Fake(), None
            if failure == 'title':
                fake.focus[-1]['title'] = 'Unrelated browser'
            elif failure == 'invalid-title':
                fake.focus[-1]['title'] = 3
            elif failure == 'pid':
                fake.focus[-1]['pid'] = 2002
            elif failure == 'profile':
                args = ['chromium', '--user-data-dir=/tmp/other', argv[2]]
            elif failure == 'extension':
                args = ['chromium', argv[1], '--load-extension=/tmp/other']
            elif failure == 'prefix':
                args = ['chromium', argv[1] + '-different', argv[2]]
            else:
                fake.focus = []
            with self.assertRaises(helper.NativeKeyError):
                emit(fake, args)
            self.assertEqual(fake.keys, [], failure)
            self.assertEqual(fake.calls[-1], 'close')

    def test_focus_diagnostics_are_bounded_ids_and_booleans_only(self):
        fake = Fake()
        fake.focus = [{'xid': index + 2, 'pid': 1001, 'title': 'Private unrelated application title'} for index in range(20)]
        with self.assertRaises(helper.NativeKeyError) as raised:
            helper.verify_focus(fake, expected, lambda _pid: ['secret-argument'])
        message = str(raised.exception)
        self.assertNotIn('Private unrelated', message)
        self.assertNotIn('secret-argument', message)
        self.assertNotIn(expected.profile, message)
        self.assertEqual(message.count('"xid"'), 8)
        self.assertIn('"titleMatched": false', message)
        self.assertIn('"profileMatched": null', message)

    def test_primary_error_is_preserved_when_cleanup_also_fails(self):
        fake = Fake()
        fake.fail_down = fake.fail_up = 50
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(helper.NativeKeyError) as raised:
            emit(fake)
        self.assertEqual(str(raised.exception), 'Synthetic XTEST failure')
        self.assertIn('original error is preserved', stderr.getvalue())
        self.assertEqual(fake.keys, [(37, True), (50, True), (50, False), (37, False)])

    def test_partial_emission_never_retries_and_releases_uncertain_key(self):
        for code, attempted in ((37, [37]), (50, [37, 50]), (29, [37, 50, 29])):
            fake = Fake()
            fake.fail_down = code
            with self.assertRaises(helper.NativeKeyError):
                emit(fake)
            self.assertEqual(fake.keys, [(key, True) for key in attempted] + [(key, False) for key in reversed(attempted)])
            self.assertEqual(fake.calls[-2:], ['sync', 'close'])

    def test_focus_loss_after_modifier_releases_without_sending_command(self):
        fake = Fake()
        fake.lose_focus = 3
        with self.assertRaises(helper.NativeKeyError):
            emit(fake)
        self.assertEqual(fake.keys, [(37, True), (37, False)])
        self.assertEqual(fake.calls[-2:], ['sync', 'close'])

    def test_async_native_error_still_releases(self):
        fake = Fake()
        fake.fail_sync = True
        with self.assertRaises(helper.NativeKeyError):
            emit(fake)
        self.assertEqual(fake.keys, [(37, True), (37, False)])
        self.assertEqual(fake.calls[-1], 'close')

    def test_cleanup_attempts_every_release_and_sync_even_after_failure(self):
        fake = Fake()
        fake.fail_up = 29
        with self.assertRaisesRegex(helper.NativeKeyError, 'cleanup failed'):
            emit(fake)
        self.assertEqual(fake.keys[-3:], [(29, False), (50, False), (37, False)])
        self.assertEqual(fake.calls[-2:], ['sync', 'close'])


if __name__ == '__main__':
    unittest.main()
