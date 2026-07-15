import { correctLicenseIdentifier } from "./corrections.js";
import { normalizeSpdx } from "./spdx.js";

const SIMPLE_PERMISSIVE_LICENSES = new Set([
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-4-Clause",
  "ISC",
  "MIT",
]);

const PERMISSIVE_LICENSES = new Set([
  ...SIMPLE_PERMISSIVE_LICENSES,
  "Apache-2.0",
  "CC0-1.0",
  "Unlicense",
]);

interface ExplicitLicenseDetection {
  ambiguous: boolean;
  compound: boolean;
  licenses: readonly string[];
}

export function detectLicenseFromText(text: string): string | null {
  return detectLicenseEvidenceFromText(text).license;
}

export interface LicenseTextEvidence {
  explicitCompound: boolean;
  license: string | null;
}

export function detectLicenseEvidenceFromText(text: string): LicenseTextEvidence {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return { explicitCompound: false, license: null };
  }
  const explicit = detectExplicitLicenseIdentifiers(text);
  const detected = new Set(explicit.licenses);
  if (explicit.ambiguous) {
    detected.add("LicenseRef-Unknown-License-Metadata");
  }
  for (const gnuLicense of detectGnuLicenses(normalized)) {
    detected.add(gnuLicense);
  }

  if (
    includesAll(normalized, [
      "mozilla public license version 2.0",
      "1. definitions",
      "covered software",
      "2. license grants and conditions",
    ])
  ) {
    detected.add("MPL-2.0");
  }

  if (
    includesAll(normalized, [
      "apache license version 2.0, january 2004",
      "http://www.apache.org/licenses/",
      "terms and conditions for use, reproduction, and distribution",
      "1. definitions",
    ])
  ) {
    detected.add("Apache-2.0");
  }

  if (
    includesAll(normalized, [
      "permission to use, copy, modify, and/or distribute this software",
      "for any purpose with or without fee is hereby granted",
      "the software is provided as is and",
      "disclaims all warranties",
      "in no event shall",
      "arising out of or in connection with the use or performance of this software",
    ])
  ) {
    detected.add("ISC");
  }

  for (const bsdLicense of detectBsdLicenses(normalized)) {
    detected.add(bsdLicense);
  }

  if (
    includesAll(normalized, [
      "permission is hereby granted, free of charge, to any person obtaining a copy",
      "to deal in the software without restriction",
      "the above copyright notice and this permission notice shall be included",
      "the software is provided as is, without warranty of any kind",
      "in no event shall the authors or copyright holders be liable",
      "arising from, out of or in connection with the software or the use or other dealings in the software",
    ])
  ) {
    detected.add("MIT");
  }

  if (
    includesAll(normalized, [
      "this is free and unencumbered software released into the public domain",
      "anyone is free to copy, modify, publish, use, compile, sell, or distribute this software",
      "the software is provided as is, without warranty of any kind",
    ])
  ) {
    detected.add("Unlicense");
  }

  if (
    includesAll(normalized, [
      "cc0 1.0 universal",
      "statement of purpose",
      "affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives",
      "no copyright",
    ])
  ) {
    detected.add("CC0-1.0");
  }

  const detectedLicenses = [...detected];
  const onlySimplePermissiveLicenses =
    detectedLicenses.length > 0 &&
    detectedLicenses.every((license) => SIMPLE_PERMISSIVE_LICENSES.has(license));
  const onlyPermissiveLicenses =
    detectedLicenses.length > 0 &&
    detectedLicenses.every((license) => PERMISSIVE_LICENSES.has(license));
  if (
    hasRestrictiveSupplement(normalized) ||
    (onlyPermissiveLicenses && hasGeneralRestriction(normalized)) ||
    (onlySimplePermissiveLicenses && hasUnrecognizedRestriction(normalized)) ||
    (onlySimplePermissiveLicenses && hasUnexpectedPrefix(text)) ||
    hasUnexpectedTrailingText(normalized, detectedLicenses)
  ) {
    detected.add("LicenseRef-Unknown-Restriction");
  }

  return {
    explicitCompound: explicit.compound,
    license: combineDetectedLicenses(detected),
  };
}

