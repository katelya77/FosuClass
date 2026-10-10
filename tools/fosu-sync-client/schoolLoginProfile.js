"use strict";
// Shared CAS entry/profile. Browser emulation is compatibility, never an access grant.
const AUTH_ORIGIN = "https://authserver.fosu.edu.cn";
const SCHOOL_ORIGIN = "https://100.fosu.edu.cn";
const CAS_SERVICE_URL = SCHOOL_ORIGIN + "/caslogin.jsp?kstzType=null";
const AUTH_LOGIN_URL = AUTH_ORIGIN + "/authserver/login?type=userNameLogin&service=" + encodeURIComponent(CAS_SERVICE_URL);
const MOBILE_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const WECHAT_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
const PROFILES=Object.freeze(["mobile","mobile-safari","mobile-wechat","desktop"]);
function resolveProfile(profile="mobile"){
  if(!PROFILES.includes(profile))throw Object.assign(new Error("SCHOOL_LOGIN_PROFILE_REJECTED"),{code:"SCHOOL_LOGIN_PROFILE_REJECTED"});
  return profile==="mobile"?"mobile-wechat":profile;
}
function contextOptions(profile = "mobile", userAgent) {
  profile=resolveProfile(profile);
  return profile !== "desktop" ? {
    userAgent: userAgent || (profile==="mobile-wechat"?WECHAT_IOS_UA:MOBILE_SAFARI_UA), viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    ignoreHTTPSErrors: false,
  } : { ...(userAgent ? { userAgent } : {}), viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, ignoreHTTPSErrors: false };
}
module.exports = { AUTH_ORIGIN, SCHOOL_ORIGIN, CAS_SERVICE_URL, AUTH_LOGIN_URL, MOBILE_SAFARI_UA, WECHAT_IOS_UA, contextOptions,resolveProfile,PROFILES };
