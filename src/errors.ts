export type LicenseGuardErrorCode =
  | "CONFIG_CONFLICT"
  | "CONFIG_INVALID"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_WRITE_FAILED"
  | "LOCKFILE_INVALID"
  | "LOCKFILE_NOT_FOUND"
  | "LOCKFILE_UNSUPPORTED"
  | "OUTPUT_WRITE_FAILED"
  | "USAGE_ERROR";

export class LicenseGuardError extends Error {
  readonly code: LicenseGuardErrorCode;

  constructor(code: LicenseGuardErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LicenseGuardError";
    this.code = code;
  }
}

export function errorMessage(error: unknown): string {
  return [...(error instanceof Error ? error.message : String(error))]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0xfffd;
      return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : character;
    })
    .join("");
}
