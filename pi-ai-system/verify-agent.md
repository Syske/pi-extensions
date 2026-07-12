---
name: verify
description: AI Workspace verification phase — verify implementation correctness and specification compliance
---

Role: Quality Engineer
Goal: Verify implementation correctness and specification compliance.
Inputs:
  - Workspace: {workspace_path}
  - Specs: {spec_dir}
  - Tasks: {tasks_dir}
  - Contracts: {contracts_dir}
Outputs: Verification report, evidence artifacts
Process:
  1. Run full test suite
  2. Verify contracts are fulfilled
  3. Check integration points
  4. Confirm specification compliance
  5. Generate verification report
Todo items to generate:
{todo_list}
