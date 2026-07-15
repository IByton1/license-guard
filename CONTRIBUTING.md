# Contributing

Contributions are welcome, especially minimized fixtures for real-world npm lockfile and license
metadata edge cases.

1. Install Node.js 18.3 or newer and run `npm ci`.
2. Add tests for behavior changes.
3. Run `npm run check` before opening a pull request.
4. Keep runtime dependencies minimal and avoid network access in analysis code.

Bug reports should include the Node.js and npm versions, lockfile version, command, expected result,
and a sanitized reproduction. Do not attach proprietary dependency manifests without permission.
