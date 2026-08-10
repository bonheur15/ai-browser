import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tag = process.argv[2] ?? process.env.RELEASE_TAG;
assert(tag, "Pass a release tag such as v0.1.0.");
assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `Invalid release tag: ${tag}`);

const version = tag.slice(1);
const packageDocument = JSON.parse(await readFile("package.json", "utf8"));
const lockDocument = JSON.parse(await readFile("package-lock.json", "utf8"));
const changelog = await readFile("CHANGELOG.md", "utf8");

assert.equal(packageDocument.version, version, "package.json version does not match the tag");
assert.equal(lockDocument.version, version, "package-lock.json version does not match the tag");
assert.equal(
  lockDocument.packages?.[""]?.version,
  version,
  "package-lock.json root package version does not match the tag",
);

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
assert.match(
  changelog,
  new RegExp(`^## \\[${escapedVersion}\\]`, "m"),
  `CHANGELOG.md has no ${version} release section`,
);

console.log(`Release metadata is consistent for ${tag}.`);