function detectGnuLicenses(text: string): readonly string[] {
  const detected: string[] = [];
  if (
    includesAll(text, [
      "gnu affero general public license",
      "version 3, 19 november 2007",
      "everyone is permitted to copy and distribute verbatim copies",
    ])
  ) {
    detected.push(
      gnuVersion(
        text,
        "gnu affero general public license version 3, 19 november 2007",
        "3",
        "AGPL-3.0-only",
        "AGPL-3.0-or-later",
      ),
    );
  }

  if (text.includes("gnu lesser general public license")) {
    if (text.includes("version 3, 29 june 2007")) {
      detected.push(
        gnuVersion(
          text,
          "gnu lesser general public license version 3, 29 june 2007",
          "3",
          "LGPL-3.0-only",
          "LGPL-3.0-or-later",
        ),
      );
    }
    if (text.includes("version 2.1, february 1999")) {
      detected.push(
        gnuVersion(
          text,
          "gnu lesser general public license version 2.1, february 1999",
          "2.1",
          "LGPL-2.1-only",
          "LGPL-2.1-or-later",
        ),
      );
    }
  }

  if (
    text.includes("gnu library general public license") &&
    text.includes("version 2, june 1991")
  ) {
    detected.push(
      gnuVersion(
        text,
        "gnu library general public license version 2, june 1991",
        "2",
        "LGPL-2.0-only",
        "LGPL-2.0-or-later",
      ),
    );
  }

  if (
    includesAll(text, [
      "gnu general public license",
      "version 3, 29 june 2007",
      "everyone is permitted to copy and distribute verbatim copies",
    ])
  ) {
    detected.push(
      gnuVersion(
        text,
        "gnu general public license version 3, 29 june 2007",
        "3",
        "GPL-3.0-only",
        "GPL-3.0-or-later",
      ),
    );
  }

  if (
    includesAll(text, [
      "gnu general public license",
      "version 2, june 1991",
      "everyone is permitted to copy and distribute verbatim copies",
    ])
  ) {
    detected.push(
      gnuVersion(
        text,
        "gnu general public license version 2, june 1991",
        "2",
        "GPL-2.0-only",
        "GPL-2.0-or-later",
      ),
    );
  }

  return detected;
}

function gnuVersion(
  text: string,
  header: string,
  version: string,
  only: string,
  orLater: string,
): string {
  const headerIndex = text.indexOf(header);
  const grant = headerIndex === -1 ? "" : text.slice(Math.max(0, headerIndex - 4096), headerIndex);
  const escapedVersion = version.replace(".", "\\.");
  const explicitlyOrLater = new RegExp(
    `(?:either )?version ${escapedVersion}.{0,160}(?:any )?later version`,
  ).test(grant);
  return explicitlyOrLater ? orLater : only;
}

function detectBsdLicenses(text: string): readonly string[] {
  const firstClause =
    "redistribution and use in source and binary forms, with or without modification, are permitted";
  const detected = new Set<string>();
  let start = text.indexOf(firstClause);

  while (start !== -1) {
    const next = text.indexOf(firstClause, start + firstClause.length);
    const section = text.slice(start, next === -1 ? undefined : next);
    if (
      includesAll(section, [
        "redistributions of source code must retain the above copyright notice",
        "redistributions in binary form must reproduce the above copyright notice",
        "this software is provided by",
        "as is",
        "in no event shall",
        "even if advised of the possibility of such damage",
      ])
    ) {
      if (
        section.includes("all advertising materials mentioning features or use of this software")
      ) {
        detected.add("BSD-4-Clause");
      } else if (
        (section.includes("neither the name") &&
          section.includes("may be used to endorse or promote products")) ||
        /the name of .{1,200} may not be used to endorse or promote products/.test(section)
      ) {
        detected.add("BSD-3-Clause");
      } else {
        detected.add("BSD-2-Clause");
      }
    }
    start = next;
  }

  return [...detected];
}

