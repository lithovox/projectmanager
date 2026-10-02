# ProjectManager

LithoVox ProjectManager: a Vite + TypeScript (no framework) app with a Leaflet
map. Run with `npm run dev`; `npm run build` type-checks (`tsc`) and builds.

## Code organisation

- **One domain concept per file/class.** As soon as a data type gets behaviour
  beyond plain storage (computed values, validation, conversion to/from the
  saved format, invariants), move it into its own file as a class, e.g.
  `src/referenceLine.ts` (`ReferenceLine`: chainage, length, `toData()`,
  `isData()`). Keep plain interfaces only for pure data shapes.
- **Rules that span a collection live in the owner, not the item.** E.g.
  unique names and "exactly one chainage line" are enforced by `Project`
  (`src/project.ts`), not by `ReferenceLine`.
- `project.ts` holds the project model and the saved file format
  (`ProjectFile`); `projectController.ts` wires UI events to it;
  `views/` holds the views (e.g. `mapView.ts`). Views receive model objects to
  display and report user actions through callbacks; they don't change the
  model themselves.

## Conventions

- **Coordinates:** stored in RD (EPSG:28992, metres); convert to WGS84 only for
  display (`src/rd.ts`).
- **i18n:** every user-visible string goes in `src/i18n/en.ts` and is used via
  `t()` / `data-i18n` / `data-i18n-title`. A Dutch translation will be added,
  so never hard-code UI text. Format distances with `formatMetres()`.
- **Styling:** use the CSS tokens in `src/style.css` (shared with geoscanner);
  every colour must work in both the light and the dark theme.
- **Saved projects:** keep older project files loadable; make new fields
  optional when validating and fill in defaults when loading.
- **Persistence:** projects live in the LithoVox API database (per user, see
  `src/projectApi.ts`); `ProjectSync` (`src/projectSync.ts`) tracks the open
  project and unsaved changes. Nothing is sent to the database except by the
  Save button. Height raster GeoTIFFs are stored separately and referred to
  from the project file by `id`.
- `tsconfig` has `erasableSyntaxOnly`: no constructor parameter properties or
  enums.
