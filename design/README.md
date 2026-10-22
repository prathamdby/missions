# Design system

`design/tokens.json` is the only place design values are defined. It was extracted from the Paper file **Factory → Missions → Design System / Foundations** (tokens content hash `5632a443`). Paper has no token types for motion and layers, so those come from the "Motion & layers" panel on the same artboard.

## Changing tokens

1. Edit `design/tokens.json`.
2. Run `pnpm design:tokens` to regenerate `apps/web/src/styles/tokens.css`. Never edit that file by hand; `pnpm design:check` fails when it is stale.

The generated stylesheet resets Tailwind's default palette, type scale, radii, shadows, breakpoints, containers, easing, and animations, so only manifest tokens produce classes.

## Naming

| Paper name | CSS variable | Utility |
| --- | --- | --- |
| `--spacing-md` | `--spacing-md` | `p-md`, `gap-md` |
| `--duration-fast` | `--transition-duration-fast` | `duration-fast` |
| `--z-sticky` | `--z-index-sticky` | `z-sticky` |
| `--press-scale` | `--scale-press` | `scale-press` |
| Text styles (display, title, …) | — | `type-display`, `type-body`, … |

Numeric sizing (`size-4`, `w-60`) uses the 4px base in whole or half steps. Spacing (padding, margin, gap, space) uses only the named scale.

shadcn semantic slots (`background`, `primary`, `muted`, …) alias Paper colors. The shadcn `accent` slot is intentionally missing because Paper's `accent` is Factory orange. Primitives use `surface-overlay` for hover.

## Enforcement

`pnpm check` runs Ultracite (Oxlint + Oxfmt) with all six `@shadcn/lint` rules at error, plus two project rules from `design/lint/plugin.ts` that apply to `apps/web`:

- `missions-design/no-off-scale-spacing` rejects numeric spacing (`p-2`, `p-3.25`), arbitrary margins and gaps, and quarter-step sizing.
- `missions-design/no-unauthorized-variables` rejects `var(--x)` and `(--x)` references that are not manifest tokens.

`pnpm design:check` also checks authored CSS (`design/contract/css.ts`): no `@theme` blocks, new custom properties, unknown or fallback `var()` references, raw colors, or raw values for spacing, type, radius, shadow, z-index, opacity, or motion.

### Documented exceptions

- `**/components/ui/**`: the Ultracite shadcn preset turns off `no-arbitrary-values`, `no-restyle`, and `require-static-classes` inside primitives, which own their appearance. `no-raw-colors`, `no-inline-styles`, `no-unknown-classes`, and both project rules stay on.
- Design tooling under `design/` builds variable names on purpose, so the project rules do not apply there.

Do not disable a rule to make code pass. Add a token, a component variant, or a documented exception here.

## Fixtures

`tests/design` proves every rule works:

- `fixture-app/` is linted with the real web config and theme. Each `src/cases/invalid` file must fail for exactly the rule named in its `// expect:` header. Each `src/cases/valid` file must pass everything. Its config file name keeps `ultracite check` from discovering it, and the root config ignores the directory.
- `css/` holds valid and invalid stylesheets for the CSS contract.
