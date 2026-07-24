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

export interface ComponentFixture {
  kind: string;
  nodeKind: string;
  title: string;
  description: string;
  initialSpec: UISpec;
  controllableProps: PropControl[];
}
