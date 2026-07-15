# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-07-15

### Fixed

- License text heuristics no longer flag common permissive-license header variants
  (`(The MIT License)`, `The MIT License (MIT)`) or a standalone `All rights reserved.`
  line as an unknown restriction, which previously caused false `DENIED` results for
  many widely-used MIT/BSD packages (e.g. `express`, `body-parser`, `qs`).

## [0.1.0] - 2026-07-15

### Added

- npm `package-lock.json` v2 and v3 analysis, including transitive dependencies.
- SPDX normalization and compound `AND`/`OR` policy evaluation.
- Package manifest and high-confidence license text detection.
- Allow, deny, unknown, unlisted, and package override policy controls.
- Terminal, JSON, CSV, HTML, and summary reports.
- Programmatic `analyze()` API and CI-oriented exit codes.
