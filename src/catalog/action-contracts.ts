/**
 * 受控 Action 合同（设计 §9.1）：
 * - 第一阶段 10 个 customActions 进入 catalog.data.actions 与 RuntimeActionAdapter.handlers，
 *   二者由 catalog gate 精确键闭合；
 * - 4 个内置动作（setState/pushState/removeState/navigate）只进入 Prompt/静态约束，
 *   任何派生器不得把内置动作放入 catalog.data.actions；
 * - uploadAttachment 是后续 BusinessAttachment 扩展的第 11 个 custom Action，P0 不进入。
 */
import { z } from "zod";

export type ActionPermissionClass =
  | "ui"
  | "record-read"
  | "record-write"
  | "attachment"
  | "export";

export interface ActionContract {
  params: z.ZodType;
  result: z.ZodType;
  permissionClass: ActionPermissionClass;
  description: string;
}

/** 异步 Action 共享的受控状态目标（设计 §9.1）。 */
export const actionStateTargetsSchema = z
  .object({
    loadingStatePath: z
      .string()
      .regex(
        /^\/runtime\/actions\/[^/]+\/loading$/,
        "loadingStatePath 必须是 /runtime/actions/<key>/loading",
      ),
    resultStatePath: z
      .string()
      .regex(
        /^\/runtime\/(queries\/[^/]+|forms\/[^/]+|actions\/[^/]+\/result)$/,
        "resultStatePath 必须是 /runtime/queries/**、/runtime/forms/** 或 /runtime/actions/**/result",
      )
      .optional(),
    errorStatePath: z
      .string()
      .regex(
        /^\/runtime\/actions\/[^/]+\/error$/,
        "errorStatePath 必须是 /runtime/actions/<key>/error",
      ),
  })
  .strict();

export type ActionStateTargets = z.infer<typeof actionStateTargetsSchema>;

const collectionKeySchema = z.string().min(1);

const recordViewSchema = z
  .object({
    recordId: z.string(),
    revision: z.number().int().nonnegative(),
    fields: z.record(z.string(), z.unknown()),
  })
  .strict();

function action(input: ActionContract): ActionContract {
  return input;
}

const queryRecords = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      where: z.record(z.string(), z.unknown()).optional(),
      orderBy: z
        .array(
          z
            .object({
              field: z.string(),
              direction: z.enum(["asc", "desc"]),
            })
            .strict(),
        )
        .optional(),
      limit: z.number().int().positive().max(100).optional(),
      cursor: z.string().optional(),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: z
    .object({
      items: z.array(recordViewSchema),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  permissionClass: "record-read",
  description:
    "按 collectionKey 受控查询记录（where≤5 条件、orderBy、limit≤100、cursor 分页）；结果 {items,nextCursor} 写 resultStatePath。",
});

const loadRecordForm = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      recordIdStatePath: z.string().min(1),
      schemaRef: z.string().min(1),
      formStatePath: z
        .string()
        .regex(/^\/runtime\/forms\/[^/]+$/, "formStatePath 必须是 /runtime/forms/<formId>"),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: z
    .object({
      formStatePath: z.string(),
      recordId: z.string(),
      revision: z.number().int().nonnegative(),
      hydrated: z.boolean(),
    })
    .strict(),
  permissionClass: "record-read",
  description:
    "加载记录到受控表单：匹配 hydration epoch 且未 dirty 时，已授权字段/recordId/revision 原子写入 RuntimeFormState；result 必须写同一 form path。",
});

const createRecord = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      dataStatePath: z.string().min(1),
      subjectStatePath: z.string().optional(),
      principalsStatePath: z.string().optional(),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: recordViewSchema,
  permissionClass: "record-write",
  description: "创建记录；成功结果为已授权 RecordView。",
});

const updateRecord = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      recordIdStatePath: z.string().min(1),
      expectedRevisionStatePath: z.string().min(1),
      patchStatePath: z.string().min(1),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: recordViewSchema,
  permissionClass: "record-write",
  description: "按 expectedRevision CAS 更新记录；成功结果为新 RecordView/revision。",
});

const deleteRecord = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      recordIdStatePath: z.string().min(1),
      expectedRevisionStatePath: z.string().min(1),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: z.object({ deleted: z.literal(true) }).strict(),
  permissionClass: "record-write",
  description: "按 expectedRevision CAS 删除记录；成功结果 {deleted:true}。",
});

const downloadExport = action({
  params: z
    .object({
      collectionKey: collectionKeySchema,
      query: z
        .object({
          where: z.record(z.string(), z.unknown()).optional(),
          orderBy: z
            .array(
              z
                .object({
                  field: z.string(),
                  direction: z.enum(["asc", "desc"]),
                })
                .strict(),
            )
            .optional(),
          limit: z.number().int().positive().max(100).optional(),
        })
        .strict()
        .optional(),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: z
    .object({
      fileName: z.string(),
      rowCount: z.number().int().nonnegative(),
      byteLength: z.number().int().nonnegative(),
    })
    .strict(),
  permissionClass: "export",
  description:
    "导出受控查询为 CSV：Browser Host 以同步用户手势创建 DownloadIntent，异步完成有界 CSV；生成应用只收到完成摘要。",
});

const openDialog = action({
  params: z
    .object({ targetElementId: z.string().min(1) })
    .strict(),
  result: z.object({ opened: z.literal(true) }).strict(),
  permissionClass: "ui",
  description: "写目标组件声明的 /ui/** openPath 打开受控弹层。",
});

const closeDialog = action({
  params: z
    .object({ targetElementId: z.string().min(1) })
    .strict(),
  result: z.object({ closed: z.literal(true) }).strict(),
  permissionClass: "ui",
  description: "关闭同一受控 openPath。",
});

const showToast = action({
  params: z
    .object({
      variant: z.enum(["default", "success", "warning", "error"]),
      title: z.string().min(1),
      description: z.string().optional(),
    })
    .strict(),
  result: z.object({ shown: z.literal(true) }).strict(),
  permissionClass: "ui",
  description: "写内部 Toast 队列（variant/title/可选 description），不接受 HTML。",
});

const submitForm = action({
  params: z
    .object({
      formStatePath: z
        .string()
        .regex(/^\/runtime\/forms\/[^/]+$/, "formStatePath 必须是 /runtime/forms/<formId>"),
      schemaRef: z.string().min(1),
      mutation: z.enum(["createRecord", "updateRecord"]),
      targets: actionStateTargetsSchema,
    })
    .strict(),
  result: recordViewSchema,
  permissionClass: "record-write",
  description: "校验成功后执行受控 mutation（仅 createRecord/updateRecord）。",
});

/** 第一阶段 10 个 customActions（键即 Action 名，与 Adapter handler map 精确键闭合）。 */
export const p0CustomActions = {
  queryRecords,
  loadRecordForm,
  createRecord,
  updateRecord,
  deleteRecord,
  downloadExport,
  openDialog,
  closeDialog,
  showToast,
  submitForm,
} as const satisfies Record<string, ActionContract>;

export const P0_CUSTOM_ACTION_NAMES = Object.keys(p0CustomActions);
