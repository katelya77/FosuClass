/**
 * 缓存管理器：基于 node-cache 模块实现内存缓存读写，降低对教务网的直接请求频次。
 */

const NodeCache = require("node-cache");
const config = require("../config");

// 初始化全局缓存实例，默认的 stdTTL 设为 600 秒
const globalCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

/**
 * 统一的缓存 Key 生成器
 */
const cacheKeys = {
  getCatalogKey: (semester) => `catalog:${semester || "current"}`,
  getMajorsKey: (collegeCode, grade) => `majors:${collegeCode || ""}:${grade || ""}`,
  getClassScheduleKey: (semester, collegeCode, grade, majorCode) => 
    `schedule:class:${semester}:${collegeCode}:${grade}:${majorCode}`,
  getTeacherScheduleKey: (semester, collegeCode, keyword) => 
    `schedule:teacher:${semester}:${collegeCode || "all"}:${keyword}`,
  getClassroomScheduleKey: (semester, campusId, classroomName) => 
    `schedule:classroom:${semester}:${campusId || "all"}:${classroomName}`,
  getCourseScheduleKey: (semester, courseName) => 
    `schedule:course:${semester}:${courseName}`,
};

/**
 * 读取缓存
 * @param {string} key 缓存键
 * @returns {any} 缓存值或 null
 */
function get(key) {
  const data = globalCache.get(key);
  return data !== undefined ? data : null;
}

/**
 * 设置缓存
 * @param {string} key 缓存键
 * @param {any} value 缓存值
 * @param {number} ttlSeconds 缓存生存周期 (秒)
 */
function set(key, value, ttlSeconds) {
  globalCache.set(key, value, ttlSeconds);
}

/**
 * 删除缓存
 * @param {string} key 缓存键
 */
function del(key) {
  globalCache.del(key);
}

module.exports = {
  get,
  set,
  del,
  keys: cacheKeys,
  TTL: config.CACHE_TTL,
};
