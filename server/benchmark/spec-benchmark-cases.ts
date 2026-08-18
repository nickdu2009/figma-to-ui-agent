export type SpecBenchmarkCase = {
  id: string;
  request: string;
  requirements: readonly {
    id: string;
    label: string;
    terms: readonly string[];
  }[];
  minimums: {
    routes: number;
    links: number;
    eventBindings: number;
    statefulTrees: number;
  };
};

/**
 * 固定的创建型对比集。每个模型接收完全相同的请求、Catalog Prompt、工具
 * Schema 和步数上限；避免用聊天历史或人工改写为某个模型提供额外信息。
 */
export const SPEC_BENCHMARK_CASES: readonly SpecBenchmarkCase[] = [
  {
    id: "todo",
    request:
      "生成一个中文 Todo 应用，包含任务列表、添加任务、完成状态、删除、全部/未完成/已完成筛选和设置页。所有可操作控件必须有真实状态行为。",
    requirements: [
      { id: "tasks", label: "任务列表", terms: ["任务", "todo"] },
      { id: "add", label: "添加任务", terms: ["添加", "新增"] },
      { id: "complete", label: "完成状态", terms: ["完成", "已完成"] },
      { id: "delete", label: "删除", terms: ["删除"] },
      { id: "filter", label: "状态筛选", terms: ["未完成", "全部"] },
      { id: "settings", label: "设置页", terms: ["设置", "settings"] },
    ],
    minimums: { routes: 2, links: 2, eventBindings: 4, statefulTrees: 1 },
  },
  {
    id: "admin-dashboard",
    request:
      "生成一个中文 SaaS 管理后台，包含总览、客户、订单、团队和设置页面，提供侧边导航、统计卡、表格筛选、分页外观和可操作表单。",
    requirements: [
      { id: "overview", label: "总览", terms: ["总览", "仪表盘"] },
      { id: "customers", label: "客户", terms: ["客户"] },
      { id: "orders", label: "订单", terms: ["订单"] },
      { id: "team", label: "团队", terms: ["团队", "成员"] },
      { id: "settings", label: "设置", terms: ["设置"] },
      { id: "filter", label: "筛选", terms: ["筛选", "过滤"] },
      { id: "pagination", label: "分页", terms: ["下一页", "上一页", "分页"] },
    ],
    minimums: { routes: 5, links: 5, eventBindings: 3, statefulTrees: 1 },
  },
  {
    id: "insurance-portal",
    request:
      "生成保险客户服务与销售门户，包含客户总览、保单、理赔、续保线索和客户详情页面，支持站内导航、筛选、状态变更和跟进表单。",
    requirements: [
      { id: "overview", label: "客户总览", terms: ["客户总览", "总览"] },
      { id: "policies", label: "保单", terms: ["保单"] },
      { id: "claims", label: "理赔", terms: ["理赔"] },
      { id: "renewals", label: "续保线索", terms: ["续保", "线索"] },
      { id: "customer-detail", label: "客户详情", terms: ["客户详情", "详情"] },
      { id: "follow-up", label: "跟进表单", terms: ["跟进", "备注"] },
    ],
    minimums: { routes: 5, links: 5, eventBindings: 3, statefulTrees: 1 },
  },
  {
    id: "account-flow",
    request:
      "生成一个账号中心，包含登录、忘记密码、重置密码、个人资料和安全设置页面；表单校验、提交反馈、密码可见性和页面导航必须可操作。",
    requirements: [
      { id: "login", label: "登录", terms: ["登录"] },
      { id: "forgot", label: "忘记密码", terms: ["忘记密码"] },
      { id: "reset", label: "重置密码", terms: ["重置密码"] },
      { id: "profile", label: "个人资料", terms: ["个人资料", "个人信息"] },
      { id: "security", label: "安全设置", terms: ["安全设置", "账户安全"] },
      { id: "feedback", label: "提交反馈", terms: ["成功", "已保存", "已发送"] },
    ],
    minimums: { routes: 5, links: 4, eventBindings: 5, statefulTrees: 2 },
  },
  {
    id: "project-workspace",
    request:
      "生成一个多项目协作工作台，包含项目列表、看板、任务详情、成员和设置页面，支持搜索、状态筛选、任务编辑和成员选择。",
    requirements: [
      { id: "projects", label: "项目列表", terms: ["项目列表", "项目"] },
      { id: "board", label: "看板", terms: ["看板"] },
      { id: "task-detail", label: "任务详情", terms: ["任务详情", "详情"] },
      { id: "members", label: "成员", terms: ["成员"] },
      { id: "settings", label: "设置", terms: ["设置"] },
      { id: "search", label: "搜索", terms: ["搜索"] },
      { id: "edit", label: "任务编辑", terms: ["编辑", "保存任务"] },
    ],
    minimums: { routes: 5, links: 5, eventBindings: 4, statefulTrees: 1 },
  },
  {
    id: "commerce-operations",
    request:
      "生成一个电商运营门户，包含仪表盘、商品、订单、库存、促销和设置页面，支持商品筛选、订单状态操作、库存预警和促销表单。",
    requirements: [
      { id: "dashboard", label: "仪表盘", terms: ["仪表盘", "总览"] },
      { id: "products", label: "商品", terms: ["商品"] },
      { id: "orders", label: "订单", terms: ["订单"] },
      { id: "inventory", label: "库存", terms: ["库存"] },
      { id: "promotions", label: "促销", terms: ["促销", "优惠"] },
      { id: "settings", label: "设置", terms: ["设置"] },
      { id: "warning", label: "库存预警", terms: ["预警", "低库存"] },
    ],
    minimums: { routes: 6, links: 6, eventBindings: 4, statefulTrees: 1 },
  },
] as const;
