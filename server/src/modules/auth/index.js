/**
 * Auth domain — shared service surface for modular mounting.
 * Business logic remains in services/adminAuth.js + serviceTokenService.js.
 */
const adminAuth = require("../../services/adminAuth");
const serviceTokenService = require("../../services/serviceTokenService");

module.exports = {
  adminAuth,
  serviceTokenService,
  scopes: serviceTokenService.SCOPES,
  ALL_SCOPES: serviceTokenService.ALL_SCOPES,
};
