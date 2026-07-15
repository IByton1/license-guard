import parse from "spdx-expression-parse";
import { correctLicenseIdentifier } from "./corrections.js";

const MAX_EXPRESSION_LENGTH = 4096;
const MAX_EXPRESSION_OPERATORS = 64;

const DEPRECATED_GNU_LICENSES: Readonly<Record<string, { only: string; orLater: string }>> = {
  "AGPL-1.0": { only: "AGPL-1.0-only", orLater: "AGPL-1.0-or-later" },
  "AGPL-3.0": { only: "AGPL-3.0-only", orLater: "AGPL-3.0-or-later" },
  "GFDL-1.1": { only: "GFDL-1.1-only", orLater: "GFDL-1.1-or-later" },
  "GFDL-1.2": { only: "GFDL-1.2-only", orLater: "GFDL-1.2-or-later" },
  "GFDL-1.3": { only: "GFDL-1.3-only", orLater: "GFDL-1.3-or-later" },
  "GPL-1.0": { only: "GPL-1.0-only", orLater: "GPL-1.0-or-later" },
  "GPL-2.0": { only: "GPL-2.0-only", orLater: "GPL-2.0-or-later" },
  "GPL-3.0": { only: "GPL-3.0-only", orLater: "GPL-3.0-or-later" },
  "LGPL-2.0": { only: "LGPL-2.0-only", orLater: "LGPL-2.0-or-later" },
  "LGPL-2.1": { only: "LGPL-2.1-only", orLater: "LGPL-2.1-or-later" },
  "LGPL-3.0": { only: "LGPL-3.0-only", orLater: "LGPL-3.0-or-later" },
};

const DEPRECATED_LICENSE_REPLACEMENTS: Readonly<Record<string, string>> = {
  "BSD-2-Clause-FreeBSD": "BSD-2-Clause-Views",
  "BSD-2-Clause-NetBSD": "BSD-2-Clause",
  "GPL-2.0-with-GCC-exception": "GPL-2.0-only WITH GCC-exception-2.0",
  "GPL-2.0-with-autoconf-exception": "GPL-2.0-only WITH Autoconf-exception-2.0",
  "GPL-2.0-with-bison-exception": "GPL-2.0-only WITH Bison-exception-2.2",
  "GPL-2.0-with-classpath-exception": "GPL-2.0-only WITH Classpath-exception-2.0",
  "GPL-2.0-with-font-exception": "GPL-2.0-only WITH Font-exception-2.0",
  "GPL-3.0-with-GCC-exception": "GPL-3.0-only WITH GCC-exception-3.1",
  "GPL-3.0-with-autoconf-exception": "GPL-3.0-only WITH Autoconf-exception-3.0",
  "StandardML-NJ": "SMLNJ",
  "bzip2-1.0.5": "bzip2-1.0.6",
  "eCos-2.0": "GPL-2.0-or-later WITH eCos-exception-2.0",
  wxWindows: "GPL-2.0-or-later WITH WxWindows-exception-3.1",
};

export interface SpdxLicenseNode {
  exception?: string;
  license: string;
  plus?: true;
}

export interface SpdxConjunctionNode {
  conjunction: "and" | "or";
  left: SpdxExpression;
  right: SpdxExpression;
}

export type SpdxExpression = SpdxLicenseNode | SpdxConjunctionNode;

export function parseSpdxExpression(raw: string): SpdxExpression | null {
  const value = raw.trim();
  const operatorCount = countCompoundOperators(value);
  if (
    value.length === 0 ||
    value.length > MAX_EXPRESSION_LENGTH ||
    operatorCount > MAX_EXPRESSION_OPERATORS
  ) {
    return null;
  }

  try {
    return parse(value) as SpdxExpression;
  } catch {
    return null;
  }
}

