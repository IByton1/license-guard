import licenseIds from "spdx-license-ids";

const canonicalIdentifiers = new Map(
  licenseIds.map((identifier) => [identifier.toLowerCase(), identifier] as const),
);

const declarationCorrections = new Map<string, string>([
  ["apache 2", "Apache-2.0"],
  ["apache 2.0", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["apache license version 2.0", "Apache-2.0"],
  ["apache license, version 2.0", "Apache-2.0"],
  ["bsd 2 clause", "BSD-2-Clause"],
  ["bsd 2-clause", "BSD-2-Clause"],
  ["simplified bsd", "BSD-2-Clause"],
  ["bsd 3 clause", "BSD-3-Clause"],
  ["bsd 3-clause", "BSD-3-Clause"],
  ["modified bsd", "BSD-3-Clause"],
  ["new bsd", "BSD-3-Clause"],
  ["revised bsd", "BSD-3-Clause"],
  ["cc0", "CC0-1.0"],
  ["cc0 1.0", "CC0-1.0"],
  ["creative commons zero 1.0 universal", "CC0-1.0"],
  ["creative commons zero v1.0 universal", "CC0-1.0"],
  ["gpl2", "GPL-2.0-only"],
  ["gpl 2", "GPL-2.0-only"],
  ["gpl 2.0", "GPL-2.0-only"],
  ["gpl v2", "GPL-2.0-only"],
  ["gplv2", "GPL-2.0-only"],
  ["gnu gpl v2", "GPL-2.0-only"],
  ["gpl2+", "GPL-2.0-or-later"],
  ["gpl v2+", "GPL-2.0-or-later"],
  ["gplv2+", "GPL-2.0-or-later"],
  ["gpl v2 or later", "GPL-2.0-or-later"],
  ["gpl3", "GPL-3.0-only"],
  ["gpl 3", "GPL-3.0-only"],
  ["gpl 3.0", "GPL-3.0-only"],
  ["gpl v3", "GPL-3.0-only"],
  ["gplv3", "GPL-3.0-only"],
  ["gnu gpl v3", "GPL-3.0-only"],
  ["gpl3+", "GPL-3.0-or-later"],
  ["gpl v3+", "GPL-3.0-or-later"],
  ["gplv3+", "GPL-3.0-or-later"],
  ["gpl v3 or later", "GPL-3.0-or-later"],
  ["isc license", "ISC"],
  ["mozilla public license 2.0", "MPL-2.0"],
  ["mpl 2", "MPL-2.0"],
  ["mpl 2.0", "MPL-2.0"],
  ["the unlicense", "Unlicense"],
]);

const nonLicenseDeclarations = [
  /^(?:none|noassertion|not applicable|n\/a|private|proprietary|unlicensed)$/i,
  /^(?:see|refer to)\s+licen[cs]e\b/i,
];

export function correctLicenseIdentifier(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || nonLicenseDeclarations.some((pattern) => pattern.test(value))) {
    return null;
  }

  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  return canonicalIdentifiers.get(normalized) ?? declarationCorrections.get(normalized) ?? null;
}
