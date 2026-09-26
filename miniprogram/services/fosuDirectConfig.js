const ALLOWED_HOSTS = ["authserver.fosu.edu.cn", "100.fosu.edu.cn"];
const HTTPS_UPGRADE_HOSTS = ["100.fosu.edu.cn"];
const MAX_REDIRECTS = 6;
const MAX_TIMETABLE_BYTES = 1200000;

const AUTH_ORIGIN = "https://authserver.fosu.edu.cn";
const EDU_ORIGIN = "https://100.fosu.edu.cn";
const CAS_BOOTSTRAP_URL = `${EDU_ORIGIN}/caslogin.jsp`;
const CAPTCHA_CHECK_URL = "https://authserver.fosu.edu.cn/authserver/checkNeedCaptcha.htl";
const XS_MAIN_URL = `${EDU_ORIGIN}/framework/xsMain.jsp`;
const TIMETABLE_URL = `${EDU_ORIGIN}/xskb/xskb_list.do`;
const PROFILE_URL = `${EDU_ORIGIN}/grxx/xsxx`;
const PROFILE_TIMEOUT_MS = 6000;

const SECRET_KEY_PATTERN = /^(password|encryptedpassword|cookie|cookies|castgc|jsessionid|ticket|execution|pwdencryptsalt|set-cookie|authorization)$/i;

module.exports = {
  ALLOWED_HOSTS,
  HTTPS_UPGRADE_HOSTS,
  MAX_REDIRECTS,
  MAX_TIMETABLE_BYTES,
  AUTH_ORIGIN,
  EDU_ORIGIN,
  CAS_BOOTSTRAP_URL,
  CAPTCHA_CHECK_URL,
  XS_MAIN_URL,
  TIMETABLE_URL,
  PROFILE_URL,
  PROFILE_TIMEOUT_MS,
  SECRET_KEY_PATTERN,
};
