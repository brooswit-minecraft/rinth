#!/usr/bin/env bun
// CI changelog/version gate: CHANGELOG.md must have a `## [<version>]`
// heading matching the version in package.json. See README.md for the rule.

import pkg from "../package.json" with { type: "json" };

const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
const changelog = await Bun.file(changelogPath).text();

const version = pkg.version;
const heading = new RegExp(`^##\\s*\\[${version.replace(/\./g, "\\.")}\\]`, "m");

if (!heading.test(changelog)) {
  console.error(
    `CHANGELOG.md is missing an entry for version ${version} (expected a heading matching "## [${version}]").`,
  );
  process.exit(1);
}

console.log(`CHANGELOG.md has an entry for version ${version}.`);
