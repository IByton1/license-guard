import { describe, expect, it } from "vitest";
import { detectLicenseFromText } from "../../src/license/heuristics.js";

const MIT = `
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

describe("detectLicenseFromText", () => {
  it.each([
    [MIT, "MIT"],
    [
      `Permission to use, copy, modify, and/or distribute this software
       for any purpose with or without fee is hereby granted.
       THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
       IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES WHATSOEVER ARISING
       OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
      "ISC",
    ],
    [
      `Apache License Version 2.0, January 2004
       http://www.apache.org/licenses/
       TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
       1. Definitions.`,
      "Apache-2.0",
    ],
    [
      `Mozilla Public License Version 2.0
       1. Definitions. Covered Software means Source Code Form.
       2. License Grants and Conditions.`,
      "MPL-2.0",
    ],
    [
      `This is free and unencumbered software released into the public domain.
       Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software.
       THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`,
      "Unlicense",
    ],
    [
      `CC0 1.0 Universal. Statement of Purpose. No Copyright.
       Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives
       all of Affirmer's Copyright and Related Rights.`,
      "CC0-1.0",
    ],
  ])("recognizes a high-confidence license text", (text, expected) => {
    expect(detectLicenseFromText(text)).toBe(expected);
  });

  it.each([
    ["GNU GENERAL PUBLIC LICENSE Version 2, June 1991", "GPL-2.0-only"],
    ["GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007", "GPL-3.0-only"],
    ["GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007", "AGPL-3.0-only"],
  ])("recognizes GNU license families", (header, expected) => {
    expect(
      detectLicenseFromText(
        `${header}\nEveryone is permitted to copy and distribute verbatim copies of this license document.`,
      ),
    ).toBe(expected);
  });

  it.each([
    ["GNU LIBRARY GENERAL PUBLIC LICENSE Version 2, June 1991", "LGPL-2.0-only"],
    ["GNU LESSER GENERAL PUBLIC LICENSE Version 2.1, February 1999", "LGPL-2.1-only"],
    ["GNU LESSER GENERAL PUBLIC LICENSE Version 3, 29 June 2007", "LGPL-3.0-only"],
  ])("recognizes LGPL versions", (text, expected) => {
    expect(detectLicenseFromText(text)).toBe(expected);
  });

  it("distinguishes two- and three-clause BSD texts", () => {
    const clauses = `
      Redistribution and use in source and binary forms, with or without modification, are permitted.
      Redistributions of source code must retain the above copyright notice.
      Redistributions in binary form must reproduce the above copyright notice.
    `;
    const disclaimer = `
      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
      IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES,
      EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
    `;
    expect(detectLicenseFromText(`${clauses}${disclaimer}`)).toBe("BSD-2-Clause");
    expect(
      detectLicenseFromText(
        `${clauses} Neither the name of Example Corp nor the names of its contributors may be used to endorse or promote products. ${disclaimer}`,
      ),
    ).toBe("BSD-3-Clause");
    expect(
      detectLicenseFromText(
        `${clauses} Neither the names of the Mozilla Foundation nor the names of project contributors may be used to endorse or promote products. ${disclaimer}`,
      ),
    ).toBe("BSD-3-Clause");
  });

  it("does not misclassify the four-clause BSD license", () => {
    expect(
      detectLicenseFromText(`
        Redistribution and use in source and binary forms, with or without modification, are permitted.
        Redistributions of source code must retain the above copyright notice.
        Redistributions in binary form must reproduce the above copyright notice.
        All advertising materials mentioning features or use of this software must display an acknowledgement.
        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
        IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES,
        EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
      `),
    ).toBe("BSD-4-Clause");
  });

  it("recognizes explicit GNU or-later grants", () => {
    expect(
      detectLicenseFromText(`
        This program is licensed under either version 2 of the License, or any later version.
        GNU GENERAL PUBLIC LICENSE Version 2, June 1991
        Everyone is permitted to copy and distribute verbatim copies of this license document.
      `),
    ).toBe("GPL-2.0-or-later");
  });

  it("does not infer or-later from the standard GNU license appendix", () => {
    expect(
      detectLicenseFromText(`
        GNU GENERAL PUBLIC LICENSE Version 2, June 1991
        Everyone is permitted to copy and distribute verbatim copies of this license document.
        How to Apply These Terms to Your New Programs
        This program is free software; you can redistribute it under either version 2 of the License,
        or (at your option) any later version.
      `),
    ).toBe("GPL-2.0-only");
  });

  it("retains every high-confidence license in a bundled notice", () => {
    expect(
      detectLicenseFromText(`${MIT}
        Permission to use, copy, modify, and/or distribute this software
        for any purpose with or without fee is hereby granted.
        THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
        IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DAMAGES WHATSOEVER ARISING
        OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
      `),
    ).toBe("ISC AND MIT");
  });

  it("recognizes SPDX identifiers in explicit bundled-license metadata", () => {
    expect(
      detectLicenseFromText(
        "The published artifact contains code with the following licenses: Apache-2.0, BSD-2-Clause, CC0-1.0, ISC, MIT",
      ),
    ).toBe("Apache-2.0 AND BSD-2-Clause AND CC0-1.0 AND ISC AND MIT");
  });

  it("normalizes Markdown blockquotes before matching full texts", () => {
    expect(
      detectLicenseFromText(`
        > Apache License
        > Version 2.0, January 2004
        > http://www.apache.org/licenses/
        > TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
        > 1. Definitions.
      `),
    ).toBe("Apache-2.0");
  });

  it("retains distinct BSD variants from bundled full texts", () => {
    const clauses = `
      Redistribution and use in source and binary forms, with or without modification, are permitted.
      Redistributions of source code must retain the above copyright notice.
      Redistributions in binary form must reproduce the above copyright notice.
    `;
    const disclaimer = `
      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
      IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES,
      EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
    `;
    expect(
      detectLicenseFromText(
        `${clauses}${disclaimer}\n${clauses} Neither the name of Example Corp nor the names of its contributors may be used to endorse or promote products. ${disclaimer}`,
      ),
    ).toBe("BSD-2-Clause AND BSD-3-Clause");
  });

  it("does not treat a permissive template with a restrictive supplement as permissive", () => {
    expect(
      detectLicenseFromText(`${MIT}
        Commons Clause License Condition v1.0
        The License does not grant to you the right to Sell the Software.
      `),
    ).toBe("LicenseRef-Unknown-Restriction AND MIT");
  });

  it("marks arbitrary conditions appended to a permissive full text as unknown evidence", () => {
    expect(
      detectLicenseFromText(
        `${MIT}\nAdditional condition: You may use the Software only for peaceful, non-military purposes.`,
      ),
    ).toBe("LicenseRef-Unknown-Restriction AND MIT");
  });

  it("fails closed when explicit license metadata is only partially understood", () => {
    expect(detectLicenseFromText("Licenses: MIT, GPL-3.0-only (embedded component)")).toBe(
      "LicenseRef-Unknown-License-Metadata AND MIT",
    );
  });

  it("retains SPDX license identifiers alongside detected full texts", () => {
    expect(detectLicenseFromText(`SPDX-License-Identifier: GPL-3.0-only\n${MIT}`)).toBe(
      "GPL-3.0-only AND MIT",
    );
  });

  it("reads an explicit license list from the following line", () => {
    expect(
      detectLicenseFromText(
        "The artifact contains code with the following licenses:\nApache-2.0, ISC, MIT",
      ),
    ).toBe("Apache-2.0 AND ISC AND MIT");
  });

  it("reads every item in a multiline explicit license list", () => {
    expect(detectLicenseFromText("The following licenses:\n- MIT\n- GPL-3.0-only")).toBe(
      "GPL-3.0-only AND MIT",
    );
  });

  it("marks unknown conditions before a permissive full text as unknown evidence", () => {
    expect(
      detectLicenseFromText(`Commercial deployment requires a separate paid license.\n${MIT}`),
    ).toBe("LicenseRef-Unknown-Restriction AND MIT");
  });

  it("allows standard copyright preambles before permissive full texts", () => {
    expect(detectLicenseFromText(`MIT License\nCopyright (c) 2026 Example\n${MIT}`)).toBe("MIT");
    expect(detectLicenseFromText(`The MIT License\nCopyright (c) 2026 Example\n${MIT}`)).toBe(
      "MIT",
    );
    expect(detectLicenseFromText(`(The MIT License)\nCopyright (c) 2026 Example\n${MIT}`)).toBe(
      "MIT",
    );
    expect(detectLicenseFromText(`The MIT License (MIT)\nCopyright (c) 2026 Example\n${MIT}`)).toBe(
      "MIT",
    );
    expect(detectLicenseFromText(`Copyright (c) 2026 Example\nAll rights reserved.\n${MIT}`)).toBe(
      "MIT",
    );
  });

  it("allows a project title header before a BSD copyright block (bcryptjs)", () => {
    expect(
      detectLicenseFromText(`bcrypt.js
---------
Copyright (c) 2012 Nevins Bartolomeo <nevins.bartolomeo@gmail.com>
Copyright (c) 2012 Shane Girish <shaneGirish@gmail.com>
Copyright (c) 2025 Daniel Wirtz <dcode@dcode.io>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR \`\`AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`),
    ).toBe("BSD-3-Clause");
  });

  it("allows a wrapped secondary attribution line before a permissive full text (lodash.isstring)", () => {
    expect(
      detectLicenseFromText(`Copyright 2012-2016 The Dojo Foundation <http://dojofoundation.org/>
Based on Underscore.js, copyright 2009-2016 Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>
${MIT}`),
    ).toBe("MIT");
  });

  it("allows the standard lodash bundled-license and sample-code CC0 notices after a permissive full text", () => {
    expect(
      detectLicenseFromText(`Copyright jQuery Foundation and other contributors <https://jquery.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====
${MIT}
====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.`),
    ).toBe("MIT");
  });

  it.each([
    `Apache License Version 2.0, January 2004
     http://www.apache.org/licenses/
     TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
     1. Definitions.`,
    `This is free and unencumbered software released into the public domain.
     Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software.
     THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`,
    `CC0 1.0 Universal. Statement of Purpose. No Copyright.
     Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives
     all of Affirmer's Copyright and Related Rights.`,
    `Mozilla Public License Version 2.0
     1. Definitions. Covered Software means Source Code Form.
     2. License Grants and Conditions.`,
  ])("retains a paid-license restriction beside recognized license evidence", (licenseText) => {
    expect(
      detectLicenseFromText(
        `${licenseText}\nCommercial deployment requires a separate paid license.`,
      ),
    ).toContain("LicenseRef-Unknown-Restriction");
  });

  it("recognizes the JSON License field-of-use restriction", () => {
    expect(
      detectLicenseFromText(`Apache License Version 2.0, January 2004
        http://www.apache.org/licenses/
        TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
        1. Definitions.
        The Software shall be used for Good, not Evil.`),
    ).toBe("Apache-2.0 AND LicenseRef-Unknown-Restriction");
  });

  it.each([
    "The software may only be deployed by companies with fewer than 100 employees.",
    "Use is limited to organizations with annual revenue below one million euros.",
    "Permission terminates after thirty days unless renewed by the author.",
    "Distribution is permitted exclusively to educational institutions.",
    "The grant applies solely to educational institutions.",
  ])("recognizes a general restriction beside Apache evidence: %s", (restriction) => {
    expect(
      detectLicenseFromText(`Apache License Version 2.0, January 2004
        http://www.apache.org/licenses/
        TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
        1. Definitions.
        ${restriction}`),
    ).toBe("Apache-2.0 AND LicenseRef-Unknown-Restriction");
  });

  it.each([
    "",
    "MIT License",
    "Permission is hereby granted to use this code.",
    "Licensed under the Apache License, Version 2.0.",
  ])("does not guess from incomplete text", (text) => {
    expect(detectLicenseFromText(text)).toBeNull();
  });
});
