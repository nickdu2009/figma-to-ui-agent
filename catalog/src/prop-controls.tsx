import { useState } from "react";

import type { PropControl } from "./fixture-types.ts";

export interface PropControlsProps {
  controls: PropControl[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

export function PropControls({
  controls,
  values,
  onChange,
}: PropControlsProps) {
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const markInvalid = (name: string) => {
    setInvalid((previous) => {
      if (previous.has(name)) return previous;
      const next = new Set(previous);
      next.add(name);
      return next;
    });
  };

  const markValid = (name: string) => {
    setInvalid((previous) => {
      if (!previous.has(name)) return previous;
      const next = new Set(previous);
      next.delete(name);
      return next;
    });
  };

  return (
    <div className="prop-controls">
      {controls.map((control) => {
        const value = values[control.name];
        const isInvalid = invalid.has(control.name);

        if (control.type === "enum") {
          return (
            <label
              key={control.name}
              className={`prop-control${isInvalid ? " is-invalid" : ""}`}
            >
              <span className="prop-control-name">{control.name}</span>
              <select
                value={String(value ?? "")}
                onChange={(event) => {
                  markValid(control.name);
                  onChange(control.name, event.target.value);
                }}
              >
                {control.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (control.type === "boolean") {
          return (
            <label
              key={control.name}
              className={`prop-control${isInvalid ? " is-invalid" : ""}`}
            >
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => {
                  markValid(control.name);
                  onChange(control.name, event.target.checked);
                }}
              />
              <span className="prop-control-name">{control.name}</span>
            </label>
          );
        }

        if (control.type === "number") {
          return (
            <label
              key={control.name}
              className={`prop-control${isInvalid ? " is-invalid" : ""}`}
            >
              <span className="prop-control-name">{control.name}</span>
              <input
                type="number"
                min={control.min}
                max={control.max}
                step={control.isInt ? 1 : "any"}
                value={String(value ?? 0)}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  if (Number.isNaN(parsed)) {
                    markInvalid(control.name);
                    onChange(control.name, value ?? 0);
                    return;
                  }
                  let num = parsed;
                  if (control.isInt) {
                    num = Math.round(num);
                  }
                  if (typeof control.min === "number") {
                    num = Math.max(control.min, num);
                  }
                  if (typeof control.max === "number") {
                    num = Math.min(control.max, num);
                  }
                  markValid(control.name);
                  onChange(control.name, num);
                }}
              />
            </label>
          );
        }

        return (
          <label
            key={control.name}
            className={`prop-control${isInvalid ? " is-invalid" : ""}`}
          >
            <span className="prop-control-name">{control.name}</span>
            <input
              type="text"
              maxLength={control.maxLength}
              minLength={control.minLength}
              value={String(value ?? "")}
              onChange={(event) => {
                let nextValue = event.target.value;
                if (
                  typeof control.maxLength === "number" &&
                  nextValue.length > control.maxLength
                ) {
                  nextValue = nextValue.slice(0, control.maxLength);
                }
                if (
                  typeof control.minLength === "number" &&
                  nextValue.length < control.minLength
                ) {
                  markInvalid(control.name);
                  // 触发一次 state 更新，使受控输入恢复到上一次合法值
                  onChange(control.name, value ?? "");
                  return;
                }
                markValid(control.name);
                onChange(control.name, nextValue);
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
