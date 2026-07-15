import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseTag = process.env.GITHUB_REF_NAME;
const expectedTag = `v${manifest.version}`;

if (releaseTag !== expectedTag) {
  throw new Error(`Release tag ${JSON.stringify(releaseTag)} must equal ${expectedTag}.`);
}
