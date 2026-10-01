// English strings. This is the reference dictionary: other languages must
// provide the same keys (enforced by the `Messages` type).
export const en = {
  "nav.map": "Map",
  "nav.tables": "Tables",
  "theme.switchToLight": "Switch to light theme",
  "theme.switchToDark": "Switch to dark theme",
  "tables.title": "Tables",
  "tables.comingSoon": "Tables will be available soon.",
  "project.new": "New Project",
  "project.save": "Save Project",
  "project.load": "Load Project",
  "project.confirmNew": "Start a new project? This discards the current project.",
  "project.invalidJson": "Could not read project file: invalid JSON.",
  "project.notAProject": "This file doesn't look like a ProjectManager project.",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "referenceLine.upload": "Upload Referenceline",
  "referenceLine.uploadTitle": "Upload Referenceline Shapefile (.shp, .shx, .dbf) in RD coordinates",
  "referenceLine.uploadDialogTitle": "New Referenceline",
  "referenceLine.editDialogTitle": "Edit Referenceline",
  "referenceLine.nameDialogHint": "Enter a unique name for this referenceline.",
  "referenceLine.isChainageLine": "Chainage line",
  "referenceLine.chainageFirstLine": "The first referenceline is always the chainage line.",
  "referenceLine.chainageAlready": "This is the chainage line. To change it, open another line and make that the chainage line.",
  "referenceLine.chainageReplaces": "Only one line can be the chainage line; this replaces \"{name}\".",
  "referenceLine.nameLabel": "Name",
  "referenceLine.nameRequired": "Enter a name.",
  "referenceLine.nameTaken": "A referenceline named \"{name}\" already exists.",
  "shapefile.missingFiles": "Select the {files} file(s) too.",
  "shapefile.mismatchedFiles": "The .shp, .shx and .dbf files must belong to the same shapefile.",
  "shapefile.unreadable": "Could not read that shapefile.",
  "units.metres": "{value} m",
  "shapefile.noLine": "The shapefile has no usable line geometry.",
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
