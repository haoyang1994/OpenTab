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

For CI-like execution locally:

```bash
CI=true npm run test:ci
```

## Notes

- E2E test entry: `tests/extension.test.mjs`
- The test expects no console errors when loading `home.html` via extension URL.
