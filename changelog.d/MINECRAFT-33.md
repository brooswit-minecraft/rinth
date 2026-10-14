bump: minor

### Added
- `rinth servers list` and `rinth servers get` expose safe, caller-actionable
  Archon server state: suspension reason, backup quota usage, notices, intro
  flow state, and medal status/expiry. SFTP credentials, node tokens, owner
  identity, and permission internals remain excluded.
