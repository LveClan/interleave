export const workload = {
  peakSummary: "Peak: {{before, number}} → {{after, number}} /day",
  budgetSummary: "Over-budget days: {{before, number}} → {{after, number}}",
  deltaSummary: "Next 7 / 30 days: {{week}} / {{month}} cards",
  budgetNote:
    "Budget: {{count, number}}/day (dashed line). Previewing changed nothing — adjust the real setting, import, or postpone to commit.",
  projectedDailyDueLoadBeforeAndAfter:
    "Projected daily due load, before and after the change, with the daily budget line",
  simulationFailed: "Simulation failed",
  workloadSimulation: "Workload simulation",
  previewHowYourDailyReviewLoadWould:
    "Preview how your daily review load would shift before you change anything — an estimate from your current schedule. Previewing changes nothing.",
  alterRetention: "Alter retention",
  addCards: "Add cards",
  postponeLowPriority: "Postpone low-priority",
  globalRetentionTarget: "Global retention target",
  newCards: "New cards",
  postponeByDays: "Postpone by (days)",
  includeLowPriorityMatureCardsFragileCards:
    "Include low-priority mature cards (fragile cards are always protected)",
  projecting: "Projecting…",
  preview: "Preview",
} as const;
