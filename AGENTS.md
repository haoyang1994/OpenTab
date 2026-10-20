# Agent Runbook

## Scope

This repo is a Chrome extension that overrides `chrome://newtab`.

## Validation Rule

After any code change, run:

```bash
npm test
```

If debugging is needed, run headed mode:

```bash
npm run test:e2e:headed
```

## CI Parity

CI runs the same command as local validation:

```bash
npm test
```

On Linux without `DISPLAY`, `npm test` wraps Chromium with `xvfb-run`. To force a visible browser (requires a display):

```bash
npm run test:e2e:headed
```

## Notes

- E2E test entry: `tests/extension.test.mjs`
- The test expects no console errors when loading `home.html` via extension URL.