function detectExplicitLicenseIdentifiers(text: string): ExplicitLicenseDetection {
  const detected = new Set<string>();
  const lines = text.normalize("NFKC").split(/\r?\n/);
  let ambiguous = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const spdx = line.match(/^\s*(?:[#*;/]+\s*)?SPDX-License-Identifier\s*:\s*(.*?)\s*$/i);
    if (spdx !== null) {
      const expression = normalizeMetadataExpression(spdx[1] ?? "");
      if (expression === null) ambiguous = true;
      else detected.add(expression);
      continue;
    }

    const label = line.match(/^\s*(?:[-*]\s*)?licen[cs]es?\s*:\s*(.*?)\s*$/i);
    const following = line.match(/\bfollowing licen[cs]es\s*:\s*(.*?)\s*$/i);
    const match = label ?? following;
    if (match === null) continue;

    const inlineValue = match[1]?.trim() ?? "";
    const values: string[] = [];
    if (inlineValue.length > 0) {
      values.push(inlineValue);
    } else {
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const bullet = (lines[nextIndex] ?? "").match(/^\s*[-*]\s+(.+?)\s*$/);
        if (bullet === null) break;
        values.push(bullet[1] ?? "");
        nextIndex += 1;
      }
      if (values.length > 0) index = nextIndex - 1;
      else values.push(lines[index + 1]?.trim() ?? "");
    }
    const identifiers = values.flatMap((value) => value.split(/[,;]/));
    if (identifiers.length === 0 || identifiers.every((identifier) => identifier.trim() === "")) {
      ambiguous = true;
      continue;
    }

    for (const rawIdentifier of identifiers) {
      const expression = normalizeMetadataExpression(rawIdentifier);
      if (expression === null) ambiguous = true;
      else detected.add(expression);
    }
  }

  return {
    ambiguous,
    compound:
      detected.size > 1 || [...detected].some((expression) => /\s(?:AND|OR)\s/.test(expression)),
    licenses: [...detected],
  };
}

function normalizeMetadataExpression(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/[.!]$/, "");
  return correctLicenseIdentifier(value) ?? normalizeSpdx(value);
}

function combineDetectedLicenses(licenses: ReadonlySet<string>): string | null {
  const sorted = [...licenses].sort();
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  return sorted
    .map((license) => (/\b(?:AND|OR)\b/.test(license) ? `(${license})` : license))
    .join(" AND ");
}

function includesAll(text: string, fragments: readonly string[]): boolean {
  return fragments.every((fragment) => text.includes(fragment));
}

function hasRestrictiveSupplement(text: string): boolean {
  const fragments = [
    "business source license",
    "commons clause",
    "does not grant to you, the right to sell the software",
    "license zero",
    "may not be used for commercial purposes",
    "non-commercial use only",
    "noncommercial use only",
    "polyform noncommercial license",
    "prosperity public license",
    "you may not sell the software",
  ];
  if (fragments.some((fragment) => text.includes(fragment))) return true;

  return [
    /\bcommercial (?:deployment|distribution|operation|use)\b.{0,100}\brequires?\b.{0,100}\b(?:commercial|paid|separate) licen[cs]e\b/,
    /\b(?:must|shall)\b.{0,80}\b(?:obtain|purchase)\b.{0,80}\b(?:commercial|paid) licen[cs]e\b/,
    /\bonly for (?:evaluation|internal|non-?commercial|personal|research) (?:purposes?|use)\b/,
    /\bthe software (?:must|shall) be used for .{1,80}, not .{1,80}\b/,
    /\b(?:non-?military|peaceful) purposes?\b/,
  ].some((pattern) => pattern.test(text));
}

