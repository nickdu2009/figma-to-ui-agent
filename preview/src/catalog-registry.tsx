import {
  defineRegistry,
  type Components,
} from "@json-render/react";

import { previewCatalog } from "../../src/preview/catalog.ts";
import {
  Dialog,
  Divider,
  Grid,
  Section,
  Stack,
} from "./components/layout.tsx";
import {
  Image,
  PixelOverlay,
} from "./components/media.tsx";
import {
  Button,
  Checkbox,
  Input,
} from "./components/form-controls.tsx";
import { Text } from "./components/typography.tsx";

const components = {
  Stack,
  Grid,
  Section,
  Dialog,
  Text,
  Image,
  PixelOverlay,
  Button,
  Input,
  Checkbox,
  Divider,
} satisfies Components<typeof previewCatalog>;

export const { registry } = defineRegistry(previewCatalog, {
  components,
  actions: {
    dispatch: async () => undefined,
  },
});
