export const trash = {
  restoreFailed: "Could not restore the selected items. Try again.",
  loadFailed: "Could not load Trash. Try again.",
  deleteFailed: "Could not delete the selected items. Try again.",
  restored: "Restored · {{title}}",
  restoredBatch_one: "Restored {{count, number}} item · {{title}}",
  restoredBatch_other: "Restored {{count, number}} items · {{title}}",
  partialRestore_one:
    "Restored {{count, number}} item · {{skipped, number}} kept in Trash (changed since delete).",
  partialRestore_other:
    "Restored {{count, number}} items · {{skipped, number}} kept in Trash (changed since delete).",
  emptySkipped:
    "Emptied {{purged, number}} · {{skipped, number}} kept (still anchor live items). Restore or delete those branches first.",
  source: "from {{title}}",
  deletedAt: "deleted {{when}}",
  recently: "recently",
  branchCount_one: "Branch · {{count, number}} item",
  branchCount_other: "Branch · {{count, number}} items",
  confirmEmpty: "Permanently delete all {{count, number}}?",
  sourceType: "source",
  topicType: "topic",
  extractType: "extract",
  cardType: "card",
  taskType: "task",
  conceptType: "concept",
  mediaType: "media fragment",
  synthesisType: "synthesis note",
  thisItemStillHasLiveDescendantsRestore:
    "This item still has live descendants — restore it or delete the full branch first.",
  restore: "Restore",
  deleteBranch: "Delete branch",
  deleteForever: "Delete forever",
  cancel: "Cancel",
  deletePermanently: "Delete permanently",
  restoreBranch: "Restore branch",
  trash: "Trash",
  deletedSourcesExtractsAndCardsLandHere:
    "Deleted sources, extracts, and cards land here first and can be restored — open the Electron app to recover them.",
  localFirstDeletedItemsAreRecoverableFor:
    "Local-first · deleted items are recoverable for 30 days",
  emptyTrash: "Empty trash",
  loading: "Loading…",
  trashIsEmpty: "Trash is empty",
  nothingToRecoverDeletedSourcesExtractsAnd:
    "Nothing to recover. Deleted sources, extracts, and cards land here first and can be restored.",
} as const;
