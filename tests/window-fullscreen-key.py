#!/usr/bin/env python3
"""One native shortcut, only to the positively identified disposable test window.

No packages, subprocess key tools, focus stealing, or synthetic browser fallback.
XTEST injects real X-server events, unlike CDP's renderer-only key dispatch.
"""
import argparse
import ctypes as C
import json
import os
from pathlib import Path
import re
import signal
import sys
import time


class NativeKeyError(RuntimeError):
    pass


class X11:
    def __init__(self):
        try:
            self.x = C.CDLL('libX11.so.6')
            self.xt = C.CDLL('libXtst.so.6')
        except OSError as error:
            raise NativeKeyError('Native fullscreen test requires libX11.so.6 and libXtst.so.6; no fallback is permitted.') from error
        self.display = None
        self.errors = []
        pointer, window = C.c_void_p, C.c_ulong
        self.x.XOpenDisplay.argtypes = [C.c_char_p]
        self.x.XOpenDisplay.restype = pointer
        self.x.XCloseDisplay.argtypes = [pointer]
        self.x.XGetInputFocus.argtypes = [pointer, C.POINTER(window), C.POINTER(C.c_int)]
        self.x.XQueryTree.argtypes = [pointer, window, C.POINTER(window), C.POINTER(window), C.POINTER(C.POINTER(window)), C.POINTER(C.c_uint)]
        self.x.XInternAtom.argtypes = [pointer, C.c_char_p, C.c_int]
        self.x.XInternAtom.restype = window
        self.x.XGetWindowProperty.argtypes = [pointer, window, window, C.c_long, C.c_long, C.c_int, window,
                                             C.POINTER(window), C.POINTER(C.c_int), C.POINTER(C.c_ulong),
                                             C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ubyte))]
        self.x.XFree.argtypes = [pointer]
        self.x.XStringToKeysym.argtypes = [C.c_char_p]
        self.x.XStringToKeysym.restype = C.c_ulong
        self.x.XKeysymToKeycode.argtypes = [pointer, C.c_ulong]
        self.x.XKeysymToKeycode.restype = C.c_ubyte
        self.x.XSync.argtypes = [pointer, C.c_int]
        self.xt.XTestQueryExtension.argtypes = [pointer] + [C.POINTER(C.c_int)] * 4
        self.xt.XTestFakeKeyEvent.argtypes = [pointer, C.c_uint, C.c_int, C.c_ulong]
        # A window closing during inspection must fail through Python/finally,
        # not Xlib's default fatal handler while a modifier may be pressed.
        handler_type = C.CFUNCTYPE(C.c_int, pointer, pointer)
        self.error_handler = handler_type(self._on_error)
        self.x.XSetErrorHandler.argtypes = [handler_type]
        self.x.XSetErrorHandler.restype = pointer
        self.x.XSetErrorHandler(self.error_handler)

    def _on_error(self, _display, _event):
        self.errors.append('X11 request failed')
        return 0

    def open(self):
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise NativeKeyError('Cannot open the configured X11 DISPLAY; no native key was emitted.')

    def close(self):
        if self.display:
            self.x.XCloseDisplay(self.display)
            self.display = None

    def sync(self):
        self.x.XSync(self.display, 0)
        if self.errors:
            self.errors.clear()
            raise NativeKeyError('X11 request failed; native key emission stopped.')

    def has_xtest(self):
        values = [C.c_int() for _ in range(4)]
        return bool(self.xt.XTestQueryExtension(self.display, *(C.byref(value) for value in values)))

    def keycode(self, name):
        symbol = self.x.XStringToKeysym(name.encode('ascii'))
        return int(self.x.XKeysymToKeycode(self.display, symbol)) if symbol else 0

    def key(self, code, pressed):
        if not self.xt.XTestFakeKeyEvent(self.display, code, int(pressed), 0):
            raise NativeKeyError('XTestFakeKeyEvent failed; the command will not be retried.')

    def property(self, xid, name):
        atom = self.x.XInternAtom(self.display, name.encode('ascii'), 1)
        if not atom:
            return None
        actual, count, remaining = C.c_ulong(), C.c_ulong(), C.c_ulong()
        form, data = C.c_int(), C.POINTER(C.c_ubyte)()
        try:
            status = self.x.XGetWindowProperty(self.display, xid, atom, 0, 1024, 0, 0,
                                               C.byref(actual), C.byref(form), C.byref(count), C.byref(remaining), C.byref(data))
            if status != 0 or not data or remaining.value:
                return None
            if form.value == 8:
                return C.string_at(data, count.value).decode('utf-8', errors='replace')
            if form.value == 32 and count.value == 1:
                return int(C.cast(data, C.POINTER(C.c_ulong))[0])
            return None
        finally:
            if data:
                self.x.XFree(data)

    def focused_ancestors(self):
        focused, revert = C.c_ulong(), C.c_int()
        self.x.XGetInputFocus(self.display, C.byref(focused), C.byref(revert))
        result, seen = [], set()
        xid = focused.value
        for _ in range(64):
            if xid in (0, 1) or xid in seen:
                break
            seen.add(xid)
            result.append({'xid': xid, 'title': self.property(xid, '_NET_WM_NAME') or self.property(xid, 'WM_NAME'),
                           'pid': self.property(xid, '_NET_WM_PID')})
            root, parent, count = C.c_ulong(), C.c_ulong(), C.c_uint()
            children = C.POINTER(C.c_ulong)()
            try:
                if not self.x.XQueryTree(self.display, xid, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
                    break
                xid = parent.value
            finally:
                if children:
                    self.x.XFree(children)
        self.sync()
        return result


def process_arguments(pid):
    if not isinstance(pid, int) or pid <= 0:
        return []
    try:
        return Path(f'/proc/{pid}/cmdline').read_bytes().decode('utf-8').rstrip('\0').split('\0')
    except (OSError, UnicodeError):
        return []


def verify_focus(api, expected, read_arguments=process_arguments):
    checks = []
    for item in api.focused_ancestors():
        title_matches = isinstance(item.get('title'), str) and expected.title in item['title']
        args = read_arguments(item.get('pid')) if title_matches else []
        profile_matches = f'--user-data-dir={expected.profile}' in args if title_matches else None
        extension_matches = f'--load-extension={expected.extension_root}' in args if title_matches else None
        checks.append({'xid': item.get('xid') if type(item.get('xid')) is int else None,
                       'pid': item.get('pid') if type(item.get('pid')) is int else None, 'titleMatched': title_matches,
                       'profileMatched': profile_matches, 'extensionMatched': extension_matches})
        if title_matches and profile_matches and extension_matches:
            return item
    # Only bounded IDs/booleans are diagnostic data. Never print another app's
    # title or arbitrary process arguments, even when focus is unexpected.
    raise NativeKeyError('Focused X11 window is not the marked disposable Chrome test profile; no further keys will be emitted. '
                         + json.dumps({'focusedAncestors': checks[-8:]}))


def emit_shortcut(api, expected, read_arguments=process_arguments, focus_timeout=3):
    pressed, cleanup_errors = [], []
    failure = None
    try:
        api.open()
        if not api.has_xtest():
            raise NativeKeyError('X11 DISPLAY does not provide XTEST; no native key was emitted.')
        codes = [api.keycode(name) for name in ('Control_L', 'Shift_L', 'y')]
        if not all(codes) or len(set(codes)) != 3:
            raise NativeKeyError('Cannot resolve distinct Control_L, Shift_L, and y X11 keycodes.')
        # Only read-only focus checks are retried. Once any keydown is attempted,
        # never retry the shortcut, even if Chrome's outcome is uncertain.
        deadline = time.monotonic() + focus_timeout
        while True:
            try:
                evidence = verify_focus(api, expected, read_arguments)
                break
            except NativeKeyError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.025)
        for code in codes:
            verify_focus(api, expected, read_arguments)
            # Record before calling XTEST: a failed native call may still have
            # emitted an event and needs its corresponding release.
            pressed.append(code)
            api.key(code, True)
            api.sync()
        return {'xid': evidence['xid'], 'pid': evidence['pid'], 'keys': 'Control_L+Shift_L+y'}
    except BaseException as error:
        failure = error
        raise
    finally:
        for code in reversed(pressed):
            try:
                api.key(code, False)
            except Exception as error:
                cleanup_errors.append(str(error))
        try:
            if pressed:
                api.sync()
        except Exception as error:
            cleanup_errors.append(str(error))
        finally:
            try:
                api.close()
            except Exception as error:
                cleanup_errors.append(str(error))
        if failure or cleanup_errors:
            print('Native key diagnostics: ' + json.dumps({'attemptedKeydowns': len(pressed),
                  'releaseAttempts': len(pressed), 'cleanupFailed': bool(cleanup_errors)}), file=sys.stderr)
        if cleanup_errors:
            if failure:
                print('Native key cleanup also failed; the original error is preserved. Do not retry.', file=sys.stderr)
            else:
                raise NativeKeyError('Native key cleanup failed; do not retry the command.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--title', required=True)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--extension-root', required=True)
    args = parser.parse_args()
    if sys.platform != 'linux' or not os.environ.get('DISPLAY'):
        raise NativeKeyError('Native fullscreen accelerator checks require Linux X11 DISPLAY; no fallback is permitted.')
    if not re.fullmatch(r'OpenTab fullscreen native [0-9a-f]{8}-[0-9a-f-]{27}', args.title):
        raise NativeKeyError('A unique fullscreen fixture title marker is required.')
    args.profile = os.path.abspath(args.profile)
    args.extension_root = os.path.abspath(args.extension_root)
    if not Path(args.profile).is_dir() or not Path(args.profile).name.startswith('opentab-zen-native-'):
        raise NativeKeyError('An existing disposable Zen fixture profile is required.')
    if not (Path(args.extension_root) / 'manifest.json').is_file():
        raise NativeKeyError('The intended unpacked extension root is required.')
    def interrupted(signum, _frame):
        raise NativeKeyError(f'Native shortcut interrupted by signal {signum}; it will not be retried.')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    print(json.dumps(emit_shortcut(X11(), args)))


if __name__ == '__main__':
    try:
        main()
    except NativeKeyError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
