# Graph Crossings

> An Obsidian plugin for visualizing your vault's note connections as an interactive graph.

## About

**Status:** Work in Progress / Temporary

This plugin provides interactive graph visualization of your vault's note connections using force-directed layout physics.

### Features

- **Custom Graph View**: Interactive canvas-based graph visualization of your vault's connections
- **Force-Directed Layout**: Physics-based node positioning with:
  - Repulsion (nodes push apart)
  - Attraction (linked nodes pull together)
  - Centering force (keeps graph centered)
  - Friction and damping for stable convergence
- **Interactive Controls**: 
  - Zoom and pan with mouse wheel and drag
  - Adjust layout parameters in real-time via sliders
  - Reset to defaults button
- **Ghost Nodes**: Auto-create missing notes for unresolved links

### Future
- **Graph crossing minimization**

### Development

Requirements: Node.js v18+

Build the plugin:
```bash
npm run build
```

### Architecture

- `src/main.ts` — Plugin entry point and command registration
- `src/settings.ts` — Settings UI with force parameter controls
- `src/graph.ts` — Graph building, optimization, and path normalization
- `src/custom-graph-view.ts` — Canvas rendering and interaction

### Type Safety

All code is TypeScript strict-mode compliant (`tsc --noEmit` passes).

## License

MIT
