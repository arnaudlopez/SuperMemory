# Security Policy

SuperMemory handles source material, credentials, provenance, and potentially sensitive memory. Do not include secrets, live Hindsight evidence, raw customer data, or private vault content in a public issue.

## Reporting

Report a suspected vulnerability through a private GitHub security advisory for this repository. Include the smallest safe reproduction, affected version or commit, and impact. Redact credentials and real source content.

If private advisory reporting is unavailable, contact the repository owner through an already established private channel before sharing technical details.

## Local Checks

Before proposing a release, run:

```bash
npm run verify:secrets
npm test
npm run verify:release
```

The scanner is a guardrail, not proof that a repository contains no secrets. Rotate any credential that may have been exposed, even if it was later removed from the working tree.
