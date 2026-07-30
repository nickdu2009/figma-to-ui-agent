import { describe, expect, it } from "vitest";

import {
  PreviewAdapterError,
  toPreviewJsonSpec,
} from "../../../src/preview/json-render-adapter.ts";
import { uiSpecSchema } from "../../../src/ui-spec/schema.ts";
import {
  FIXTURE_ASSET_PATH,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

describe("toPreviewJsonSpec", () => {
  it("只生成页面可达的受控 Catalog 元素、状态绑定和声明动作", () => {
    const uiSpec = uiSpecSchema.parse({
      ...createUISpecDraft(),
      revision: 1,
    });
    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.root).toBe("root");
    expect(Object.keys(preview.elements)).toEqual([
      "root",
      "title",
      "image",
      "continue",
    ]);
    expect(preview.elements.image).toMatchObject({
      type: "Image",
      props: {
        src: expect.stringMatching(/^\/project-image\/figma\/assets\//),
      },
    });
    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: {
        disabled: false,
      },
      on: {
        press: {
          action: "dispatch",
          params: { actionId: "stay-home" },
        },
      },
    });
    expect(JSON.stringify(preview)).not.toContain("http");
    expect(JSON.stringify(preview)).not.toContain("<script");
    expect(JSON.stringify(preview)).not.toContain("style");
  });

  it("归一化三类禁用控件并移除禁用按钮动作", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.disabled = true;
    }
    draft.state.push(
      {
        key: "email",
        valueType: "string",
        initialValue: "",
      },
      {
        key: "accepted",
        valueType: "boolean",
        initialValue: false,
      },
    );
    draft.nodes.push(
      {
        id: "email",
        kind: "input",
        label: "邮箱",
        stateKey: "email",
        inputType: "email",
        disabled: true,
        designValueRefs: [],
      },
      {
        id: "accepted",
        kind: "checkbox",
        label: "接受",
        stateKey: "accepted",
        disabled: true,
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("email", "accepted");
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: { disabled: true },
    });
    expect(preview.elements.continue?.on).toBeUndefined();
    expect(preview.elements.email).toMatchObject({
      type: "Input",
      props: { disabled: true },
    });
    expect(preview.elements.accepted).toMatchObject({
      type: "Checkbox",
      props: { disabled: true },
    });
  });

  it("把 visibleWhen 节点包成 Conditional 并重写父子引用", () => {
    const draft = createUISpecDraft();
    draft.state.push({
      key: "variant",
      valueType: "string",
      initialValue: "source",
    });
    const title = draft.nodes.find((node) => node.id === "title");
    if (title) {
      title.visibleWhen = {
        stateKey: "variant",
        equals: "target",
      };
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.root).toBe("root");
    expect(preview.elements.root?.children).toEqual([
      "__conditional__title",
      "image",
      "continue",
    ]);
    expect(preview.elements.__conditional__title).toMatchObject({
      type: "Conditional",
      props: {
        stateKey: "variant",
        equals: "target",
      },
      children: ["title"],
    });
    expect(preview.elements.title).toMatchObject({
      type: "Text",
    });
  });

  it("绝对定位 form_field 内的输入框隐藏内置标签", () => {
    const draft = createUISpecDraft();
    draft.state.push({
      key: "fullName",
      valueType: "string",
      initialValue: "",
    });
    draft.nodes.push(
      {
        id: "full-name-field",
        kind: "form_field",
        label: "Full Name",
        childIds: ["full-name-input"],
        style: {
          position: "absolute",
          left: 120,
          top: 200,
          width: 600,
          height: 95,
        },
        designValueRefs: [],
      },
      {
        id: "full-name-input",
        kind: "input",
        label: "Full Name",
        stateKey: "fullName",
        inputType: "text",
        placeholder: "Enter your Full Name here",
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("full-name-field");
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements["full-name-input"]).toMatchObject({
      type: "Input",
      props: { hideLabel: true },
    });
  });

  it("映射 button 图标资产和 pixel_overlay", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.leadingIconAssetRef = FIXTURE_ASSET_PATH;
      button.trailingIconAssetRef = FIXTURE_ASSET_PATH;
    }
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }
    draft.nodes.push({
      id: "overlay",
      kind: "pixel_overlay",
      assetRef: FIXTURE_ASSET_PATH,
      alt: "装饰覆盖层",
      width: 320,
      height: 180,
      frame: { x: 10, y: 20, width: 160, height: 90 },
      childIds: ["overlay-caption"],
      designValueRefs: [],
    });
    draft.nodes.push({
      id: "overlay-caption",
      kind: "text",
      text: "覆盖层内结构化文本",
      variant: "caption",
      designValueRefs: [],
    });
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
      imageMetadata: (path) =>
        path === FIXTURE_ASSET_PATH
          ? { width: 640, height: 480 }
          : undefined,
    });

    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: {
        leadingIconSrc: expect.stringMatching(
          /^\/project-image\/figma\/assets\//,
        ),
        trailingIconSrc: expect.stringMatching(
          /^\/project-image\/figma\/assets\//,
        ),
      },
    });
    expect(preview.elements.overlay).toMatchObject({
      type: "PixelOverlay",
      props: {
        src: expect.stringMatching(/^\/project-image\/figma\/assets\//),
        width: 320,
        height: 180,
        sourceWidth: 640,
        sourceHeight: 480,
        frame: { x: 10, y: 20, width: 160, height: 90 },
      },
      children: ["overlay-caption"],
    });
    expect(preview.elements["overlay-caption"]).toMatchObject({
      type: "Text",
    });
  });

  it("仅透传受控基础样式字段", () => {
    const draft = createUISpecDraft();
    const title = draft.nodes.find((node) => node.id === "title");
    if (title) {
      title.style = {
        textColor: "#123456",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: 24,
        fontWeight: "bold",
        lineHeight: 1.25,
        letterSpacing: 0.6,
        textAlign: "right",
        whiteSpace: "nowrap",
        backgroundColor: "#ffffff",
        borderRadius: 8,
        boxShadow: "sm",
        opacity: 0.9,
        objectPosition: "center top",
        pointerEvents: "none",
        maxWidth: 320,
        position: "absolute",
        left: 24,
        top: 48,
        zIndex: 3,
      };
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements.title).toMatchObject({
      type: "Text",
      props: {
        style: {
          textColor: "#123456",
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 24,
          fontWeight: "bold",
          lineHeight: 1.25,
          letterSpacing: 0.6,
          textAlign: "right",
          whiteSpace: "nowrap",
          backgroundColor: "#ffffff",
          borderRadius: 8,
          boxShadow: "sm",
          opacity: 0.9,
          objectPosition: "center top",
          pointerEvents: "none",
          maxWidth: 320,
          position: "absolute",
          left: 24,
          top: 48,
          zIndex: 3,
        },
      },
    });
  });

  it("拒绝不存在的页面", () => {
    const uiSpec = uiSpecSchema.parse({
      ...createUISpecDraft(),
      revision: 1,
    });
    expect(() =>
      toPreviewJsonSpec(uiSpec, "missing", {
        imageUrl: (path) => path,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PreviewAdapterError>>({
        code: "page_not_found",
      }),
    );
  });

  it("映射 P1 表单与内容组件", () => {
    const draft = createUISpecDraft();
    draft.state.push(
      { key: "plan", valueType: "string", initialValue: "basic" },
      { key: "notify", valueType: "boolean", initialValue: false },
      { key: "country", valueType: "string", initialValue: "" },
      { key: "bio", valueType: "string", initialValue: "" },
      { key: "activeTab", valueType: "string", initialValue: "general" },
    );
    draft.actions.push({ id: "go-home", kind: "navigate", pageId: "home" });
    draft.nodes.push(
      {
        id: "terms-link",
        kind: "link",
        label: "条款",
        actionId: "go-home",
        designValueRefs: [],
      },
      {
        id: "plan-radio",
        kind: "radio",
        label: "基础版",
        stateKey: "plan",
        value: "basic",
        designValueRefs: [],
      },
      {
        id: "notify-switch",
        kind: "switch",
        label: "通知",
        stateKey: "notify",
        designValueRefs: [],
      },
      {
        id: "country-select",
        kind: "select",
        label: "国家",
        stateKey: "country",
        options: [{ value: "cn", label: "中国" }],
        designValueRefs: [],
      },
      {
        id: "bio-textarea",
        kind: "textarea",
        label: "简介",
        stateKey: "bio",
        designValueRefs: [],
      },
      {
        id: "avatar",
        kind: "avatar",
        initials: "JD",
        alt: "头像",
        designValueRefs: [],
      },
      {
        id: "icon",
        kind: "icon",
        assetRef: FIXTURE_ASSET_PATH,
        decorative: true,
        designValueRefs: [],
      },
      {
        id: "tab1-text",
        kind: "text",
        text: "常规内容",
        variant: "body",
        designValueRefs: [],
      },
      {
        id: "tab2-text",
        kind: "text",
        text: "高级内容",
        variant: "body",
        designValueRefs: [],
      },
      {
        id: "tabs",
        kind: "tabs",
        stateKey: "activeTab",
        tabs: [
          {
            value: "general",
            label: "常规",
            childIds: ["tab1-text"],
          },
          {
            value: "advanced",
            label: "高级",
            childIds: ["tab2-text"],
          },
        ],
        designValueRefs: [],
      },
      {
        id: "nav",
        kind: "nav",
        orientation: "horizontal",
        childIds: [],
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push(
        "terms-link",
        "plan-radio",
        "notify-switch",
        "country-select",
        "bio-textarea",
        "avatar",
        "icon",
        "tabs",
        "nav",
      );
    }
    const uiSpec = uiSpecSchema.parse({ ...draft, revision: 1 });
    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements["terms-link"]).toMatchObject({
      type: "Link",
      on: {
        press: { action: "dispatch", params: { actionId: "go-home" } },
      },
    });
    expect(preview.elements["country-select"]).toMatchObject({
      type: "Select",
      props: { options: [{ value: "cn", label: "中国" }] },
    });
    expect(preview.elements["bio-textarea"]).toMatchObject({
      type: "Textarea",
      props: { value: { $bindState: "/bio" } },
    });
    expect(preview.elements.icon).toMatchObject({
      type: "Icon",
      props: {
        src: expect.stringMatching(/^\/project-image\//),
        symbol: null,
      },
    });
    expect(preview.elements.tabs).toMatchObject({
      type: "Tabs",
      props: { selectedTab: { $bindState: "/activeTab" } },
      children: expect.arrayContaining([
        expect.stringContaining("__tabpanel__tabs__general"),
        expect.stringContaining("__tabpanel__tabs__advanced"),
      ]),
    });
    expect(
      Object.values(preview.elements).some(
        (element) => element.type === "TabPanel",
      ),
    ).toBe(true);
  });

  it("禁用 Link 时不输出动作", () => {
    const draft = createUISpecDraft();
    draft.actions.push({ id: "go-home", kind: "navigate", pageId: "home" });
    draft.nodes.push({
      id: "terms-link",
      kind: "link",
      label: "条款",
      actionId: "go-home",
      disabled: true,
      designValueRefs: [],
    });
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("terms-link");
    }
    const uiSpec = uiSpecSchema.parse({ ...draft, revision: 1 });
    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => path,
    });

    expect(preview.elements["terms-link"]).toMatchObject({
      type: "Link",
      props: { disabled: true },
    });
    expect(preview.elements["terms-link"]?.on).toBeUndefined();
  });
});
