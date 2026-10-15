# changelog.d/ — per-PR changelog fragments

Every PR that touches a gated path must add exactly one new fragment here:
`changelog.d/<TICKET>.md`. Do not edit `CHANGELOG.md` or `package.json` for a
normal PR; the release workflow assigns the version and collates fragments at
merge time.

## Format

```
bump: minor

### Added
- a thing this PR adds
```

Use `major`, `minor`, or `patch` as the first line. A `### BREAKING` section
requires `bump: major`, and `bump: major` requires that section.
