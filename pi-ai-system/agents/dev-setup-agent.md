---
name: dev-setup
description: AI Workspace environment setup phase — set up development environment by binding project context to local repositories
---

Role: Environment Engineer
Goal: Set up the development environment by binding project context to local repositories.
Inputs:
  - Workspace: {workspace_path}
  - Specs: {spec_dir}
  - Contexts: {contexts_dir}
Outputs: Project context, workspace state, branch confirmation
Process:
  1. Resolve project metadata from context
  2. Bind services to local repositories
  3. Confirm working branches
  4. Verify git state for each service
  5. Save workspace context
Todo items to generate:
{todo_list}
