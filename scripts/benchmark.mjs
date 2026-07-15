import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { analyze } from "../dist/index.js";

const PACKAGE_COUNT = 1_500;
const MAX_DURATION_MS = 5_000;
const WRITE_CONCURRENCY = 64;
const LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "ISC"];
const MIT_LICENSE = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies
or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

async function mapConcurrent(values, transform) {
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await transform(values[index]);
    }
  }

  const workerCount = Math.min(WRITE_CONCURRENCY, values.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}

function packageRecord(index) {
  const suffix = String(index).padStart(4, "0");
  const name = index % 10 === 0 ? `@benchmark/package-${suffix}` : `benchmark-package-${suffix}`;
  const version = `1.${index % 50}.${index % 17}`;
  const license = LICENSES[index % LICENSES.length];
  const packagePath = `node_modules/${name}`;

  return {
    license,
    manifest: { license, name, version },
    packagePath,
    lockEntry: {
      ...(index % 5 === 0 ? { dev: true } : {}),
      license,
      ...(index % 17 === 0 ? { optional: true } : {}),
      version,
    },
  };
}

async function createFixture(projectPath) {
  const packages = Array.from({ length: PACKAGE_COUNT }, (_, index) => packageRecord(index));
  const rootEntry = {
    dependencies: {},
    devDependencies: {},
    name: "license-guard-benchmark",
    optionalDependencies: {},
    version: "1.0.0",
  };
  const lockPackages = {
    "": rootEntry,
  };

  for (const pkg of packages) {
    lockPackages[pkg.packagePath] = pkg.lockEntry;
    const dependencyGroup = pkg.lockEntry.dev
      ? rootEntry.devDependencies
      : pkg.lockEntry.optional
        ? rootEntry.optionalDependencies
        : rootEntry.dependencies;
    dependencyGroup[pkg.manifest.name] = pkg.manifest.version;
  }

  await writeFile(
    join(projectPath, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      name: "license-guard-benchmark",
      packages: lockPackages,
      requires: true,
      version: "1.0.0",
    }),
  );

  await mapConcurrent(packages, async (pkg) => {
    const packageDirectory = join(projectPath, ...pkg.packagePath.split("/"));
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify(pkg.manifest));
    if (pkg.license === "MIT") {
      await writeFile(join(packageDirectory, "LICENSE"), MIT_LICENSE);
    }
  });
}

const projectPath = await mkdtemp(join(tmpdir(), "license-guard-benchmark-"));

try {
  await createFixture(projectPath);

  const startedAt = performance.now();
  const result = await analyze({
    config: {
      allow: LICENSES,
      unknownLicense: "error",
      unlistedLicense: "error",
    },
    projectPath,
  });
  const durationMs = performance.now() - startedAt;

  if (
    result.packages.length !== PACKAGE_COUNT ||
    result.summary.allowed !== PACKAGE_COUNT ||
    !result.compliant
  ) {
    throw new Error(
      `Benchmark result is invalid: ${result.packages.length}/${PACKAGE_COUNT} packages analyzed, ${result.summary.allowed} allowed.`,
    );
  }
  if (durationMs >= MAX_DURATION_MS) {
    throw new Error(
      `Performance regression: ${PACKAGE_COUNT.toLocaleString("en-US")} packages took ${durationMs.toFixed(1)} ms; expected less than ${MAX_DURATION_MS.toLocaleString("en-US")} ms.`,
    );
  }

  console.log(
    `Analyzed ${PACKAGE_COUNT.toLocaleString("en-US")} installed packages in ${durationMs.toFixed(1)} ms (limit: <${MAX_DURATION_MS.toLocaleString("en-US")} ms).`,
  );
} finally {
  await rm(projectPath, { force: true, recursive: true });
}
