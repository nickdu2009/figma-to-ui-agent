export function createFigmaVariablesResponseFixture(): Record<
  string,
  unknown
> {
  return {
    meta: {
      variableCollections: {
        "VariableCollection:primitives": {
          id: "VariableCollection:primitives",
          name: "Primitives",
          defaultModeId: "Mode:light",
          modes: [
            { modeId: "Mode:light", name: "Light" },
            { modeId: "Mode:dark", name: "Dark" },
          ],
        },
      },
      variables: {
        "VariableID:font-size": {
          id: "VariableID:font-size",
          name: "Typography / Body Size",
          variableCollectionId: "VariableCollection:primitives",
          resolvedType: "FLOAT",
          valuesByMode: {
            "Mode:light": 32,
            "Mode:dark": 34,
          },
          codeSyntax: {
            WEB: "var(--body-size)",
            ANDROID: "body_size",
            iOS: "bodySize",
          },
        },
        "VariableID:surface-dark": {
          id: "VariableID:surface-dark",
          name: "Color / Surface Dark",
          variableCollectionId: "VariableCollection:primitives",
          resolvedType: "COLOR",
          valuesByMode: {
            "Mode:light": { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            "Mode:dark": { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          },
        },
        "VariableID:surface": {
          id: "VariableID:surface",
          name: "Color / Surface",
          variableCollectionId: "VariableCollection:primitives",
          resolvedType: "COLOR",
          valuesByMode: {
            "Mode:light": { r: 1, g: 1, b: 1, a: 1 },
            "Mode:dark": {
              type: "VARIABLE_ALIAS",
              id: "VariableID:surface-dark",
            },
          },
        },
      },
    },
  };
}
