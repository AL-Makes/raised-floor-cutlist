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
