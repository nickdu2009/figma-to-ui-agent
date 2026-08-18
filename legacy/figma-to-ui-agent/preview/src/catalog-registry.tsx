import {
  defineRegistry,
  type Components,
} from "@json-render/react";

import { previewCatalog } from "../../src/preview/catalog.ts";
import {
  Dialog,
  Conditional,
  Divider,
  Grid,
  Section,
  Stack,
  Spacer,
  Card,
  List,
  ListItem,
  Badge,
} from "./components/layout.tsx";
import {
  Image,
  PixelOverlay,
  Icon,
  Avatar,
} from "./components/media.tsx";
import {
  Button,
  Checkbox,
  Input,
  Link,
  Radio,
  Switch,
  Select,
  Textarea,
  FormField,
} from "./components/form-controls.tsx";
import { Text } from "./components/typography.tsx";
import { Nav, Tabs, TabPanel } from "./components/navigation.tsx";

const components = {
  Stack,
  Grid,
  Section,
  Dialog,
  Conditional,
  Text,
  Image,
  PixelOverlay,
  Button,
  Input,
  Checkbox,
  Link,
  Radio,
  Switch,
  Select,
  Textarea,
  FormField,
  Icon,
  Avatar,
  Spacer,
  Card,
  List,
  ListItem,
  Badge,
  Tabs,
  TabPanel,
  Nav,
  Divider,
} satisfies Components<typeof previewCatalog>;

export const { registry } = defineRegistry(previewCatalog, {
  components,
  actions: {
    dispatch: async () => undefined,
  },
});
