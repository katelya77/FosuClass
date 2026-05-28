#!/usr/bin/env node

/*
 * TODO(V3+): parse school-wide schedule captures from sanitized HAR files.
 *
 * Planned endpoints:
 * - /kbcx/kbxx_xzb_ifr
 * - /kbcx/kbxx_teacher_ifr
 * - /kbcx/kbxx_classroom_ifr
 * - /kbcx/kbxx_kc_ifr
 *
 * These responses also contain table#kbtable, but the layout is different from
 * the personal schedule: weekdays and sections expand horizontally, and each
 * row represents one class, teacher, classroom, or course object.
 *
 * Keep this tool offline-only. It must read sanitized HAR files only and must
 * never request 100.fosu.edu.cn.
 */

console.log("TODO: school-wide HAR schedule extraction is reserved for a later V3+ step.");
