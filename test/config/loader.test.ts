import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPolicyConfig, validatePolicyConfig } from "../../src/config/loader.js";
import { defaultPolicyConfig } from "../../src/config/types.js";
import { LicenseGuardError } from "../../src/errors.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "license-guard-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("validatePolicyConfig", () => {
  it("applies every default to an empty config", () => {
    expect(validatePolicyConfig({})).toEqual(defaultPolicyConfig);
  });

  it("validates a complete config and preserves package overrides", () => {
    const config = validatePolicyConfig({
      allow: ["MIT", "GPL-2.0-only WITH Classpath-exception-2.0"],
      deny: ["GPL-3.0-only"],
      overrides: {
        "@scope/package@1.2.3": "ignore",
        package: "ignore",
      },
      production: true,
      unknownLicense: "warn",
      unlistedLicense: "allow",
    });

    expect(config).toEqual({
      allow: ["MIT", "GPL-2.0-only WITH Classpath-exception-2.0"],
      deny: ["GPL-3.0-only"],
      overrides: {
        "@scope/package@1.2.3": "ignore",
        package: "ignore",
      },
      production: true,
      unknownLicense: "warn",
      unlistedLicense: "allow",
    });
  });

  it("rejects unknown fields", () => {
    expect(() => validatePolicyConfig({ unexpected: true })).toThrowError(
      /Unknown policy field: unexpected/,
    );
  });

  it.each([
    [null, /JSON object/],
    [{ allow: "MIT" }, /"allow" must be an array/],
    [{ deny: [1] }, /"deny\[0\]" must be a non-empty SPDX/],
    [{ production: "yes" }, /"production" must be a boolean/],
    [{ unknownLicense: "ignore" }, /"unknownLicense" must be one of/],
    [{ overrides: [] }, /"overrides" must be an object/],
    [{ overrides: { package: "allow" } }, /must use the action "ignore"/],
    [{ overrides: { "package@": "ignore" } }, /Invalid override key/],
    [{ overrides: { "package@*": "ignore" } }, /Invalid override key/],
  ])("rejects an invalid config %#", (input, message) => {
    expect(() => validatePolicyConfig(input)).toThrowError(message as RegExp);
  });

  it("rejects a correctable SPDX typo with a suggestion", () => {
    expect(() => validatePolicyConfig({ allow: ["Apache 2"] })).toThrowError(
      /Did you mean "Apache-2\.0"/,
    );
  });

  it.each([
    [" MIT ", "MIT"],
    ["GPL-3.0", "GPL-3.0-only"],
  ])("rejects the non-canonical SPDX value %j with a suggestion", (value, canonical) => {
    expect(() => validatePolicyConfig({ allow: [value] })).toThrowError(
      new RegExp(`Non-canonical SPDX license.*Did you mean "${canonical}"`),
    );
  });

  it("rejects uncorrectable SPDX values", () => {
    expect(() => validatePolicyConfig({ deny: ["not-a-license"] })).toThrowError(
      /Invalid SPDX license "not-a-license"/,
    );
  });

  it("rejects conjunctions in policy lists", () => {
    expect(() => validatePolicyConfig({ allow: ["MIT OR Apache-2.0"] })).toThrowError(
      /must contain one SPDX license/,
    );
  });

  it("reports allow and deny conflicts with a dedicated error code", () => {
    let thrown: unknown;
    try {
      validatePolicyConfig({ allow: ["MIT"], deny: ["MIT"] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LicenseGuardError);
    expect(thrown).toMatchObject({ code: "CONFIG_CONFLICT" });
  });

  it.each([
    [["MIT+"], ["MIT"]],
    [["GPL-3.0-or-later"], ["GPL-3.0-only"]],
    [["GPL-3.0-only"], ["GPL-3.0-or-later"]],
  ])("rejects semantically overlapping allow and deny rules", (allow, deny) => {
    expect(() => validatePolicyConfig({ allow, deny })).toThrowError(
      expect.objectContaining({ code: "CONFIG_CONFLICT" }),
    );
  });
});

describe("loadPolicyConfig", () => {
  it("loads .licenseguardrc.json from the project directory", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, ".licenseguardrc.json"),
      JSON.stringify({ allow: ["MIT"], production: true }),
      "utf8",
    );

    await expect(loadPolicyConfig(directory)).resolves.toMatchObject({
      allow: ["MIT"],
      production: true,
    });
  });

  it("resolves an explicit relative config path against the project", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "policy.json"),
      JSON.stringify({ deny: ["GPL-3.0-only"] }),
      "utf8",
    );

    await expect(loadPolicyConfig(directory, "policy.json")).resolves.toMatchObject({
      deny: ["GPL-3.0-only"],
    });
  });

  it("uses defaults when the conventional config file is absent", async () => {
    const directory = await temporaryDirectory();
    await expect(loadPolicyConfig(directory)).resolves.toEqual(defaultPolicyConfig);
  });

  it("reports a missing explicit config", async () => {
    const directory = await temporaryDirectory();
    await expect(loadPolicyConfig(directory, "missing.json")).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });

  it("reports invalid JSON", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, ".licenseguardrc.json"), "{", "utf8");

    await expect(loadPolicyConfig(directory)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("rejects config files above the input size limit", async () => {
    const directory = await temporaryDirectory();
    const configPath = join(directory, ".licenseguardrc.json");
    await writeFile(configPath, "{}");
    await truncate(configPath, 1024 * 1024 + 1);

    await expect(loadPolicyConfig(directory)).rejects.toThrow("1 MiB size limit");
  });
});
