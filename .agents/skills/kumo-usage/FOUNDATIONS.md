# Kumo Design Foundations

Apply these foundations before choosing components.

## Page brief

For a new page or material layout change, establish:

```text
User:
Primary task:
Successful outcome:
Primary action:
Supporting actions:
Content hierarchy:
Required states:
Permission constraints:
Responsive priorities:
Performance constraints:
Closest scenario:
Existing pattern to preserve:
```

Keep the brief short. Its purpose is to force product decisions before JSX.

## Principles

### Start from the task

Describe what users must understand or accomplish before deciding whether the page needs cards, tabs, a table, a tree, or a form.

### Establish one dominant hierarchy

The page identity, primary task, most important information, and next action should be obvious through content order and grouping. Do not use decoration to repair unclear structure.

### Group by user intent

Keep information and controls together when users need them for the same decision. Surfaces represent meaningful containment or elevation, not decoration around every section.

### Reveal complexity progressively

Show what the common path requires and defer advanced or destructive options. Do not hide information users need to make a safe decision.

### Design the complete state model

Plan applicable loading, initial-empty, filtered-empty, partial-data, error, permission, pending, validation, and success states. Keep the page frame stable where possible.

### Reflow by priority

On narrow layouts, preserve the primary task and action first. Stack related regions and move secondary content later rather than shrinking controls or body text.

### Make accessibility structural

Use semantic Kumo components, logical heading order, persistent labels, keyboard-operable controls, visible focus, and appropriate status communication from the start.

### Let Kumo own appearance

Use Kumo variants, tokens, states, and composition as designed. Product code arranges components and supplies behavior; it does not fork the design system through local CSS.

### Keep polish fast

Prefer Kumo, CSS, and simple composition over custom dependencies, heavy effects, excessive DOM, or unnecessary animation. Avoid layout shifts and delayed interaction.
