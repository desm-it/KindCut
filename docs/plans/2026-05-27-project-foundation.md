# Cricut Companion Foundation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Establish a local-first Cricut Companion app foundation with domain packages, desktop prototype, docs, and Codex context.

**Architecture:** TypeScript npm workspaces split into pure craft logic packages and a React/Vite desktop shell. SliceBug integration starts as safe command construction only.

**Tech Stack:** Node, npm workspaces, TypeScript, React, Vite, Vitest.

---

### Task 1: Initialize monorepo scaffold

Create root package metadata, TypeScript base config, `.gitignore`, and `README.md`.

### Task 2: Add craft-core project model

Create machine/mat/material/layer types, beginner project builder, validation, and tests.

### Task 3: Add SVG preflight foundation

Create lightweight SVG checks and tests.

### Task 4: Add AI designer prompt contract

Create prompt builder focused on craft-ready SVG constraints and tests.

### Task 5: Add SliceBug bridge command builders

Create plan/cut command preview helpers and tests; mark cut commands as hardware side effects.

### Task 6: Add desktop prototype shell

Create React/Vite app that displays sample recipe, AI prompt, validation, and SliceBug command preview.

### Task 7: Add Codex context and docs

Create `AGENTS.md`, `AppContext/`, product plan, and architecture docs.

### Task 8: Verify and commit

Run `npm install`, `npm run check`, then commit the foundation.
