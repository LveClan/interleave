export const optimization = {
  calibration_one:
    "Calibration improved from {{before}} to {{after}} over {{count, number}} review (lower is better).",
  calibration_other:
    "Calibration improved from {{before}} to {{after}} over {{count, number}} reviews (lower is better).",
  delta: "Next {{days, number}} days: {{delta}} cards",
  projectedDailyDueLoadBeforeAndAfter: "Projected daily due load, before and after",
  estimationFailed: "Estimation failed",
  applyFailed: "Apply failed",
  fsrsOptimization: "FSRS optimization",
  estimateFSRSParametersFromYourReviewHistory: "Estimate FSRS parameters from your review history",
  fitsYourSchedulerToHowYouActually:
    "Fits your scheduler to how you actually remember — estimated from your history, not a perfect answer. Suggestions are previewed; nothing changes until you apply.",
  estimating: "Estimating…",
  run: "Run",
  appliedFutureReviewsUseTheNewParameters: "Applied — future reviews use the new parameters.",
  notEnoughReviewHistoryYetToEstimate:
    "Not enough review history yet to estimate parameters reliably. Keep reviewing — the estimate needs more graded reviews across more cards.",
  apply: "Apply",
  dismiss: "Dismiss",
} as const;
