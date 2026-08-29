# Plugin Export Audit

- Current user export: **NOT PROVIDED**
- Audit state: **BLOCKED/UNKNOWN**
- Required command: `npm run adp:audit:plugin -- <zip-path>`

The auditor requires exactly 13 YAML files and 13 unique expected operationIds. Exactly six Decision operations must contain `decisionPreferences` input and `decision` output; the remaining seven must contain neither. It also verifies HTTPS function path shape, bearer configuration without a token value, credential absence, stable business descriptions, and rejects `competition-demo-v2/v3`, R-number, Runtime/test-case and development wording in tool descriptions.

No Console export has been represented as passing without the actual ZIP.
