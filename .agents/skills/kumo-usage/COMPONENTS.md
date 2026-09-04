# Component Selection

This is a selection guide. The installed package and Kumo documentation are the current component catalog.

## Selection order

1. An established product-level component that already owns the behavior
2. A public, styled `@cloudflare/kumo` component
3. A product-local composition of Kumo components
4. A noninteractive `div` layout using static Tailwind and semantic Kumo tokens
5. A documented exception following [GAPS.md](GAPS.md)

Do not choose a lower-level option because it is easier to customize.

## Verify before use

1. Read the nearest `AGENTS.md`.
2. Inspect installed Kumo exports and TypeScript declarations.
3. Run `pnpm exec kumo ai` for the installed package's usage and token rules.
4. Run `pnpm exec kumo ls` to discover components, then
   `pnpm exec kumo doc <Component>` for each selected API.
5. Use the installed `ai/component-registry.json` when structured or complete
   registry information is needed.
6. Inspect a current repository consumer for integration context, not as API authority.

When running from the workspace root, target the UI package with
`pnpm --filter <package> exec kumo ...`. Do not use unpinned
`npx @cloudflare/kumo` as API authority because it can resolve a newer release.
Do not fetch web component documentation unless the installed CLI, registry,
and declarations leave a required question unresolved.

Never guess a variant, callback payload, controlled-state prop, compound member, polymorphic API, or import path.

## Common needs

| Product need | Check first |
| --- | --- |
| Product typography and semantic headings | `Text` |
| Actions | `Button`, `Link` |
| Search with an icon or addon | `InputGroup` |
| Text entry | `Input`, `InputArea`, `SensitiveInput` |
| Selection | `Select`, `Combobox`, `Autocomplete`, `Checkbox`, `Radio`, `Switch` |
| Disclosure | `Collapsible` |
| Modal workflow | `Dialog` |
| Anchored popup | `Popover`, `DropdownMenu`, `Tooltip` |
| Tabular data | `Table` |
| Empty results | `Empty` |
| Loading | Component-owned loading prop, `SkeletonLine`, or `Loader` |
| Contained surface | `LayerCard` or the current documented surface component |
| Status and feedback | `Badge`, `Banner`, `Toast` |
| Navigation | `Tabs`, `Breadcrumbs`, `Sidebar` as appropriate |

## Required patterns

### Search

Prefer Kumo's `InputGroup` composition rather than manually positioning an icon over an input. Verify the installed member names and callback API first.

### Disclosure

Use `Collapsible.Root`, its trigger, and panel in the documented hierarchy. Do not recreate disclosure state and accessibility with a native button plus conditionally rendered content.

### Empty and loading states

Use `Empty` rather than hand-building its icon, title, description, and action spacing. Use `SkeletonLine` or `Loader` according to whether the expected geometry is known.

### Typography

Use `Text` and semantic `as` values. CFOS overrides Kumo's general content-size
guidance with a 13px product baseline: use `size="sm"` on `Text`, or `text-sm`
for product-local text, almost everywhere. This applies only to font size;
controls remain on Kumo's `size="base"` component variant. Headings use sentence
case, tracking is not overridden, and `font-bold` is not used.

### Icons

Use current `*Icon` exports from `@phosphor-icons/react`. Icons supplement labels and never serve as an icon-only control's accessible name.

### Styling

- Select semantic tokens by role, following `pnpm exec kumo ai`.
- Use the documented surface hierarchy and appropriate hairline or line token.
- Do not use raw colors or `dark:` variants.
- Do not transition hover colors.
- Avoid borders combined with drop shadows; follow Kumo's ring guidance.
- Keep Tailwind classes static and use `cn()` for conditions.
- Use `min-w-0` and wrapping or truncation deliberately in shrinking flex/grid children.

## Common errors

| Avoid | Prefer |
| --- | --- |
| Recreating a button, input, disclosure, dialog, or tooltip | Verified Kumo component |
| Hand-built empty state | `Empty` |
| Custom loading rectangle | `SkeletonLine` or `Loader` |
| Native text with local typography classes | `Text` with semantic element and variant |
| Raw colors and local dark-mode rules | Semantic Kumo tokens |
| Deprecated unsuffixed Phosphor imports | Current `*Icon` exports |
| Product-specific visual variants on Kumo controls | Standard Kumo appearance plus clearer composition |
