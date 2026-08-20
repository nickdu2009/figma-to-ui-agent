/**
 * 受控 Icon 白名单渲染（设计 §7.2，计划 S5）：
 * - 只允许 ICON_NAMES 白名单内的 name；不接受任意 SVG 字符串；
 * - 40 个图标均为 24x24 stroke 风格（与 lucide 视觉一致）；
 * - 非装饰 Icon 必须有可访问名称（aria-label），装饰图标 aria-hidden。
 * 供 Icon/IconButton/Button(icon) 复用；不进入模型上下文。
 */
import type { ReactNode } from "react";

import { ICON_NAMES } from "../component-contracts.ts";

export type IconName = (typeof ICON_NAMES)[number];

/** 单个图标：stroke path 集（24x24 viewBox）。 */
const ICON_PATHS: Record<IconName, readonly string[]> = {
    "arrow-left": ["M12 19 5 12l7-7", "M19 12H5"],
    "arrow-right": ["M5 12h14", "m12 5 7 7-7 7"],
    "arrow-up": ["m5 12 7-7 7 7", "M12 19V5"],
    "arrow-down": ["M12 5v14", "m19 12-7 7-7-7"],
    bell: [
        "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",
        "M10.3 21a1.94 1.94 0 0 0 3.4 0",
    ],
    calendar: ["M8 2v4", "M16 2v4", "M3 10h18"],
    check: ["M20 6 9 17l-5-5"],
    "chevron-down": ["m6 9 6 6 6-6"],
    "chevron-left": ["m15 18-6-6 6-6"],
    "chevron-right": ["m9 18 6-6-6-6"],
    "chevron-up": ["m18 15-6-6-6 6"],
    clock: ["M12 6v6l4 2"],
    copy: ["M8 8h12v12H8z", "M4 16V4h12"],
    download: [
        "M7 10l5 5 5-5",
        "M12 15V3",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    ],
    edit: [
        "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
        "M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z",
    ],
    ellipsis: [
        "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
        "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
        "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
    ],
    "external-link": [
        "M15 3h6v6",
        "M10 14 21 3",
        "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    ],
    eye: ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"],
    "eye-off": [
        "M2 2l20 20",
        "M9.88 9.88a3 3 0 1 0 4.24 4.24",
        "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68",
        "M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61",
    ],
    file: [
        "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
        "M14 2v4a2 2 0 0 0 2 2h4",
    ],
    filter: ["M22 3H2l8 9.46V19l4 2v-8.54Z"],
    folder: [
        "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ],
    gear: [
        "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
        "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    ],
    home: ["m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
    info: ["M12 16v-4", "M12 8h.01"],
    loader: ["M21 12a9 9 0 1 1-6.219-8.56"],
    lock: ["M5 11h14v10H5z", "M7 11V7a5 5 0 0 1 10 0v4"],
    "log-out": [
        "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
        "m16 17 5-5-5-5",
        "M21 12H9",
    ],
    mail: [
        "M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z",
        "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",
    ],
    minus: ["M5 12h14"],
    plus: ["M5 12h14", "M12 5v14"],
    refresh: [
        "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
        "M21 3v5h-5",
        "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
        "M8 16H3v5",
    ],
    search: ["m21 21-4.3-4.3"],
    star: [
        "m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2Z",
    ],
    trash: [
        "M3 6h18",
        "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
        "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    ],
    upload: [
        "m17 8-5-5-5 5",
        "M12 3v12",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    ],
    user: [
        "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
        "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    ],
    users: [
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
        "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
        "M22 21v-2a4 4 0 0 0-3-3.87",
        "M16 3.13a4 4 0 0 1 0 7.75",
    ],
    warning: [
        "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
        "M12 9v4",
        "M12 17h.01",
    ],
    x: ["M18 6 6 18", "m6 6 12 12"],
};

/** 特殊填充规则（非 stroke-only）。 */
const ICON_FILL: Partial<Record<IconName, "star" | "filter">> = {
    star: "star",
    filter: "filter",
};

export function isIconName(value: unknown): value is IconName {
    return (
        typeof value === "string" &&
        (ICON_NAMES as readonly string[]).includes(value)
    );
}

/** 白名单图标渲染（无外层 aria 语义——由调用方决定装饰性）。 */
export function renderIconSvg(name: IconName, size = 16): ReactNode {
    const paths = ICON_PATHS[name];
    const filled = ICON_FILL[name];
    return (
        <svg
            className="vma-icon"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? "currentColor" : "none"}
            stroke={filled ? "none" : "currentColor"}
            strokeWidth={filled ? 0 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {paths.map((d, index) => (
                <path key={index} d={d} />
            ))}
            {name === "clock" ? <circle cx="12" cy="12" r="10" /> : null}
            {name === "eye" ? <circle cx="12" cy="12" r="3" /> : null}
            {name === "search" ? <circle cx="11" cy="11" r="8" /> : null}
            {name === "info" ? <circle cx="12" cy="12" r="10" /> : null}
            {name === "user" ? null : null}
        </svg>
    );
}

/** 图标按钮/独立 Icon 的统一包装：装饰性与可访问名称由 props 决定。 */
export function IconGlyph(props: {
    name: string;
    size?: number;
    color?: string;
    decorative?: boolean;
    label?: string;
}): ReactNode {
    const name = isIconName(props.name) ? props.name : null;
    if (name === null) {
        // 白名单外的图标：fail closed 渲染占位（结构错误也保持可访问语义）
        return (
            <span
                className="vma-icon vma-icon-missing"
                aria-hidden="true"
                data-vma-icon-missing={props.name}
            />
        );
    }
    const size = props.size ?? 16;
    return (
        <span
            className="vma-icon"
            style={{
                color: props.color,
                display: "inline-flex",
                lineHeight: 0,
            }}
            role={props.decorative === true ? undefined : "img"}
            aria-label={props.decorative === true ? undefined : props.label}
            aria-hidden={props.decorative === true ? true : undefined}
            data-vma-style-part="icon"
        >
            {renderIconSvg(name, size)}
        </span>
    );
}

type ComponentOn = (event: string) => {
        emit: () => void;
        shouldPreventDefault: boolean;
        bound: boolean;
    }

/** Catalog Icon 组件：白名单名称 + 尺寸/颜色/可访问名称。 */
export function Icon(component: {
    props: {
        name: string;
        size?: number;
        color?: string;
        decorative?: boolean;
        label?: string;
    };
    on: ComponentOn;
}): ReactNode {
    return IconGlyph({
        name: component.props.name,
        size: component.props.size,
        color: component.props.color,
        decorative: component.props.decorative,
        label: component.props.label,
    });
}

/** Catalog IconButton 组件：label 必需可访问名称；press 事件。 */
export function IconButton(component: {
    props: {
        iconName: string;
        label: string;
        variant?:
            | "default"
            | "secondary"
            | "destructive"
            | "outline"
            | "ghost";
        size?: "sm" | "default" | "lg";
        loading?: boolean;
        disabled?: boolean;
    };
    on: ComponentOn;
}): ReactNode {
    const { iconName, label } = component.props;
    const variant = component.props.variant ?? "default";
    const size = component.props.size ?? "default";
    const loading = component.props.loading === true;
    const disabled = component.props.disabled === true || loading;
    return (
        <button
            type="button"
            className={[
                "vma-icon-button",
                `vma-icon-button--${variant}`,
                `vma-icon-button--${size}`,
                loading ? "vma-icon-button--loading" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            data-vma-style-part="root"
            aria-label={label}
            aria-busy={loading || undefined}
            disabled={disabled}
            onClick={() => {
                if (!disabled) component.on("press").emit();
            }}
        >
            {loading ? (
                <span className="vma-button-spinner" aria-hidden="true">
                    {renderIconSvg("loader", 14)}
                </span>
            ) : (
                IconGlyph({ name: iconName, decorative: true })
            )}
        </button>
    );
}
