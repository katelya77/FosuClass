/**
 * ConversationRepository facade — currently file-backed, replaceable later.
 */
const { FileConversationRepository } = require("./fileConversationRepository");

let defaultRepository = null;

function createConversationRepository(options = {}) {
  return new FileConversationRepository(options);
}

function getConversationRepository(options = {}) {
  if (options.repository) return options.repository;
  if (!defaultRepository || options.forceNew) {
    defaultRepository = createConversationRepository(options);
  }
  return defaultRepository;
}

function resetConversationRepositoryForTests() {
  defaultRepository = null;
}

module.exports = {
  createConversationRepository,
  getConversationRepository,
  resetConversationRepositoryForTests,
};
