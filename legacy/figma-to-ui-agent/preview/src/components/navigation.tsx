import type { ComponentFn } from "@json-render/react";
import { useBoundProp, useStateStore, useStateValue } from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Nav: ComponentFn<typeof previewCatalog, "Nav"> = ({
  props,
  children,
}) => (
  <nav
    className={`ui-nav ui-nav-${props.orientation}`}
    data-ui-node-id={props.nodeId}
    style={controlledStyle(props.style)}
  >
    {children}
  </nav>
);

export const Tabs: ComponentFn<typeof previewCatalog, "Tabs"> = ({
  props,
  children,
  bindings,
}) => {
  const [selectedTab, setSelectedTab] = useBoundProp(
    props.selectedTab,
    bindings?.selectedTab,
  );
  const currentTab = typeof selectedTab === "string" ? selectedTab : "";
  return (
    <div
      className="ui-tabs"
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <div className="ui-tabs-list" role="tablist">
        {props.tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.value}
            className={`ui-tab${
              currentTab === tab.value ? " is-active" : ""
            }`}
            onClick={() => setSelectedTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ui-tabs-panels">{children}</div>
    </div>
  );
};

export const TabPanel: ComponentFn<typeof previewCatalog, "TabPanel"> = ({
  props,
  children,
}) => {
  const currentValue = useStateValue<string>(`/${props.stateKey}`);
  const isActive = currentValue === props.value;
  return (
    <div
      className="ui-tab-panel"
      data-ui-node-id={props.nodeId}
      role="tabpanel"
      hidden={!isActive}
      style={controlledStyle(props.style)}
    >
      {isActive ? children : null}
    </div>
  );
};
