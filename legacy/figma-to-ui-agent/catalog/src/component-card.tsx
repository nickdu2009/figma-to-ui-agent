import { useMemo, useState } from "react";
import type { Spec } from "@json-render/core";
import type { UISpec } from "../../src/ui-spec/schema.ts";
import {
  createStateStore,
  JSONUIProvider,
  Renderer,
} from "@json-render/react";

import { toPreviewJsonSpec } from "../../src/preview/json-render-adapter.ts";
import { registry } from "../../preview/src/catalog-registry.tsx";
import placeholderPng from "../assets/placeholder.png";
import type { ComponentFixture, PropControl } from "./fixture-types.ts";
import { PLACEHOLDER_ASSET_REF } from "./fixtures.ts";
import { PropControls } from "./prop-controls.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";

interface ComponentCardProps {
  fixture: ComponentFixture;
}

function defaultPropValues(
  controls: PropControl[],
): Record<string, unknown> {
  return Object.fromEntries(
    controls.map((control) => [control.name, control.defaultValue]),
  );
}

function findComponentNodeId(spec: UISpec): string | undefined {
  const page = spec.pages[0];
  if (!page) {
    return undefined;
  }
  const rootNode = spec.nodes.find((node) => node.id === page.rootNodeId);
  if (
    rootNode &&
    "childIds" in rootNode &&
    Array.isArray(rootNode.childIds)
  ) {
    return rootNode.childIds[0];
  }
  return undefined;
}

function applyPropValues(
  spec: UISpec,
  values: Record<string, unknown>,
): UISpec {
  const componentNodeId = findComponentNodeId(spec);
  if (!componentNodeId) {
    return spec;
  }
  return {
    ...spec,
    nodes: spec.nodes.map((node) =>
      node.id === componentNodeId ? { ...node, ...values } : node,
    ),
  };
}

interface CardRendererProps {
  fixture: ComponentFixture;
  propValues: Record<string, unknown>;
}

function CardRenderer({ fixture, propValues }: CardRendererProps) {
  const previewSpec = useMemo(() => {
    const spec = applyPropValues(fixture.initialSpec, propValues);
    return toPreviewJsonSpec(spec, spec.pages[0]!.id, {
      imageUrl: (path) =>
        path === PLACEHOLDER_ASSET_REF ? placeholderPng : "",
    });
  }, [fixture, propValues]);

  const store = useMemo(
    () => createStateStore(previewSpec.state),
    [previewSpec],
  );

  const handlers = useMemo(
    () => ({
      dispatch: (params: Record<string, unknown>) => {
        const actionId = params.actionId;
        if (typeof actionId !== "string") {
          return;
        }
        const action = fixture.initialSpec.actions.find(
          (candidate) => candidate.id === actionId,
        );
        if (!action) {
          return;
        }
        if (action.kind === "set_state") {
          store.set(`/${action.stateKey}`, action.value);
        } else if (action.kind === "open_dialog") {
          const dialog = fixture.initialSpec.nodes.find(
            (node) =>
              node.id === action.dialogNodeId && node.kind === "dialog",
          );
          if (dialog?.kind === "dialog") {
            store.set(`/${dialog.openStateKey}`, true);
          }
        }
        // 导航动作在 Catalog 中不产生实际跳转
      },
    }),
    [fixture.initialSpec.actions, store],
  );

  return (
    <JSONUIProvider
      registry={registry}
      store={store}
      handlers={handlers}
    >
      <Renderer spec={previewSpec as Spec} registry={registry} />
    </JSONUIProvider>
  );
}

export function ComponentCard({ fixture }: ComponentCardProps) {
  const [propValues, setPropValues] = useState<Record<string, unknown>>(() =>
    defaultPropValues(fixture.controllableProps),
  );
  const [errorKey, setErrorKey] = useState(0);

  const resetProps = () => {
    setPropValues(defaultPropValues(fixture.controllableProps));
    setErrorKey((previous) => previous + 1);
  };

  return (
    <article className={`component-card category-${fixture.category}`}>
      <header className="component-card-header">
        <div className="component-card-meta">
          <span className={`component-card-category category-${fixture.category}`}>
            {fixture.category}
          </span>
          <h3>{fixture.title}</h3>
        </div>
        <p>{fixture.description}</p>
      </header>
      <div className={`component-card-preview category-${fixture.category}`}>
        <ErrorBoundary
          key={errorKey}
          fallback={
            <div className="component-card-error">
              组件渲染出错：props 可能越界
              <button
                type="button"
                className="component-card-reset"
                onClick={resetProps}
              >
                重置
              </button>
            </div>
          }
        >
          <CardRenderer fixture={fixture} propValues={propValues} />
        </ErrorBoundary>
      </div>
      {fixture.controllableProps.length > 0 && (
        <div className="component-card-controls">
          <PropControls
            controls={fixture.controllableProps}
            values={propValues}
            onChange={(name, value) =>
              setPropValues((previous) => ({ ...previous, [name]: value }))
            }
          />
        </div>
      )}
    </article>
  );
}
