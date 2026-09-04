# Context Gatekeeper Frontend

This separately bundled React SPA follows the applicable frontend conventions in
`../../workshop-frontend/AGENTS.md`, especially its guidance for component boundaries, component
APIs, Kumo and styling, icons, React, comments, and tests.

Adapt the Workshop organization conventions as follows:

- Treat `app/` as this SPA's source root.
- Put substantial new screens and their page-specific support code under `app/pages/<page>/`.
- Keep page directories flat until a coherent subsystem has enough files to justify nesting.
- Use `Page.tsx` suffixes for screen components and colocate focused tests with their subjects.
- Keep the entrypoint and app-wide infrastructure such as bridge, theme, and error handling at the
  app root.
- This app has no client router. Do not introduce URL or host-navigation infrastructure without an
  explicit product requirement and an agreed Workshop integration design.

Existing files that predate this organization are not precedent and should not be moved during
unrelated work.
