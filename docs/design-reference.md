# Option A design reference

Reference analysis, 2026-11-08. This is a visual specification derived from the supplied mockups, not evidence that the illustrated audit, sandbox, MCP, or provider features exist. The four outside screenshots explicitly say “Option A,” and the ZIP contains matching `orven_option_a_*` screens and HTML, so identification is unambiguous. Mockup text, counters, paths, security guarantees, and connected states are illustrative; use real data or an explicit unavailable state in product UI.

## Source inventory

| Screen | Screenshot in repository | ZIP entry (relative to `stitch_orven_desktop_engineering_workspace/`) | Visible composition |
| --- | --- | --- | --- |
| Engineering audit report | [16.55.46](../reference/Screenshot%202026-11-06%20at%2016.55.46.png) | `orven_option_a_engineering_audit_report/{screen.png,code.html}` | Editorial report, four summary metrics, filter toolbar, expanded finding with diff and collapsed rows. |
| Audit workspace | [16.55.50](../reference/Screenshot%202026-11-06%20at%2016.55.50.png) | `orven_option_a_audit_workspace_live_execution/{screen.png,code.html}` | Three-pane workspace, stage progress, ledger, context inspector. |
| Connections and security | [16.56.07](../reference/Screenshot%202026-11-06%20at%2016.56.07.png) | `orven_option_a_connections_security_boundaries/{screen.png,code.html}` | Four-column status strip, paired connection panes, exclusion section, access ledger. |
| Audit history | [16.56.12](../reference/Screenshot%202026-11-06%20at%2016.56.12.png) | `orven_option_a_audit_history_diffing/{screen.png,code.html}` | Five snapshot cards and proportion bars, run table, two-column comparison. |

Archive: [original ZIP](../reference/stitch_orven_desktop_engineering_workspace.zip). It also includes `editorial_precision/DESIGN.md`. Screenshots are 1460×1480, 1490×1232, 1216×1214 and 1240×1310 pixels respectively; they include a surrounding presentation frame. The ZIP screenshots are rendered views (2560×2562 report, 1600×1280 workspace, 2560×2416 security, 2560×2572 history). The history capture contains black area below the app; do not interpret that as product canvas. The outer screenshots and ZIP views depict the same four screen families, though content density and crop differ. ZIP HTML is a static visual reference, not a runnable product contract.

## Shared shell and geometry

Use the declared HTML/CSS dimensions as design targets, rather than pixel dimensions inferred from scaled screenshots: **38px** top bar, **240px** left rail, flexible center, and **340px** right inspector on the workspace screen. The design note gives rail 180–360px, inspector 280–480px, center minimum 540px. Under 980px it proposes an inspector overlay; actual responsive behavior remains untested. Bottom status bar is thin and persistent in the renderings. Top bar has macOS controls, Orven and repository breadcrumb, navigation tabs with black active underline, compact status/search, utility icons and a black primary action. The rail uses workspace list, divider, section label, icon navigation, pale gray selected row and a 2px black left marker; footer contains quiet settings/status. Workspace has a lower rail action and a full-height inspector. Avoid drawing fake native window controls if native chrome supplies them.

HTML spacing tokens: 4px (`space-xs`), 6px (`space-sm`), 12px (`space-md`/gutter), 16px margin, 20px (`space-lg`), 32px (`space-xl`). Dense tree rows are specified at 24px and finding list rows at 32px; 1px rules separate panes and table rows. Main report uses a generous editorial inset; workspace ledger and inspector are much denser. Controls have approximately 4px corners; badge/code tokens 3px. Panels are flat, bordered, square-edged and have no decorative shadow.

## Type and color

The source HTML declares Geist for UI, Newsreader for editorial headings/prose, and JetBrains Mono for IDs, metrics, paths, code and keyboard hints. Declared sizes/line heights: title 30/38px, section title 22/30px, UI section heading 15/20px semibold, editorial body 15/24px, UI body 13/19px, UI caption 11/15px, code 12/17–18px, metric 11/14px, keyboard hint 10/12px. Use tabular numerals for identifiers and tables. Font delivery and Korean glyph coverage must be verified locally; the HTML references external Google Fonts and a Tailwind CDN, which are not an offline implementation strategy.

The HTML tokens use canvas `#f9f9f8`, white document `#ffffff`, rail `#f3f4f3`, subdued pane `#eeeeed`, primary ink `#1a1c1c`, secondary ink `#46464b`, outline `#c7c6cb`, black primary `#000000`, blue `#2252ca`, error `#ba1a1a`, green `#399464`. The accompanying prose describes a slightly different warm palette (`#fbfbfa`, `#f5f5f3`, `#eaeae7` dividers and `#111215` ink); treat the HTML tokens as the concrete starting point and visually compare with screenshots. Semantic examples from the prose: green `#16794c` on `#ebf7ee`, red `#d9383a` on `#fdf2f2`, amber `#d97706` on `#fef8ec`, blue `#3b66de` on `#eef2fd`. Colors must accompany text or symbols, not be the sole status cue. Dark tokens in the design note have no matching supplied screenshot, so dark appearance remains unverified.

## Per-screen patterns

- **Report:** session/commit metadata over a large serif title and 15px editorial summary; thin rule; four equal summary cells with small mono labels and horizontal status bars; filter pills and right-aligned actions; one expanded white finding with a red left rail, metadata badges, path, serif narrative and bordered line-numbered diff. Subsequent findings are compact bordered rows. Reference claims and remediation actions require real support before display.
- **Workspace:** target metadata strip above a four-stage, equal-column progress region; compact filter/header followed by a five-column, hairline-separated ledger. Selected row has gray fill and a dark edge. Inspector contains stacked bordered sections, dark code fragment, explanatory text and bottom-pinned actions. Use real execution states; the static example's live AST stream is not verified capability.
- **History:** section header and actions; bordered panel with five small commit cards containing three-color bars, plus a right-side rate panel with horizontal bars. Below is a multi-column runs ledger with selected row, compact status badges, footer pagination, then a two-column comparison pane. Charts are labeled, low-height bars; no axes are shown. Do not fabricate trends or comparisons where only one or no run exists.
- **Connections/security:** large editorial introduction and four adjacent status cells, then two equal bordered connection cards, paired policy/exclusion areas, and a multi-column access ledger. The reference contains live-connection, zero-network and isolation claims that have not been demonstrated; show unavailable/unknown where applicable.

## Overlay and interaction references

No overlay is visible in the four screenshots. `DESIGN.md` proposes a centered 580px command palette with white fill, 1px `#dfdfdc` border, 8px radius and restrained shadow `0 8px 24px -4px rgba(17,18,21,.06), 0 2px 6px -1px rgba(17,18,21,.03)`; an inspector overlay below 980px is also proposed. Both are specification-only, not captured behavior. Buttons, shortcuts, filters and tabs in the mockups are visual examples; do not suggest unsupported actions are functional.

## HTML structure and discrepancies

Each ZIP HTML file uses a `header`, 240px `aside`, `main`, and (workspace only) a 340px inspector `aside`; lists/tables and section headers are composed using utility classes. HTML embeds sample content and imports remote fonts, icon fonts and CDN JavaScript. The static mockups contain occasional clipping/wrapping (notably security status text) and the history image crops its bottom comparison. Preserve the visual hierarchy while testing usable text wrapping, keyboard focus and actual window sizes. Visual reference inspection alone does not verify native Tauri behavior, accessibility, color contrast or runtime connectivity.
