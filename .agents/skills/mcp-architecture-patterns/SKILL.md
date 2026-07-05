---
name: mcp-architecture-patterns
description: Review and design Model Context Protocol (MCP) server architecture using recurring server patterns, anti-pattern checks, and cross-cutting concerns. Use when Codex is designing or reviewing MCP tools/resources/prompts, deciding tool boundaries, classifying an MCP server as Resource Gateway / Tool Orchestrator / Stateful Session Server / Proxy Aggregator / Domain-Specific Adapter, checking tool-count pressure, or reviewing MCP error handling, versioning, authentication, observability, and untrusted resource content.
---

# MCP Architecture Patterns

Use this skill to review MCP server design through the pattern vocabulary from Carson Rodrigues and Oysturn Vas, "MCP Server Architecture Patterns for LLM-Integrated Applications", arXiv:2606.30317v1.

Do not treat the taxonomy as a replacement for repo-specific constraints. If another skill defines domain boundaries, security rules, release gates, or non-goals, apply that skill first and use this skill as an architecture review lens.

## Review Workflow

1. Identify the server's externally visible surface: tools, resources, prompts, transports, auth model, state, downstream systems, and generated outputs.
2. Classify the primary pattern from implementation signals, not from tool names alone. Statefulness and domain logic can be cross-cutting attributes rather than the primary pattern.
3. Check whether the chosen pattern matches the problem. Prefer the smallest pattern that preserves a clear LLM-facing contract.
4. Run the anti-pattern checks before recommending implementation.
5. Report concrete design actions: keep, split, rename, add metadata, add paging, add sanitization, add structured errors, add versioning, or defer as out of scope.

## Pattern Guide

### Resource Gateway

Use for read-mostly access to backend data: files, databases, document stores, or APIs. The MCP server mediates access and gives the LLM stable resources, IDs, summaries, bounded snippets, and parameterized read tools.

Review for:

- A single layer that enforces access boundaries, root scopes, masking, sanitization, and pagination.
- Stable LLM-facing schemas that do not expose backend format churn directly.
- Resource or query decomposition that keeps large data out of single responses.
- Explicit treatment of retrieved content as untrusted when it can contain user or external text.

Avoid treating Resource Gateway as permission to expose raw backend content. The gateway exists to shape, constrain, and label data before the LLM receives it.

### Tool Orchestrator

Use for composite workflows where the server performs multiple calls or steps internally and returns one operation-level result to the LLM.

Review for:

- Clear workflow boundaries: the LLM should not need to manage intermediate state or call order.
- Server-side handling of partial failure, retries, and rollback-like semantics.
- Tool descriptions that explain what external systems are touched and what side effects occur.
- Avoiding hidden multi-system side effects in tools that look like simple reads.

Do not use this pattern to hide a grab bag of unrelated operations behind one broad tool.

### Stateful Session Server

Use only when later calls genuinely depend on server-side state established earlier: open browser/page, active transaction, loaded workspace, authenticated session, or long-lived conversation state.

Review for:

- Why state is necessary instead of passing explicit arguments.
- Session creation, expiry, cleanup, and memory-leak controls.
- Horizontal scaling requirements if the server may run more than one instance.
- Whether the LLM can reliably carry any required session ID or handle expired sessions.
- Documentation that makes statefulness visible to clients and maintainers.

Prefer stateless tools unless state removes real complexity or data transfer cost.

### Proxy Aggregator

Use when one MCP surface fronts multiple MCP servers or a large capability fleet. The useful variant is scoped exposure: show only the relevant tools/resources for the current context.

Review for:

- Per-context tool filtering or retrieval-over-tools rather than static merging.
- Auth, audit, and versioning at the aggregation boundary.
- Added latency from downstream fan-out.
- Clear routing errors when no downstream server or capability matches.

Treat tool-count thresholds as heuristics, not universal constants. The paper reports observational degradation as visible tool counts grow, so the design response is selective exposure and better descriptions, not simply adding a larger model.

### Domain-Specific Adapter

Use when the server wraps a complex domain or upstream API and converts it into LLM-friendly operations, validation, terminology, and guardrails.

Review for:

- Domain validation before calling upstream systems.
- Error messages and next actions written in the domain's language.
- Stable LLM-facing schemas that absorb upstream API churn.
- Tool descriptions that explain domain assumptions, side effects, and non-goals.
- Generated drafts clearly marked as drafts when derived from untrusted or incomplete input.

This pattern is often combined with Resource Gateway or Tool Orchestrator.

## Anti-Pattern Checks

- God Tool: Split tools that combine unrelated discovery, reading, parsing, generation, mutation, and comparison. A tool should be selectable from its name and description without guessing.
- Unsanitized Resource Content: Do not pass external text, comments, identifiers, logs, SQL, markdown, or document bodies as trusted instructions. Label untrusted payload fields and keep trusted guidance separate.
- Synchronous Long-Running Operations: Avoid tools that block for many seconds on large processing jobs. Prefer bounded responses, paging, summaries, job IDs, or explicit polling.
- Missing or Vague Tool Descriptions: Descriptions are contract, not comments. Include what the tool does, when to use it, what it returns, side effects, limits, and important non-goals.

## Cross-Cutting Concerns

- Authentication: Put auth at the transport or boundary layer, not as ad hoc checks inside unrelated handlers. Scope credentials to tool sets where possible.
- Error handling: Prefer structured error content that lets the LLM decide whether to retry, narrow input, ask the user, or stop.
- Versioning: Treat `tools/list`, tool names, descriptions, input schemas, output fields, and stable/draft labels as public contract. Keep compatibility windows for breaking changes.
- Observability: Log tool name, caller identity when available, input hash, latency, output size, and error code. Do not log secrets, raw documents, personal paths, tokens, or connection strings.
- Transport: For local clients, stdio is usually appropriate. For remote deployments, network placement and downstream fan-out matter more than protocol overhead alone.

## Review Output Shape

When reporting a review, use this compact structure:

- Primary pattern: one pattern plus any cross-cutting attributes.
- Fit: why the pattern matches or where it strains.
- Risks: anti-patterns or cross-cutting concerns that could cause failures.
- Actions: concrete changes to tool boundaries, descriptions, schemas, metadata, limits, errors, tests, or docs.
- Non-goals: capabilities that should not be inferred from the pattern.
