---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned local rules file guidelines.md (next to this SKILL.md)
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in guidelines.md
4. Output findings in the terse `file:line` format

## Guidelines Source

Rules are vendored locally in `guidelines.md` (copy of vercel-labs/web-interface-guidelines command.md, commit 434b7f9, 2026-10-05, MIT).
Do NOT fetch rules from the network: the local file is the reviewed, pinned version. To update, a human re-copies and re-reads it.

## Usage

When a user provides a file or pattern argument:
1. Read guidelines.md
2. Read the specified files
3. Apply all rules from guidelines.md
4. Output findings using the format specified in guidelines.md

If no files specified, ask the user which files to review.