function hasUnrecognizedRestriction(text: string): boolean {
  return [
    /\badditional (?:conditions?|restrictions?|terms?)\b/,
    /\b(?:do not|dont) (?:copy|distribute|modify|sell|use)\b/,
    /\b(?:permission|rights?) (?:is|are) not granted\b/,
    /\b(?:the |this )?software\b.{0,100}\b(?:may|must|shall) not\b/,
    /\b(?:use|copying|distribution|modification|sale|selling)\b.{0,100}\b(?:forbidden|prohibited|restricted)\b/,
    /\b(?:users?|licensees?|recipients?|you)\b.{0,100}\b(?:may|must|shall) not\b/,
    /\b(?:users?|licensees?|recipients?|you)\b.{0,100}\b(?:may|must|shall)\b.{0,100}\bonly (?:for|if|in|on|with)\b/,
  ].some((pattern) => pattern.test(text));
}

function hasGeneralRestriction(text: string): boolean {
  return [
    /\b(?:the |this )?software\b.{0,100}\b(?:may|must|shall)\b.{0,100}\bonly\b/,
    /\b(?:copying|deployment|distribution|modification|permission|use)\b.{0,100}\b(?:is|are)\b.{0,30}\b(?:limited|restricted) to\b/,
    /\b(?:grant|permission|rights?)\b.{0,80}\b(?:applies?|is|are)\b.{0,30}\b(?:exclusively|only|solely) to\b/,
    /\bpermission\b.{0,80}\b(?:expires?|terminates?)\b/,
    /\b(?:copying|deployment|distribution|modification|use)\b.{0,80}\b(?:exclusively|only)\b/,
  ].some((pattern) => pattern.test(text));
}

function hasUnexpectedPrefix(text: string): boolean {
  const starts = [
    /permission\s+is\s+hereby\s+granted,?\s+free\s+of\s+charge/i,
    /permission\s+to\s+use,?\s+copy,?\s+modify,?\s+and\s*\/\s*or\s+distribute/i,
    /redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i,
  ];
  const firstStart = starts.reduce((earliest, pattern) => {
    const index = text.search(pattern);
    return index === -1 ? earliest : Math.min(earliest, index);
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(firstStart)) return false;

  const prefix = text.slice(0, firstStart);
  return prefix.split(/\r?\n/).some((line) => {
    const value = line
      .trim()
      .replace(/^[>#*;/\-\s]+/, "")
      .trim();
    return (
      value.length > 0 &&
      !/^(?:copyright\b|\(c\)|©|spdx-filecopyrighttext:|all rights reserved\b)/i.test(value) &&
      !/^\(?(?:the\s+)?(?:(?:mit|isc|bsd(?:[- ]\d[- ]clause)?)\s+)?licen[cs]e:?\)?(?:\s*\((?:mit|isc|bsd(?:[- ]\d[- ]clause)?)\))?$/i.test(
        value,
      ) &&
      !/\b(?:is|are)\s+(?:distributed|licensed|released)\s+under\b.*\blicen[cs]e:?$/i.test(value) &&
      !/^spdx-license-identifier\s*:/i.test(value)
    );
  });
}

function hasUnexpectedTrailingText(text: string, licenses: readonly string[]): boolean {
  if (!licenses.some((license) => SIMPLE_PERMISSIVE_LICENSES.has(license))) return false;

  const endings = [
    "arising from, out of or in connection with the software or the use or other dealings in the software",
    "arising out of or in connection with the use or performance of this software",
    "even if advised of the possibility of such damage",
  ];
  let end = -1;
  for (const ending of endings) {
    const index = text.lastIndexOf(ending);
    if (index !== -1) end = Math.max(end, index + ending.length);
  }
  return end !== -1 && !/^[\s.;:,-]*$/.test(text.slice(end));
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, "")
    .replace(/and\s*\/\s*or/g, "and/or")
    .replace(/\s+/g, " ")
    .trim();
}
