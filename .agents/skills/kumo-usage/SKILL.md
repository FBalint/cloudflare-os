---
name: kumo-usage
description: Design, implement, or review React product UI in the Gadgets repository using @cloudflare/kumo, current Phosphor icons, and semantic Kumo tokens. Use when creating or materially changing pages, layouts, forms, tables, dialogs, navigation, filters, or UI states under packages/* frontend and app directories.
---

# Kumo Usage

Design a coherent product experience, then implement it with the highest-level supported Kumo UI available. Do not begin by assembling low-level elements based on appearance.

## Required workflow

1. Inspect the request, surrounding product, existing behavior, permissions, data shape, and nearby established patterns.
2. Read [FOUNDATIONS.md](FOUNDATIONS.md) and write a short page brief for a new page or material layout change.
3. Read [SCENARIOS.md](SCENARIOS.md) and select the closest experience scenario before choosing components.
4. Read [COMPONENTS.md](COMPONENTS.md), then choose the highest-level Kumo component that owns the required behavior.
5. Verify every API against the installed package. Never guess exports, props, variants, compound members, or callbacks.
6. Follow [GAPS.md](GAPS.md) if Kumo cannot support required behavior. Do not silently create a lookalike design-system primitive.
7. Implement applicable loading, empty, filtered-empty, error, permission, disabled, validation, success, and responsive states.
8. Review hierarchy, accessibility, color modes, responsive reflow, and interaction behavior.

For a small change inside an established composition, preserve that composition and use only the relevant component and state guidance.

## Sources of truth

Use sources in this order:

1. Product requirements, existing behavior, tests, and accessibility semantics
2. The nearest `AGENTS.md`, including `packages/workshop-frontend/AGENTS.md`
3. Installed `@cloudflare/kumo` exports and TypeScript declarations
4. The installed Kumo CLI documentation:
   - `pnpm exec kumo ai` for package usage and token guidance
   - `pnpm exec kumo ls` for component discovery
   - `pnpm exec kumo doc <Component>` for exact component documentation
   - `pnpm exec kumo docs` only when the complete registry is necessary
5. The installed package's `ai/component-registry.json` for structured metadata
6. Current repository consumers of the verified API

Run the CLI from the package that owns the UI, or use
`pnpm --filter <package> exec kumo ...` from the workspace root. Upstream also
documents `npx @cloudflare/kumo`, but it may execute a newer release than this
repository has installed. The installed package is authoritative for code, so
do not fetch web documentation during the normal component-selection workflow.
Consult the web only when the installed CLI, registry, and declarations do not
answer a required question, and verify any result against installed types.

## Non-negotiable rules

- Use Kumo components wherever Kumo provides the required semantics and behavior. Do not recreate buttons, links, inputs, disclosures, dialogs, tooltips, tables, empty states, or loading primitives with raw HTML.
- Use Kumo components for the complete interaction they own, not merely as styled replacements for native controls.
- Let Kumo own component appearance, focus behavior, disabled states, radius, spacing, and motion. Prefer composition and documented props over visual overrides.
- CFOS uses 13px as its base product font size. Use `size="sm"` on Kumo `Text`, or `text-sm` for product-local text, almost everywhere. This does not change component sizing: controls remain on Kumo's `size="base"` variant. Reserve larger font sizes for headings and smaller font sizes for secondary metadata.
- Use semantic Kumo tokens by role. Never introduce primitive palette colors, custom light/dark colors, or Tailwind `dark:` variants.
- Use static Tailwind classes for layout and responsive structure. Use `cn()` from `@cloudflare/kumo/utils` for conditional classes.
- Use current `*Icon` exports from `@phosphor-icons/react`, such as `ArrowIcon`; unsuffixed exports such as `Arrow` are deprecated.
- Preserve semantic heading, form, table, and dialog structure. Every control needs an accessible name and visible focus behavior.
- Preserve business behavior unless the request explicitly changes it.

## Completion checklist

- [ ] The user goal, primary task, and content hierarchy are clear
- [ ] A scenario was selected before individual components
- [ ] Every introduced API was verified against installed types
- [ ] Applicable loading, empty, error, permission, and mutation states are handled
- [ ] Narrow layouts preserve the primary content and actions
- [ ] No raw color, `dark:` variant, deprecated icon export, or recreated Kumo control was introduced
- [ ] Keyboard behavior, focus, accessible naming, and semantic structure are preserved
- [ ] Any design-system gap is documented rather than silently worked around

## References

- [FOUNDATIONS.md](FOUNDATIONS.md)
- [SCENARIOS.md](SCENARIOS.md)
- [COMPONENTS.md](COMPONENTS.md)
- [GAPS.md](GAPS.md)
