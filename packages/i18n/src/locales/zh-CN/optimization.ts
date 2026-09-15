export const optimization = {
  calibration_one:
    "基于 {{count, number}} 次复习记录，校准误差由 {{before}} 改善至 {{after}}（数值越低越好）。",
  calibration_other:
    "基于 {{count, number}} 次复习记录，校准误差由 {{before}} 改善至 {{after}}（数值越低越好）。",
  delta: "未来 {{days, number}} 天：{{delta}} 张卡片",
  projectedDailyDueLoadBeforeAndAfter: "预计每日到期负载（调整前与调整后）",
  estimationFailed: "估算失败",
  applyFailed: "应用失败",
  fsrsOptimization: "FSRS 优化",
  estimateFSRSParametersFromYourReviewHistory: "根据你的复习历史估算 FSRS 参数",
  fitsYourSchedulerToHowYouActually:
    "让调度器贴合你真实的记忆表现——结果基于你的历史估算，并非完美答案。建议只会预览，应用前不会产生任何更改。",
  estimating: "正在估算…",
  run: "运行",
  appliedFutureReviewsUseTheNewParameters: "已应用——之后的复习将使用新参数。",
  notEnoughReviewHistoryYetToEstimate:
    "复习历史还不足以可靠地估算参数。请继续复习——估算需要在更多卡片上积累更多评分记录。",
  apply: "应用",
  dismiss: "忽略",
} as const;
