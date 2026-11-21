# Raised floor cut list

Web app (phone, tablet, PC) that generates a cut list, hardware list, tatami layout and 3D view for raised floors with IKEA-bin storage. Pocket-screw joinery, joists on edge, plywood deck, tatami on top.

## Run

```
npm install
npm run dev      # development
npm test         # unit tests for the cut-list engine
npm run build    # production build in dist/
```

Engine lives in `src/lib` (pure, tested); UI in `src/components`.

## Notes

- IKEA bin sizes are approximate; verify on ikea.com or use the custom size field.
- Load and weak-point results are estimates only, not engineered design. Confirm with a professional and your condo board / local code.

## Round 2 features
- **Polygon floors**: choose *Polygon*, then *Draw new shape* (click corners or type each wall), edit wall lengths in the edge table. Right-angled shapes only.
- **Front face**: tap an edge to make it the FRONT; drawers go on that side and joists run away from it.
- **Joists**: main-joist spacing = bin width + clearance; +/- steppers for main joists, cross joists and supports per joist. The Load tab warns and suggests (with Apply) when more are needed.
- **Plywood**: deck cut from 4x8 sheets in the fewest panels, with the heaviest panel's weight shown.
- **Layers**: show/hide and opacity sliders for joists, side panels, plywood, tatami, bins and drawers.
- **Tatami**: brick, basket, pinwheel and others (shugi-jiki / fushugi-jiki noted); a message appears if the floor can't fit one mat.
