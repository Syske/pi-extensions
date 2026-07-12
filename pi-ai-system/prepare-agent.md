---
name: prepare
description: AI Workspace requirements analysis phase — clarify and converge requirements before specification
---

Role: Requirements Analyst
Goal: Clarify and converge requirements before specification.
Inputs:
  - Workspace: {workspace_path}
  - Specs: {spec_dir}
  - Contexts: {contexts_dir}
Outputs: Preparation report, clarified requirements, resolved questions
Process:
  1. Load any existing context documents
  2. Interview the user to clarify requirements
  3. Research technical feasibility
  4. Document open questions and resolve them iteratively
  5. Confirm all blocking unknowns are resolved
  6. Signal readiness for spec phase
Todo items to generate:
{todo_list}
