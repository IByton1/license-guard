# license-guard

Offline license compliance checks for complete npm dependency installations.

`license-guard` reads npm lockfiles and installed package metadata, normalizes SPDX license
expressions, evaluates a project policy, and produces deterministic reports for people and CI.
Runtime analysis never contacts a registry or another network service.

> **Legal notice:** This tool provides technical information about package licenses. It does not
> provide legal advice or a warranty of license compliance. Consult qualified legal counsel for
> binding conclusions.

## Status

Version 0.1 supports npm `package-lock.json` lockfile versions 2 and 3. pnpm, Yarn, npm workspaces,
and linked local packages are intentionally rejected until they can be handled without incomplete
results. The lockfile root and reachable dependency edges are validated before analysis; dev and
optional status are derived from root-graph reachability instead of trusting package flags.

## Installation

Run without a global installation:

```sh
npx license-guard init
npx license-guard
```

Or install it as a development dependency:

```sh
npm install --save-dev @ibyton/license-guard
```

The project must already be installed with npm because license evidence is read from
`node_modules`.

## Configuration

`license-guard init` creates `.licenseguardrc.json` without overwriting an existing file. A typical
policy looks like this:

```json
{
  "allow": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"],
  "deny": ["GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0-only"],
  "unknownLicense": "error",
  "unlistedLicense": "warn",
  "overrides": {
    "documented-internal-package@1.2.3": "ignore"
  },
  "production": true
}
```

| Field | Meaning | Default |
| --- | --- | --- |
| `allow` | Canonical SPDX licenses accepted by the policy | `[]` |
| `deny` | Canonical SPDX licenses rejected by the policy | `[]` |
| `unknownLicense` | Behavior for undetectable licenses: `allow`, `warn`, or `error` | `error` |
| `unlistedLicense` | Behavior for licenses in neither list | `warn` |
| `overrides` | Package or exact `name@version` exceptions; value must be `ignore` | `{}` |
| `production` | Exclude packages reachable only through root `devDependencies` | `false` |

Config keys and values are validated strictly. Non-canonical but recognizable SPDX values fail
with a canonical suggestion. Semantically overlapping current and `or-later` licenses cannot be
split across `allow` and `deny`.

If no default config exists, the defaults above are used. Passing an explicit missing `--config`
path is an error.

### Compound SPDX expressions

- `MIT OR GPL-3.0-only` is accepted when at least one branch is allowed.
- `MIT AND GPL-3.0-only` is accepted only when every branch is allowed.
- A warning branch keeps an `AND` expression at warning status. An `OR` expression becomes a
  warning only when it has no allowed branch but at least one warning branch.
- SPDX exceptions introduced with `WITH` are evaluated as one license term. An exact term in the
  policy takes precedence over its base license.

## CLI

```text
license-guard [options]
license-guard init [--force] [--config <path>]
```

Common examples:

```sh
license-guard
license-guard --production
license-guard --summary
license-guard --json > license-report.json
license-guard --csv --output reports/licenses.csv
license-guard --html --output reports/licenses.html
license-guard --cwd packages/service --config ../../policy.json
```

Reports go to stdout unless `--output` is supplied. Diagnostics go to stderr, so redirected JSON
and CSV remain valid.

Exit codes are stable API:

- `0`: analysis completed without a policy violation
- `1`: one or more packages violated the policy
- `2`: usage, configuration, lockfile, or filesystem error

The JSON report includes `schemaVersion: "1"`. Changes that break its documented structure or the
exit-code contract require a major release.

### JSON schema version 1

`--summary` omits `packages`; every other field remains present.

```ts
interface LicenseGuardReportV1 {
  schemaVersion: "1";
  project: string;
  lockfile: string;
  lockfileVersion: 2 | 3;
  production: boolean;
  compliant: boolean;
  legalNotice: string;
  summary: {
    allowed: number;
    denied: number;
    ignored: number;
    licenses: Array<{ license: string; count: number }>;
    packages: number;
    unknown: number;
    warnings: number;
  };
  warnings: Array<{
    code: string;
    message: string;
    package?: string;
    path?: string;
  }>;
  packages?: Array<{
    name: string;
    version: string;
    path: string;
    dev: boolean;
    optional: boolean;
    declaredLicense: string | null;
    detectedLicense: string | null;
    license: string;
    licenseSource: "declared" | "detected" | "combined" | "unknown";
    status: "allowed" | "denied" | "ignored" | "warning";
    reason: string;
    warnings: Array<{ code: string; message: string }>;
  }>;
}
```

## Programmatic API

```ts
import { analyze } from "@ibyton/license-guard";

const result = await analyze({
  projectPath: process.cwd(),
  production: true,
});

if (!result.compliant) {
  for (const pkg of result.packages.filter((entry) => entry.policy.status === "denied")) {
    console.error(`${pkg.name}@${pkg.version}: ${pkg.finalLicense}`);
  }
}
```

`analyze()` never writes to stdout or stderr and never changes `process.exitCode`.
`normalizeSpdx()` is also exported for canonicalizing a single declaration. Analysis failures throw
`LicenseGuardError`, whose stable `code` property can be handled without parsing message text. The
result, policy, warning, and error-code TypeScript types are exported from the package root.

## License evidence

The package `license` field is preferred and supports current strings, legacy `{ "type": "..." }`
objects, and deprecated `licenses` arrays. When the declaration is absent or cannot be normalized,
high-confidence patterns are checked in top-level `LICENSE`, `LICENCE`, and `COPYING` files. An
invalid declaration remains visible as a custom `LicenseRef` and is combined with detected evidence;
it is never discarded in favor of a permissive file match. Missing, malformed, or
identity-mismatched manifests always produce an `UNKNOWN` result, while any detected evidence
remains visible in the report. Ambiguous file evidence is retained as a custom `LicenseRef` even
when a valid declaration exists. Unknown additions to permissive license text follow the same
fail-closed rule. When detected evidence introduces a license or stricter explicit expression absent
from a valid declaration, the additional evidence is evaluated as a conservative `AND` requirement.

## CI

```yaml
- run: npm ci
- run: npx license-guard --production --json --output license-report.json
```

The repository workflow tests the required Node.js 18.3, 20, and 22 compatibility baselines on
Linux, macOS, and Windows, with additional Linux checks for Node.js 24 and 26. It builds both ESM
and CommonJS entry points, scans its own runtime dependencies, and installs the packed tarball in
isolated ESM and CommonJS consumers.

## Development

```sh
npm ci
npm run check
npm run benchmark
```

The runtime has three direct dependencies. TypeScript runs in strict mode, core modules have an
80% coverage gate, and release contents are checked through `npm pack`.

## Security and trust

Runtime scans are local and offline. Publish releases from CI with npm trusted publishing and
provenance enabled. Report false negatives or other security-sensitive issues privately according
to [SECURITY.md](SECURITY.md).

Configure `IByton1/license-guard`, `.github/workflows/release.yml`, and the `npm` GitHub environment
as the package's trusted publisher on npm. The release workflow then publishes non-prerelease
GitHub releases without a long-lived npm token.

## License

MIT
