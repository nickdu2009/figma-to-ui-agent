export {
  applyJsonPatch,
  isJsonPatchOperation,
  type JsonPatchOperation,
} from "./stream/json-patch.js";
export { parsePointer, readPointer } from "./stream/json-pointer.js";
export { compileJsonlPatch } from "./stream/jsonl-compiler.js";
export { readSource } from "./stream/source.js";
export type {
  NextAppSpecSource,
  SourceInput,
  SourceResult,
} from "./contract/types.js";
