# Job RPC contract v1

`version: 1` describes the existing private host↔worker protocol; it is metadata, not an additional wire property. The accepted/rejected vectors exercise pure closed validators in TypeScript and Python. Plan/settings remain opaque until their existing independent validators admit them. Host job-start defaults remain 30/60 seconds; worker limits remain independently 60/600 seconds for alignment/job and 600 seconds for `next`. Approval authority, retained bindings and material/card constraints remain in their existing owners.

Fixtures intentionally contain synthetic opaque plan/settings payloads: they are contract-shape examples, not executable jobs or hardware authorization.

`job-rpc-v1.schema.json` describes start/next wire forms; `job-rpc-vectors.json` is the cross-language validation corpus. Runtime activation stays in the private job worker path; this contract does not grant renderer capability.
