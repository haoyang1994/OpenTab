# Contributing to OpenTab

Thanks for helping improve OpenTab. This document is the process we follow for local development and pull requests.

## Development environment

- Node.js 20 (matches CI)
- npm (use the lockfile; prefer `npm ci`)
- Chromium via Playwright for E2E tests
- On Linux without a display, install `xvfb` so headed Playwright can run under a virtual framebuffer

```bash
npm ci
npm run pw:install
npm test
```

On Linux with no `DISPLAY`, `npm test` wraps headed Chromium with `xvfb` (install the `xvfb` package). You do not need to wrap the command again.

`npm run test:ci` is a compatible alias for the E2E script only.

`npm test` runs repository hygiene checks, then the Playwright E2E suite.

Loading the unpacked extension does **not** require `npm install`. Calendar and terminal assets are committed under `vendor/` with their LICENSE files. `npm ci` is still required to run tests or the SSH gateway.

## Branch and pull request process

1. Fork the repository (or create a branch from the latest `master`).
2. Create a focused branch for one change.
3. Keep each pull request to **one** concern (one bug, one feature, or one chore).
4. Run `npm test` and make sure it passes before you open or update the PR.
5. Fill in `.github/PULL_REQUEST_TEMPLATE.md`.
6. Wait for the `CI` workflow to go green.

Do not mix license/docs-only work with product behavior changes unless the two are inseparable.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(optional-scope): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `test`, `ci`, `refactor`.

Examples:

- `fix: hide AM/PM in 24-hour clock mode`
- `docs: add privacy section to README`
- `chore: update NOTICE for a new dependency`

## Code style

- OpenTab is **vanilla HTML, CSS, and JavaScript**. Do not introduce a frontend framework, bundler, or transpiler unless there is a dedicated, agreed design change.
- Keep changes local to the files that need them. Do not reformat unrelated code.
- Match the surrounding style: 2-space indent, existing naming, and existing chrome.storage keys.
- New UI should degrade safely when Bing wallpaper or weather requests fail.

## Permissions and network access

Any pull request that adds or widens:

- `permissions`
- `host_permissions`
- `content_security_policy`
- runtime requests to a new origin

must explain **why** the extra access is required, what data is sent, and why a narrower alternative is not enough. The default is to add nothing.

## Third-party dependencies and assets

- Only accept licenses that are compatible with Apache-2.0 (no GPL / AGPL / LGPL copyleft).
- Update `NOTICE` in the same PR: name, version, purpose, license, and upstream URL.
- Do not add binary assets without provenance (author, source URL, license).
- Pexels photos and third-party trademarks are **not** Apache-2.0; do not relicense them.

## License of contributions

By submitting a contribution, you agree that it is licensed under the Apache License 2.0, inbound = outbound, as described in Apache-2.0 section 5. OpenTab does **not** require a Contributor License Agreement (CLA).

## 中文摘要

- 开发环境：Node 20，`npm ci`，`npm run pw:install`；Linux 无显示器时 `npm test` 会自动用 xvfb（需已安装 `xvfb`）。
- 每个 PR 只做一件事，合并前必须 `npm test` 通过。
- 提交信息遵循 Conventional Commits。
- 保持原生 JS，不引入前端框架。
- 新增权限、host 或外部请求必须在 PR 中说明理由。
- 新增依赖或素材必须同步更新 `NOTICE`，且许可证须与 Apache-2.0 兼容。
- 贡献按 Apache-2.0 第 5 条 inbound=outbound 授权，无需签署 CLA。
