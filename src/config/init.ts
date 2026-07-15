import { isAbsolute, resolve } from "node:path";
import { errorMessage, LicenseGuardError } from "../errors.js";
import { writeTextFile } from "../utils/write.js";

const exampleConfig = {
  allow: ["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT"],
  deny: ["AGPL-3.0-only", "AGPL-3.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later"],
  unknownLicense: "error",
  unlistedLicense: "warn",
  overrides: {},
  production: false,
};

export async function initializeConfig(
  projectPath: string,
  configPath = ".licenseguardrc.json",
  force = false,
): Promise<string> {
  const externalDestination = isAbsolute(configPath);
  const destination = externalDestination ? configPath : resolve(projectPath, configPath);
  try {
    await writeTextFile(destination, `${JSON.stringify(exampleConfig, null, 2)}\n`, {
      ...(externalDestination ? {} : { containmentRoot: projectPath }),
      overwrite: force,
    });
    return destination;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "EEXIST") {
      throw new LicenseGuardError(
        "CONFIG_WRITE_FAILED",
        `Config already exists at ${destination}. Use --force to overwrite it.`,
        error,
      );
    }
    throw new LicenseGuardError(
      "CONFIG_WRITE_FAILED",
      `Could not write config at ${destination}: ${errorMessage(error)}`,
      error,
    );
  }
}
