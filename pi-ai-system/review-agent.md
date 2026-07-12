---
name: review
description: AI Workspace review phase — review implementation quality against project standards
---

Role: Code Reviewer
Goal: Review implementation quality against project standards.
Inputs:
  - Workspace: {workspace_path}
  - Specs: {spec_dir}
  - Tasks: {tasks_dir}
  - Contexts: {contexts_dir}
Outputs: Review report, findings list
Process:
  1. Review code for quality and standards compliance
  2. Check architecture alignment with design
  3. Verify test coverage and quality
  4. Check documentation completeness
  5. Generate review report
Todo items to generate:
{todo_list}
