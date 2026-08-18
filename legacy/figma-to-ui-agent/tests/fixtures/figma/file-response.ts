export function createFigmaFileResponseFixture(): Record<string, unknown> {
  return {
    name: "Fixture file",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          name: "Product",
          type: "CANVAS",
          children: [
            {
              id: "1:1",
              name: "Home",
              type: "FRAME",
              visible: true,
              absoluteBoundingBox: {
                x: 0,
                y: 0,
                width: 1440,
                height: 900,
              },
              layoutMode: "VERTICAL",
              itemSpacing: 24,
              paddingTop: 32,
              paddingRight: 32,
              paddingBottom: 32,
              paddingLeft: 32,
              primaryAxisAlignItems: "MIN",
              counterAxisAlignItems: "CENTER",
              styles: {
                fill: "style-fill",
              },
              fills: [
                {
                  type: "SOLID",
                  color: { r: 1, g: 1, b: 1 },
                  opacity: 1,
                },
              ],
              children: [
                {
                  id: "1:2",
                  name: "Title",
                  type: "TEXT",
                  characters: "Welcome",
                  style: {
                    fontFamily: "Inter",
                    fontSize: 32,
                    fontWeight: 700,
                    lineHeightPx: 40,
                    letterSpacing: 0,
                    textAlignHorizontal: "LEFT",
                  },
                  styles: {
                    text: "style-text",
                  },
                  boundVariables: {
                    fontSize: {
                      type: "VARIABLE_ALIAS",
                      id: "VariableID:font-size",
                    },
                  },
                },
                {
                  id: "1:3",
                  name: "Layer 1",
                  type: "RECTANGLE",
                  absoluteBoundingBox: {
                    x: 32,
                    y: 100,
                    width: 640,
                    height: 480,
                  },
                  fills: [
                    {
                      type: "IMAGE",
                      imageRef: "image-source-1",
                    },
                  ],
                },
                {
                  id: "1:4",
                  name: "Continue",
                  type: "INSTANCE",
                  componentId: "component-main",
                  componentProperties: {
                    State: {
                      type: "VARIANT",
                      value: "Disabled",
                    },
                    "Show icon": {
                      type: "BOOLEAN",
                      value: true,
                    },
                    Label: {
                      type: "TEXT",
                      value: "Continue",
                    },
                  },
                  variantProperties: {
                    State: "Disabled",
                    Size: "Medium",
                  },
                },
                {
                  id: "1:6",
                  name: "Vector layer",
                  type: "VECTOR",
                  absoluteBoundingBox: {
                    x: 40,
                    y: 120,
                    width: 520,
                    height: 460,
                  },
                  fills: [
                    {
                      type: "SOLID",
                      color: {
                        r: 0.9,
                        g: 0.95,
                        b: 1,
                      },
                      opacity: 0.75,
                    },
                  ],
                },
                {
                  id: "1:5",
                  name: "Unsupported",
                  type: "WIDGET",
                },
              ],
            },
          ],
        },
        {
          id: "0:2",
          name: "Settings",
          type: "CANVAS",
          children: [
            {
              id: "2:1",
              name: "Settings",
              type: "FRAME",
              absoluteBoundingBox: {
                x: 1600,
                y: 0,
                width: 1024,
                height: 768,
              },
              children: [],
            },
          ],
        },
      ],
    },
    components: {
      "component-main": {
        key: "component-key",
        name: "Primary button",
        description: "Primary action",
      },
    },
    componentSets: {},
    styles: {
      "style-fill": {
        key: "style-fill",
        name: "Surface",
        styleType: "FILL",
      },
      "style-text": {
        key: "style-text",
        name: "Heading",
        styleType: "TEXT",
      },
    },
  };
}
