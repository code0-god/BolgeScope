# BolgeScope desktop design

## 0. Research log
- Product brief: `docs/desktop-v0.1/02_UX_SPEC.md` fixes the IDE anatomy, Korean default, 1440×900 reference, and compact behavior.
- Embedded design reference: an operational code editor, with dense neutral chrome and restrained copper execution accents. No external assets, fonts, or network resources are permitted.
- Live screen research and generated concepts omitted: the fixed product layout and offline asset constraint already provide the visual contract.

## 1. Direction
A quiet instrument panel for reading a self-modifying machine. Source is a broad uninterrupted canvas; copper marks the current instruction, teal marks authored source, and violet marks retained history. Runtime data is always in a separate read-only surface.

## 2. Tokens
- Surfaces: canvas `#111316`, chrome `#191c20`, raised `#22262b`, hover `#2b3036`, rule `#363b40`.
- Text: primary `#e9e8e4`, secondary `#a9adaf`, muted `#858b8f`.
- Semantic: copper `#e6a36f`, teal `#70c4b6`, violet `#b4a7df`, error `#ed8c82`, success `#8bc5a6`.
- Typography: system UI 13px regular for chrome; SFMono/Menlo/ui-monospace 13px for data and source; tabular numerals.
- Spacing: 4px base, 12px standard inset, 20px section separation. Heights: toolbar 48px, status 26px, tab strip 36px.
- Borders: 1px rules, 5px control radius, 8px surface radius. No gratuitous shadows.

## 3. Layout
Desktop: 192px explorer, flexible central editor, 300px inspector; 250px bottom dock. Explorer and inspector can be hidden independently. At 1100px the explorer defaults hidden; at 900px the inspector becomes an overlay-sized tab and bottom dock uses 180px. Main editor always has a 360px minimum when space permits. Every pane owns its scroll.

## 4. Motion and states
Only execution-point changes use a brief 120ms highlight. Reduced motion removes it. Controls have hover, focus-visible, active, and disabled styles; statuses include text labels. Input wait and faults get high-priority text messages. No animation of fabricated intermediate VM states.

## 5. Primitives
- `ToolButton`: small iconless text button, neutral/primary/danger states, 32px target.
- `Pane`: heading and optional actions, scrollable content.
- `TabStrip`: selected underline plus `aria-selected`.
- `DataRow`: mono key/value, tabular aligned value, change tint.
- `StatusPill`: reason text plus semantic color; color never sole signal.
- `AddressCell`: raw/symbol/address with selected and execution states.
- `DockPanel`: switchable I/O, timeline, memory, problems and tests content.

## 6. Accessibility
All buttons have text or accessible names, pane headings are semantic, keyboard focus is visible, controls stay operable at 200% zoom, and memory table is an accessible alternative to the overview. Shortcut handling ignores IME composition and editable fields where appropriate. Korean and English strings fit controls without clipping.

## 7. Accepted debt
Native WKWebView layout and VoiceOver require installed-app evidence. Browser screenshot inspection is useful but cannot close those checks.
