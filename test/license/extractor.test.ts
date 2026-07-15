import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractPackageLicense } from "../../src/license/extractor.js";
import type { PackageReference } from "../../src/lockfile/types.js";

const MIT_TEXT = `
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const ISC_TEXT = `
Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted.
THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES WHATSOEVER ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`;

const APACHE_TEXT = `
Apache License Version 2.0, January 2004
http://www.apache.org/licenses/
TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
1. Definitions.
`;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("extractPackageLicense", () => {
  it("evaluates conflicting declared and detected licenses conservatively", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "Apache 2.0" });
    await writeFile(path.join(packagePath, "LICENSE"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved).toMatchObject({
      declaredLicense: "Apache-2.0",
      detectedLicense: "MIT",
      finalLicense: "Apache-2.0 AND MIT",
      licenseSource: "combined",
    });
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });

  it.each([
    [{ license: { type: "ISC", url: "https://example.test/license" } }, "ISC"],
    [{ licenses: [{ type: "MIT" }, { type: "Apache 2.0" }] }, "MIT OR Apache-2.0"],
  ])("supports legacy manifest declarations", async (manifest, expected) => {
    const { projectPath } = await createPackage(manifest);
    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe(expected);
    expect(resolved.finalLicense).toBe(expected);
    expect(resolved.licenseSource).toBe("declared");
    expect(resolved.warnings).toEqual([]);
  });

  it("falls back to a LICENCE file when no declaration exists", async () => {
    const { packagePath, projectPath } = await createPackage({ name: "pkg" });
    await writeFile(path.join(packagePath, "LICENCE.txt"), ISC_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved).toMatchObject({
      declaredLicense: null,
      detectedLicense: "ISC",
      finalLicense: "ISC",
      licenseSource: "detected",
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("does not interpret UNLICENSED as the Unlicense", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "UNLICENSED" });
    await writeFile(path.join(packagePath, "COPYING"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe("LicenseRef-Unknown-License-Declaration");
    expect(resolved.detectedLicense).toBe("MIT");
    expect(resolved.finalLicense).toBe("LicenseRef-Unknown-License-Declaration AND MIT");
    expect(resolved.licenseSource).toBe("combined");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "DECLARED_LICENSE_INVALID" }),
      expect.objectContaining({ code: "LICENSE_MISMATCH" }),
    ]);
  });

  it.each([
    "GPL-3.0-only (embedded component)",
    "MIT OR GPL-3.0-only (embedded component)",
    "MIT/Commons-Clause",
  ])("does not discard an invalid primary declaration: %s", async (license) => {
    const { packagePath, projectPath } = await createPackage({ license });
    await writeFile(path.join(packagePath, "LICENSE"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe("LicenseRef-Unknown-License-Declaration");
    expect(resolved.detectedLicense).toBe("MIT");
    expect(resolved.finalLicense).toBe("LicenseRef-Unknown-License-Declaration AND MIT");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "DECLARED_LICENSE_INVALID" }),
      expect.objectContaining({ code: "LICENSE_MISMATCH" }),
    ]);
  });

  it("retains detected evidence but fails closed when the manifest is missing", async () => {
    const { packagePath, projectPath } = await createPackage(undefined);
    await writeFile(path.join(packagePath, "LICENSE.md"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("MIT");
    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.licenseSource).toBe("unknown");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "MANIFEST_MISSING" })]);
  });

  it("retains detected evidence but fails closed when the manifest contains invalid JSON", async () => {
    const { packagePath, projectPath } = await createPackage(undefined);
    await writeFile(path.join(packagePath, "package.json"), "{broken");
    await writeFile(path.join(packagePath, "LICENSE"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("MIT");
    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.licenseSource).toBe("unknown");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "MANIFEST_INVALID" })]);
  });

  it("does not trust license data when the installed manifest differs from the lockfile", async () => {
    const { projectPath } = await createPackage({
      name: "different",
      version: "9.9.9",
      license: "MIT",
    });

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.licenseSource).toBe("unknown");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "MANIFEST_MISMATCH" })]);
  });

  it("combines conflicting current and legacy manifest declarations", async () => {
    const { projectPath } = await createPackage({
      license: "MIT",
      licenses: [{ type: "GPL-3.0-only" }],
    });

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe("MIT AND GPL-3.0-only");
    expect(resolved.finalLicense).toBe("MIT AND GPL-3.0-only");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "DECLARED_LICENSE_CONFLICT" }),
    ]);
  });

  it("does not report a conflict for equivalent current and legacy declarations", async () => {
    const { projectPath } = await createPackage({
      license: "MIT",
      licenses: [{ type: "MIT" }],
    });

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe("MIT");
    expect(resolved.warnings).toEqual([]);
  });

  it("retains valid legacy terms when another legacy declaration is invalid", async () => {
    const { projectPath } = await createPackage({
      license: "MIT",
      licenses: [{ type: "GPL-3.0-only" }, { type: "malformed proprietary grant" }],
    });

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe(
      "MIT AND (GPL-3.0-only OR LicenseRef-Unknown-License-Declaration)",
    );
    expect(resolved.finalLicense).toBe(
      "MIT AND (GPL-3.0-only OR LicenseRef-Unknown-License-Declaration)",
    );
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "DECLARED_LICENSE_INVALID" }),
      expect.objectContaining({ code: "DECLARED_LICENSE_CONFLICT" }),
    ]);
  });

  it("does not follow installed package symlinks outside the project", async () => {
    const projectPath = await createTemporaryDirectory();
    const outsidePath = await createTemporaryDirectory();
    await mkdir(path.join(projectPath, "node_modules"), { recursive: true });
    await writeFile(
      path.join(outsidePath, "package.json"),
      JSON.stringify({ name: "pkg", version: "1.2.3", license: "MIT" }),
    );
    await symlink(
      outsidePath,
      path.join(projectPath, "node_modules", "pkg"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.warnings[0]?.code).toBe("PACKAGE_OUTSIDE_PROJECT");
  });

  it("returns UNKNOWN and a warning when the installed package is missing", async () => {
    const projectPath = await createTemporaryDirectory();
    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved).toMatchObject({
      declaredLicense: null,
      detectedLicense: null,
      finalLicense: "UNKNOWN",
      licenseSource: "unknown",
    });
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "PACKAGE_MISSING" })]);
  });

  it.each([
    "../outside",
    "/tmp/outside",
    "C:\\outside",
    "node_modules/../../outside",
  ])("rejects unsafe package path %s", async (referencePath) => {
    const projectPath = await createTemporaryDirectory();
    const resolved = await extractPackageLicense(projectPath, reference({ path: referencePath }));

    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.warnings[0]?.code).toBe("PACKAGE_MISSING");
  });

  it("accepts lockfile paths with Windows separators", async () => {
    const { projectPath } = await createPackage({ license: "MIT" });
    const resolved = await extractPackageLicense(
      projectPath,
      reference({ path: "node_modules\\pkg" }),
    );

    expect(resolved.finalLicense).toBe("MIT");
  });

  it("does not guess when multiple license files disagree", async () => {
    const { packagePath, projectPath } = await createPackage({});
    await writeFile(path.join(packagePath, "LICENSE-MIT"), MIT_TEXT);
    await writeFile(path.join(packagePath, "LICENSE-ISC"), ISC_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("ISC AND LicenseRef-Unknown-License-Evidence AND MIT");
    expect(resolved.finalLicense).toBe("ISC AND LicenseRef-Unknown-License-Evidence AND MIT");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "LICENSE_EVIDENCE_AMBIGUOUS" }),
    ]);
  });

  it("does not accept one recognized file when another license file is unknown", async () => {
    const { packagePath, projectPath } = await createPackage({});
    await writeFile(path.join(packagePath, "LICENSE-MIT"), MIT_TEXT);
    await writeFile(
      path.join(packagePath, "LICENSE-OTHER"),
      "GNU GENERAL PUBLIC LICENSE Version 1, February 1989",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("LicenseRef-Unknown-License-Evidence AND MIT");
    expect(resolved.finalLicense).toBe("LicenseRef-Unknown-License-Evidence AND MIT");
    expect(resolved.warnings[0]?.code).toBe("LICENSE_EVIDENCE_AMBIGUOUS");
  });

  it("keeps unclassifiable license-file evidence beside a valid declaration", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "BlueOak-1.0.0" });
    await writeFile(path.join(packagePath, "LICENSE"), "Blue Oak Model License text");

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("LicenseRef-Unknown-License-Evidence");
    expect(resolved.finalLicense).toBe("BlueOak-1.0.0 AND LicenseRef-Unknown-License-Evidence");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "LICENSE_EVIDENCE_AMBIGUOUS" }),
      expect.objectContaining({ code: "LICENSE_MISMATCH" }),
    ]);
  });

  it("does not discard a restrictive unclassifiable license file", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "MIT" });
    await writeFile(path.join(packagePath, "LICENSE"), MIT_TEXT);
    await writeFile(
      path.join(packagePath, "LICENSE-COMMERCIAL"),
      "All rights reserved. Commercial use requires a written contract signed by Acme.",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("LicenseRef-Unknown-License-Evidence AND MIT");
    expect(resolved.finalLicense).toBe("MIT AND LicenseRef-Unknown-License-Evidence");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "LICENSE_EVIDENCE_AMBIGUOUS" }),
      expect.objectContaining({ code: "LICENSE_MISMATCH" }),
    ]);
  });

  it("does not report a mismatch when detection matches one declared alternative", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "MIT OR Apache-2.0" });
    await writeFile(path.join(packagePath, "LICENSE"), MIT_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.finalLicense).toBe("MIT OR Apache-2.0");
    expect(resolved.warnings).toEqual([]);
  });

  it("keeps declared OR semantics when a bundled file contains every declared alternative", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "MIT OR Apache-2.0" });
    await writeFile(path.join(packagePath, "LICENSE"), `${APACHE_TEXT}\n${MIT_TEXT}`);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("Apache-2.0 AND MIT");
    expect(resolved.finalLicense).toBe("MIT OR Apache-2.0");
    expect(resolved.licenseSource).toBe("declared");
    expect(resolved.warnings).toEqual([]);
  });

  it("adds only licenses absent from the declaration", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "MIT" });
    await writeFile(path.join(packagePath, "LICENSE"), `${MIT_TEXT}\n${ISC_TEXT}`);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("ISC AND MIT");
    expect(resolved.finalLicense).toBe("MIT AND ISC");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });

  it("retains a detected base license beside a declared exception", async () => {
    const { packagePath, projectPath } = await createPackage({
      license: "GPL-2.0-only WITH Classpath-exception-2.0",
    });
    await writeFile(
      path.join(packagePath, "LICENSE"),
      "GNU GENERAL PUBLIC LICENSE Version 2, June 1991\nEveryone is permitted to copy and distribute verbatim copies of this license document.",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.finalLicense).toBe(
      "GPL-2.0-only WITH Classpath-exception-2.0 AND GPL-2.0-only",
    );
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });

  it("keeps a naked declaration when detected evidence adds an exception", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "GPL-2.0-only" });
    await writeFile(
      path.join(packagePath, "LICENSE"),
      "SPDX-License-Identifier: GPL-2.0-only WITH Classpath-exception-2.0",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.finalLicense).toBe("GPL-2.0-only");
    expect(resolved.warnings).toEqual([]);
  });

  it("preserves a stricter explicit SPDX expression from license evidence", async () => {
    const { packagePath, projectPath } = await createPackage({
      license: "MIT OR GPL-3.0-only",
    });
    await writeFile(
      path.join(packagePath, "LICENSE"),
      "SPDX-License-Identifier: MIT\nSPDX-License-Identifier: GPL-3.0-only",
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("GPL-3.0-only AND MIT");
    expect(resolved.finalLicense).toBe("(MIT OR GPL-3.0-only) AND GPL-3.0-only AND MIT");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });

  it("does not discard additional evidence when a combined expression exceeds safety limits", async () => {
    const declaration = Array.from({ length: 65 }, () => "MIT").join(" OR ");
    const { packagePath, projectPath } = await createPackage({ license: declaration });
    await writeFile(path.join(packagePath, "LICENSE"), ISC_TEXT);

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.declaredLicense).toBe(declaration);
    expect(resolved.detectedLicense).toBe("ISC");
    expect(resolved.finalLicense).toBe("UNKNOWN");
    expect(resolved.licenseSource).toBe("unknown");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });

  it("evaluates a restrictive supplement in a permissively declared package", async () => {
    const { packagePath, projectPath } = await createPackage({ license: "MIT" });
    await writeFile(
      path.join(packagePath, "LICENSE"),
      `${MIT_TEXT}\nCommons Clause License Condition v1.0\nYou may not Sell the Software.`,
    );

    const resolved = await extractPackageLicense(projectPath, reference());

    expect(resolved.detectedLicense).toBe("LicenseRef-Unknown-Restriction AND MIT");
    expect(resolved.finalLicense).toBe("MIT AND LicenseRef-Unknown-Restriction");
    expect(resolved.licenseSource).toBe("combined");
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: "LICENSE_MISMATCH" })]);
  });
});

function reference(overrides: Partial<PackageReference> = {}): PackageReference {
  return {
    dev: false,
    name: "pkg",
    optional: false,
    path: "node_modules/pkg",
    version: "1.2.3",
    ...overrides,
  };
}

async function createPackage(manifest: Record<string, unknown> | undefined): Promise<{
  packagePath: string;
  projectPath: string;
}> {
  const projectPath = await createTemporaryDirectory();
  const packagePath = path.join(projectPath, "node_modules", "pkg");
  await mkdir(packagePath, { recursive: true });
  if (manifest !== undefined) {
    await writeFile(
      path.join(packagePath, "package.json"),
      JSON.stringify({ name: "pkg", version: "1.2.3", ...manifest }),
    );
  }
  return { packagePath, projectPath };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "license-guard-"));
  temporaryDirectories.push(directory);
  return directory;
}
