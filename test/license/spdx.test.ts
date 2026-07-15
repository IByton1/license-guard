import { describe, expect, it } from "vitest";
import {
  formatSpdxExpression,
  normalizeSpdx,
  parseSpdxExpression,
} from "../../src/license/spdx.js";

describe("normalizeSpdx", () => {
  it.each([
    ["MIT", "MIT"],
    [" mit ", "MIT"],
    ["Apache 2.0", "Apache-2.0"],
    ["ISC License", "ISC"],
    ["Creative Commons Zero v1.0 Universal", "CC0-1.0"],
    ["The Unlicense", "Unlicense"],
    ["GPL-3.0", "GPL-3.0-only"],
    ["GPL-2.0-with-classpath-exception", "GPL-2.0-only WITH Classpath-exception-2.0"],
    ["BSD-2-Clause-NetBSD", "BSD-2-Clause"],
    ["BSD-2-Clause-FreeBSD+", "BSD-2-Clause-Views+"],
    ["GPL-2.0-with-classpath-exception+", "GPL-2.0-or-later WITH Classpath-exception-2.0"],
    ["eCos-2.0+", "GPL-2.0-or-later WITH eCos-exception-2.0"],
    ["wxWindows+", "GPL-2.0-or-later WITH WxWindows-exception-3.1"],
    ["GPL-3.0-only+", "GPL-3.0-or-later"],
    ["GPL-3.0-or-later+", "GPL-3.0-or-later"],
    ["gpl-3.0-or-later", "GPL-3.0-or-later"],
    ["GFDL-1.3-OR-LATER", "GFDL-1.3-or-later"],
    ["GPLv2+", "GPL-2.0-or-later"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeSpdx(raw)).toBe(expected);
  });

  it("canonicalizes operators and necessary parentheses", () => {
    expect(normalizeSpdx("(MIT or Apache-2.0) and ISC")).toBe("(MIT OR Apache-2.0) AND ISC");
    expect(normalizeSpdx("MIT OR Apache-2.0 AND ISC")).toBe("MIT OR Apache-2.0 AND ISC");
  });

  it("corrects identifiers within compound expressions", () => {
    expect(normalizeSpdx("mit OR (Apache 2.0 AND ISC License)")).toBe("MIT OR Apache-2.0 AND ISC");
    expect(normalizeSpdx("Apache 2 OR GPL-3.0-or-later")).toBe("Apache-2.0 OR GPL-3.0-or-later");
    expect(normalizeSpdx("mit AND GPL-2.0-or-later")).toBe("MIT AND GPL-2.0-or-later");
    expect(normalizeSpdx("MIT AND GPL v2 or later")).toBe("MIT AND GPL-2.0-or-later");
  });

  it("preserves valid exceptions and plus suffixes", () => {
    expect(normalizeSpdx("GPL-2.0+ WITH Classpath-exception-2.0")).toBe(
      "GPL-2.0-or-later WITH Classpath-exception-2.0",
    );
  });

  it.each([
    "",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.md",
    "Public Domain",
    "MIT OR",
  ])("rejects %s", (raw) => {
    expect(normalizeSpdx(raw)).toBeNull();
  });

  it.each([
    "BSD",
    "Apache",
    "MIT/Commons-Clause",
    "MIT/OSL-3.0",
    "MIT, Apache-2.0",
  ])("rejects ambiguous declaration %s without discarding terms", (raw) => {
    expect(normalizeSpdx(raw)).toBeNull();
  });

  it("rejects expressions too deep for safe policy evaluation", () => {
    expect(normalizeSpdx(Array.from({ length: 100 }, () => "MIT").join(" OR "))).toBeNull();
  });

  it("does not count or-later suffixes as compound operators", () => {
    const expression = Array.from({ length: 65 }, () => "GPL-3.0-or-later").join(" AND ");
    expect(normalizeSpdx(expression)).toBe(expression);
  });

  it("counts compound operators adjacent to parentheses", () => {
    const terms = Array.from({ length: 65 }, () => "MIT");
    expect(normalizeSpdx(`(${terms.join(")AND(")})`)).toBe(terms.join(" AND "));
    expect(normalizeSpdx(`(${[...terms, "MIT"].join(")AND(")})`)).toBeNull();
  });
});

describe("parseSpdxExpression", () => {
  it("returns a traversable expression tree", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0 AND ISC")).toEqual({
      conjunction: "or",
      left: { license: "MIT" },
      right: {
        conjunction: "and",
        left: { license: "Apache-2.0" },
        right: { license: "ISC" },
      },
    });
  });

  it("is strict and does not apply corrections", () => {
    expect(parseSpdxExpression("Apache 2")).toBeNull();
    expect(parseSpdxExpression("  ")).toBeNull();
  });

  it("formats explicit AST nodes", () => {
    expect(
      formatSpdxExpression({
        conjunction: "and",
        left: {
          conjunction: "or",
          left: { license: "MIT" },
          right: { license: "ISC" },
        },
        right: { exception: "Classpath-exception-2.0", license: "GPL-2.0", plus: true },
      }),
    ).toBe("(MIT OR ISC) AND GPL-2.0-or-later WITH Classpath-exception-2.0");
  });
});
