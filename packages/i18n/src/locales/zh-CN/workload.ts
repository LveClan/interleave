export const workload = {
  peakSummary: "峰值：{{before, number}} → {{after, number}} /天",
  budgetSummary: "超预算天数：{{before, number}} → {{after, number}}",
  deltaSummary: "未来 7 / 30 天：{{week}} / {{month}} 张卡片",
  budgetNote:
    "预算：{{count, number}}/天（虚线）。预览不会产生任何更改——请调整实际设置、导入或推迟操作以生效。",
  projectedDailyDueLoadBeforeAndAfter: "变更前后的预计每日到期负载，含每日预算线",
  simulationFailed: "模拟失败",
  workloadSimulation: "负载模拟",
  previewHowYourDailyReviewLoadWould:
    "在做出任何更改前，预览每日复习负载将如何变化——基于当前日程的估算。预览不会产生任何更改。",
  alterRetention: "调整保持率",
  addCards: "新增卡片",
  postponeLowPriority: "推迟低优先级",
  globalRetentionTarget: "全局目标保持率",
  newCards: "新卡片",
  postponeByDays: "推迟天数（天）",
  includeLowPriorityMatureCardsFragileCards: "包含低优先级成熟卡片（脆弱卡片始终受保护）",
  projecting: "正在预测…",
  preview: "预览",
} as const;