export function normalizeSpdx(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }

  const parsed = parseSpdxExpression(value);
  if (parsed !== null) {
    const formatted = formatSpdxExpression(parsed);
    return parseSpdxExpression(formatted) === null ? null : formatted;
  }

  if (looksLikeCompoundExpression(value)) {
    const correctedExpression = correctCompoundExpression(value);
    const corrected =
      correctedExpression === null ? null : parseSpdxExpression(correctedExpression);
    return corrected === null ? null : formatSpdxExpression(corrected);
  }

  const correctedIdentifier = correctLicenseIdentifier(value);
  if (correctedIdentifier !== null) {
    const corrected = parseSpdxExpression(correctedIdentifier);
    if (corrected !== null) {
      return formatSpdxExpression(corrected);
    }
  }

  const correctedExpression = correctCompoundExpression(value);
  const corrected = correctedExpression === null ? null : parseSpdxExpression(correctedExpression);
  return corrected === null ? null : formatSpdxExpression(corrected);
}

function looksLikeCompoundExpression(value: string): boolean {
  return countCompoundOperators(value) > 0;
}

function countCompoundOperators(value: string): number {
  const operators = value.match(
    /(?:^|[\s()])(?:AND|OR)(?!\s+(?:any\s+)?(?:later|newer)\b)(?=$|[\s()])/gi,
  );
  return operators?.length ?? 0;
}

export function formatSpdxExpression(expression: SpdxExpression): string {
  return formatNode(expression, 0);
}

function correctCompoundExpression(value: string): string | null {
  const tokens = value.split(
    /(\(|\)|\s+\bAND\b\s+|\s+\bOR\b(?!\s+(?:any\s+)?(?:later|newer)\b)\s+)/gi,
  );
  if (!tokens.some((token) => /^(?:AND|OR)$/i.test(token.trim()))) {
    return null;
  }

  const corrected: string[] = [];
  for (const token of tokens) {
    const part = token.trim();
    if (part.length === 0) {
      continue;
    }
    if (part === "(" || part === ")") {
      corrected.push(part);
      continue;
    }
    if (/^(?:AND|OR)$/i.test(part)) {
      corrected.push(part.toUpperCase());
      continue;
    }

    const withParts = part.split(/\s+WITH\s+/i);
    if (withParts.length > 2) {
      return null;
    }

    const license = correctLicenseIdentifier(withParts[0] ?? "");
    if (license === null) {
      return null;
    }

    const exception = withParts[1]?.trim();
    corrected.push(exception === undefined ? license : `${license} WITH ${exception}`);
  }

  return corrected.join(" ");
}

function formatNode(expression: SpdxExpression, parentPrecedence: number): string {
  if (!("conjunction" in expression)) {
    const directReplacement = DEPRECATED_LICENSE_REPLACEMENTS[expression.license];
    if (directReplacement !== undefined) {
      return formatDirectReplacement(directReplacement, expression);
    }
    const replacement = DEPRECATED_GNU_LICENSES[expression.license];
    const license =
      replacement === undefined
        ? expression.license
        : expression.plus === true
          ? replacement.orLater
          : replacement.only;
    const modernOrLater =
      expression.plus === true && license.endsWith("-only")
        ? `${license.slice(0, -"-only".length)}-or-later`
        : license;
    const suffix =
      expression.plus === true &&
      replacement === undefined &&
      !license.endsWith("-only") &&
      !license.endsWith("-or-later")
        ? "+"
        : "";
    const exception = expression.exception === undefined ? "" : ` WITH ${expression.exception}`;
    return `${modernOrLater}${suffix}${exception}`;
  }

  const precedence = expression.conjunction === "and" ? 2 : 1;
  const operator = expression.conjunction.toUpperCase();
  const value = `${formatNode(expression.left, precedence)} ${operator} ${formatNode(
    expression.right,
    precedence,
  )}`;
  return precedence < parentPrecedence ? `(${value})` : value;
}

function formatDirectReplacement(replacement: string, expression: SpdxLicenseNode): string {
  const withIndex = replacement.indexOf(" WITH ");
  const base = withIndex === -1 ? replacement : replacement.slice(0, withIndex);
  const replacementException = withIndex === -1 ? "" : replacement.slice(withIndex);
  const modifiedBase =
    expression.plus === true
      ? base.endsWith("-only")
        ? `${base.slice(0, -"-only".length)}-or-later`
        : base.endsWith("-or-later")
          ? base
          : `${base}+`
      : base;
  const extraException = expression.exception === undefined ? "" : ` WITH ${expression.exception}`;
  return `${modifiedBase}${replacementException}${extraException}`;
}
