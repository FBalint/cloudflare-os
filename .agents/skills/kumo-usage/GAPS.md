# Kumo Gap Process

Use this process only when required product behavior cannot be implemented with an established product component, a public installed Kumo component, their composition, or a noninteractive layout.

## What is a gap

A gap exists when required semantics or behavior is missing, such as:

- No component supports the required interaction model
- A component lacks required accessibility or state behavior
- Installed exports or declarations disagree with documented behavior
- A stable reusable product composition is needed and no current owner exists

These are not gaps:

- Incidental spacing differs from a mock
- A new color, radius, size, or visual variant is desired
- A documented API requires adapting data or callbacks
- A custom implementation appears faster
- Legacy UI has no one-to-one Kumo equivalent

## Required investigation

1. Restate the required user behavior without naming a component.
2. Search installed Kumo exports and declarations by behavior and semantics.
3. Consult the relevant page linked from `https://kumo-ui.com/llms.txt`.
4. Search current Gadgets code for a supported composition solving the same scenario.
5. Determine whether a noninteractive `div` layout is sufficient.
6. Confirm composition cannot solve the requirement while preserving Kumo-owned appearance and behavior.

## Narrowest response

- Use a local composition when behavior is product-specific and public Kumo components can provide its primitives.
- Propose a shared product component only when multiple surfaces need stable shared behavior.
- Escalate to Kumo when missing behavior belongs in a reusable design-system primitive.
- Use a temporary product exception only when the user accepts the tradeoff and the requirement cannot wait.

## Gap record

```text
Required behavior:
User impact:
Kumo APIs checked:
Existing product patterns checked:
Why composition is insufficient:
Recommended owner: product | shared product UI | Kumo
Proposed temporary handling:
Follow-up required:
```

Never silently build raw interactive controls that duplicate Kumo, introduce raw colors or custom dark-mode behavior, copy Kumo internals, create an unofficial variant, or omit required accessibility and state behavior.
