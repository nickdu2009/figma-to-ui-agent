import type { UISpec } from "../../src/ui-spec/schema.ts";

export interface PropControl {
  name: string;
  type: "enum" | "boolean" | "string" | "number";
  options?: string[];
  defaultValue: unknown;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  isInt?: boolean;
}

export type ComponentCategory =
  | "layout"
  | "form"
  | "content"
  | "navigation"
  | "overlay";

export interface ComponentFixture {
  kind: string;
  nodeKind: string;
  category: ComponentCategory;
  title: string;
  description: string;
  initialSpec: UISpec;
  controllableProps: PropControl[];
}
