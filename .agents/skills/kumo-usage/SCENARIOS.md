# Experience Scenarios

Choose a scenario by the user's goal, required information, and available actions. Use nearby Gadgets UI only as an information-architecture reference; verify every API independently.

## Product overview

Users need to understand current product state and decide what to do next. Provide concise identity, relevant status or resources, one clear primary action, and applicable loading, empty, error, and permission states.

## Resource collection and discovery

Users need to find, compare, create, or act on resources. Provide resource identity and distinguishing information. Keep search, filters, and collection actions together immediately before results. Preserve controls in filtered-empty states.

## Resource detail and management

Users need to understand one resource and perform common actions. Show identity, parent scope, relevant status, key configuration, and actions with emphasis matching importance. Separate destructive actions from routine actions.

## Analytics and monitoring

Users need to evaluate behavior and decide whether to investigate. Establish scope, timeframe, units, and the key result before supporting charts or tables. Handle no-data and partial-data distinctly from errors.

## Settings and configuration

Users need to understand and change behavior. Organize around user tasks rather than backend objects. Show current values, persistent labels, consequences, validation, pending, success, failure, and permission handling.

## Create or edit workflow

Users need to supply information and complete a focused change. Order fields by decision flow, keep labels persistent, preserve entered values after failure, and provide clear submit, cancellation, validation, pending, and success behavior.

## Destructive action

Users need to understand a consequence and deliberately confirm or cancel. Name the affected resource, explain reversibility, separate the destructive action visually, and handle authorization, pending, failure, and completion.

## State meanings

| State | Treatment |
| --- | --- |
| Loading | Preserve expected geometry with the component's loading state, `SkeletonLine`, or `Loader` |
| Initial empty | Explain what belongs here and provide the next action when available |
| Filtered empty | Preserve controls, explain that nothing matches, and allow criteria to be cleared |
| Partial data | Keep useful content and identify the unavailable region |
| Error | Explain failure at its actual scope and provide retry when useful |
| Permission denied | Explain the unavailable capability without controls that will always fail |
| Validation | Associate actionable guidance with the affected field and preserve input |
| Pending | Prevent duplicate actions and communicate progress at the initiating control |
| Success | Reflect updated state and confirm only when the result is not otherwise evident |

Never substitute an empty state for an error or permission state.
