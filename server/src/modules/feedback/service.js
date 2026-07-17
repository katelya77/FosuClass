/**
 * Feedback domain service — re-exports feedbackService.
 */
const feedbackService = require("../../services/feedbackService");

module.exports = {
  listFeedback: (query) => feedbackService.listFeedback(query),
  getFeedbackById: (id) => feedbackService.getFeedbackById(id),
  getFeedbackOverview: () => feedbackService.getFeedbackOverview(),
  getFeedbackStats: () => feedbackService.getFeedbackStats(),
  updateFeedbackReview: (id, patch) => feedbackService.updateFeedbackReview(id, patch),
  exportFeedbackCsv: (query) => feedbackService.exportFeedbackCsv(query),
};
