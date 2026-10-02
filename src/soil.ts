/** How a soil is stored in a project file. */
export interface SoilData {
  name: string;
  /** Display colour (CSS colour, e.g. "#b9d4b4"). */
  color: string;
}

/**
 * A soil type, e.g. "hollandveen", with the colour it is drawn in.
 * Uniqueness of names is a project-wide rule, enforced by Project.
 */
export class Soil {
  readonly name: string;
  color: string;

  constructor(name: string, color: string) {
    if (name.trim() === "") throw new Error("A soil needs a name");
    this.name = name;
    this.color = color;
  }

  toData(): SoilData {
    return { name: this.name, color: this.color };
  }

  static isData(value: unknown): value is SoilData {
    const s = value as SoilData | null;
    return (
      !!s &&
      typeof s === "object" &&
      typeof s.name === "string" &&
      s.name.trim() !== "" &&
      typeof s.color === "string"
    );
  }
}
