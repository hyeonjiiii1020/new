# 한국육상매거진 카드 스튜디오 디자인 시스템

## 0. Direction

Editorial sports publishing: clear information hierarchy, generous paper-like space, and a restrained athletics accent. The timetable cover uses navy ink, pale sky blue, warm ivory, and a small fresh-green signal so it feels like a printed meet guide rather than a generic app screen.

## 1. Canvas Tokens

- Canvas: `1080x1350`
- Safe margin: `64px` minimum; keep important text inside `70px` from each edge.
- Cover paper: `#f7f3e9`
- Cover ink: `#082d63`
- Cover sky: `#b8d5e8`
- Cover pale sky: `#e7f0f6`
- Cover signal: `#c9d99e`
- Credit ink: `#3f4a55`
- Base spacing: `8px`

## 2. Typography

- Display: system Korean sans, weight `950`, used only for `경기시간표`.
- Headline: system Korean sans, weight `900`, used for the competition name.
- Metadata: system Korean sans, weight `800`.
- Supporting label: system Korean sans, weight `700` with `0.08em` tracking.
- Text must use fit-to-width helpers; no important Korean text may overflow the safe margin.

## 3. Cover Anatomy

1. Top metadata row: day on the left, date on the right.
2. Editorial masthead: two fine rules and a small diamond above the title.
3. Main title: large centered `경기시간표`.
4. Competition name: centered below the title with automatic multiline fitting.
5. Bottom information band: `TRACK` and `FIELD` labels plus a light-green schedule signal.
6. Lower-right source credit: `한국육상매거진`.

## 4. Surface Rules

- Use layered paper, ink, and line treatments instead of heavy shadows.
- Use curved track lines as the single signature visual; no clip-art or decorative character.
- Keep the title and date readable when exported to Instagram feed previews.
- Cover is a real canvas composition, not a pasted screenshot or source timetable image.

## 5. Reusable Primitives

- `drawFitText`: fit single-line labels to a bounded width.
- `drawCenteredMultiline`: wrap and fit Korean display copy without clipping.
- `drawScheduleCredit`: consistent source attribution on every timetable card.
- `renderScheduleCoverCanvas`: reusable cover layout driven by title/day/date metadata.
- Schedule table renderers: preserve the existing track/field table contract.

## 6. Accessibility And QA

- The web controls retain semantic labels and keyboard focus behavior.
- Exported canvas copy is checked through actual browser screenshots and PNG dimension validation.
- QA breakpoints: 375px, 768px, and 1280px browser widths; export remains fixed at `1080x1350`.
