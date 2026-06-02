var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../fosu-sync-client/diagnose.js
var require_diagnose = __commonJS({
  "../fosu-sync-client/diagnose.js"(exports2, module2) {
    var dns = require("dns").promises;
    var axios2 = require("axios");
    require("dotenv").config();
    var FOSU_BASE_URL2 = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
    var FOSU_AUTH_URL = process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn";
    function isInternalIp(ip) {
      if (!ip) return false;
      if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
      if (ip.startsWith("172.")) {
        const parts = ip.split(".").map(Number);
        if (parts.length >= 2) {
          return parts[1] >= 16 && parts[1] <= 31;
        }
      }
      return ip.startsWith("172.");
    }
    async function diagnose2() {
      console.log("=== \u5F00\u59CB\u8BCA\u65AD\u4F5B\u5927\u6559\u52A1\u7F51\u8FDE\u63A5\u72B6\u6001 ===");
      console.log(`\u76EE\u6807\u6559\u52A1\u7F51: ${FOSU_BASE_URL2}`);
      console.log(`\u76EE\u6807\u7EDF\u4E00\u8BA4\u8BC1: ${FOSU_AUTH_URL}`);
      let hostname;
      try {
        hostname = new URL(FOSU_BASE_URL2).hostname;
      } catch (e2) {
        console.error(`\u274C FOSU_BASE_URL \u683C\u5F0F\u4E0D\u6B63\u786E: ${e2.message}`);
        process.exit(1);
      }
      console.log(`
1. \u6B63\u5728\u89E3\u6790 DNS: ${hostname} ...`);
      let addresses = [];
      let easyConnectLikelyConnected = false;
      try {
        const result = await dns.lookup(hostname, { all: true });
        addresses = result.map((r) => r.address);
        console.log(`   \u89E3\u6790\u6210\u529F\uFF01\u89E3\u6790\u5230\u4EE5\u4E0B IP \u5730\u5740:`);
        addresses.forEach((addr) => {
          const isInternal = isInternalIp(addr);
          if (isInternal) {
            easyConnectLikelyConnected = true;
          }
          console.log(`   - ${addr} [${isInternal ? "\u6821\u5185\u5185\u7F51 IP" : "\u5916\u7F51/\u516C\u7F51 IP"}]`);
        });
      } catch (error) {
        console.error(`\u274C DNS \u89E3\u6790\u5931\u8D25: ${error.message}`);
        console.log(`\u26A0\uFE0F  \u63D0\u793A: \u65E0\u6CD5\u89E3\u6790\u57DF\u540D\u3002\u8BF7\u5148\u8FDE\u63A5\u201C\u4F5B\u5927 EasyConnect\u201D\u6216\u8EAB\u5904\u201C\u4F5B\u5927\u6821\u56ED\u7F51\u201D\u73AF\u5883\u5185\u518D\u8BD5\uFF01`);
        return false;
      }
      if (!easyConnectLikelyConnected) {
        console.warn(`\u26A0\uFE0F  \u8B66\u544A: DNS \u89E3\u6790\u6210\u529F\u4F46\u672A\u5339\u914D\u5230\u6821\u5185\u5185\u7F51 IP \u8303\u56F4\u3002`);
      }
      console.log(`
2. \u6B63\u5728\u5C1D\u8BD5\u901A\u8FC7 Node.js \u8BBF\u95EE HTTPS ${FOSU_BASE_URL2} ...`);
      let httpsSuccess = false;
      let tlsHandshakeFailed = false;
      try {
        const response = await axios2.get(FOSU_BASE_URL2, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpsSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpsSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTPS \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
          const errStr = (error.message || "") + (error.code || "");
          if (errStr.includes("TLS") || errStr.includes("handshake") || errStr.includes("SSL") || errStr.includes("disconnected") || error.code === "ECONNRESET") {
            tlsHandshakeFailed = true;
          }
        }
      }
      let httpSuccess = false;
      const httpUrl = FOSU_BASE_URL2.replace(/^https:/i, "http:");
      console.log(`
3. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE HTTP \u7AEF\u53E3 ${httpUrl} ...`);
      try {
        const response = await axios2.get(httpUrl, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTP \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
        }
      }
      console.log(`
4. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1 ${FOSU_AUTH_URL} ...`);
      let authSuccess = false;
      try {
        await axios2.get(FOSU_AUTH_URL, {
          timeout: 8e3
        });
        console.log(`   \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u54CD\u5E94\u6B63\u5E38\u3002`);
        authSuccess = true;
      } catch (error) {
        console.log(`\u26A0\uFE0F  \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u8BBF\u95EE\u8B66\u544A (\u53EF\u80FD\u4E0D\u5F71\u54CD\u4F7F\u7528): ${error.message}`);
      }
      console.log(`
===================================`);
      if (httpsSuccess || httpSuccess) {
        console.log(`\u{1F389} \u8BCA\u65AD\u7ED3\u679C: \u672C\u673A\u6821\u5185\u7F51\u73AF\u5883\u6B63\u5E38\uFF01\u5DF2\u6210\u529F\u8FDE\u63A5\u5230\u6559\u52A1\u7F51\u3002`);
        console.log(`\u60A8\u53EF\u4EE5\u7EE7\u7EED\u8FD0\u884C 'npm run login' \u8FDB\u884C\u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected && tlsHandshakeFailed) {
        console.log(`\u2139\uFE0F  [NODE_TLS_HANDSHAKE_FAILED]`);
        console.log(`\u63D0\u793A: Node.js \u4E0E\u5B66\u6821\u5185\u7F51 HTTPS \u670D\u52A1\u63E1\u624B\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185 IP\uFF0C\u53EF\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u6D4F\u89C8\u5668\u767B\u5F55\u3002`);
        console.log(`\u8BF7\u8FD0\u884C 'npm run login'\uFF0CPlaywright \u6D4F\u89C8\u5668\u80FD\u591F\u5FFD\u7565\u6B64 TLS \u63E1\u624B\u95EE\u9898\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected) {
        console.log(`\u2139\uFE0F  \u63D0\u793A: \u867D\u7136 Node.js \u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185\u5185\u7F51 IP\uFF0C\u5141\u8BB8\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      console.error(`\u274C \u8BCA\u65AD\u7ED3\u679C: \u65E0\u6CD5\u8FDE\u63A5\u5230\u5B66\u6821\u6559\u52A1\u7F51\uFF01`);
      console.log(`\u{1F4A1} \u63D0\u793A: \u8BF7\u5148\u786E\u8BA4\u5DF2\u542F\u52A8\u5E76\u6210\u529F\u8FDE\u63A5\u4E86 EasyConnect VPN\u3002`);
      console.log(`===================================`);
      return false;
    }
    if (require.main === module2) {
      diagnose2().then((success) => {
        process.exit(success ? 0 : 1);
      });
    }
    module2.exports = diagnose2;
  }
});

// ../../server/src/utils/parser.js
var require_parser = __commonJS({
  "../../server/src/utils/parser.js"(exports2, module2) {
    var DEFAULT_TOTAL_WEEKS = 20;
    var TITLE_SUFFIXES = [
      "\u8BB2\u5E08\uFF08\u9AD8\u6821\uFF09",
      "\u8BB2\u5E08(\u9AD8\u6821)",
      "\u52A9\u7406\u7814\u7A76\u5458",
      "\u52A9\u7406\u5B9E\u9A8C\u5E08",
      "\u9AD8\u7EA7\u5B9E\u9A8C\u5E08",
      "\u7814\u7A76\u9986\u5458",
      "\u526F\u7814\u7A76\u5458",
      "\u9AD8\u7EA7\u5DE5\u7A0B\u5E08",
      "\u526F\u6559\u6388",
      "\u7814\u7A76\u5458",
      "\u5B9E\u9A8C\u5E08",
      "\u5DE5\u7A0B\u5E08",
      "\u6559\u6388",
      "\u8BB2\u5E08",
      "\u52A9\u6559",
      "\u8001\u5E08"
    ].sort((a, b) => b.length - a.length);
    var HTML_ENTITIES = {
      amp: "&",
      lt: "<",
      gt: ">",
      nbsp: " ",
      quot: '"',
      apos: "'"
    };
    function range(start, end) {
      const values = [];
      for (let value = start; value <= end; value += 1) {
        values.push(value);
      }
      return values;
    }
    function uniqueNumbers(numbers) {
      const seen = {};
      return numbers.filter((number) => {
        if (!number || seen[number]) {
          return false;
        }
        seen[number] = true;
        return true;
      }).sort((a, b) => a - b);
    }
    function decodeHtmlEntities(text) {
      return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match2, entity) => {
        const key = String(entity).toLowerCase();
        if (key[0] === "#") {
          const isHex = key[1] === "x";
          const code = parseInt(key.slice(isHex ? 2 : 1), isHex ? 16 : 10);
          return Number.isFinite(code) ? String.fromCharCode(code) : match2;
        }
        return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match2;
      });
    }
    function normalizeFullWidthDigits(text) {
      return String(text || "").replace(/[０-９]/g, (char) => {
        return String(char.charCodeAt(0) - 65296);
      });
    }
    function normalizeLineBreaks(text) {
      return decodeHtmlEntities(String(text || "")).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<hr\b[^>]*>/gi, "\n-----\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\r/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
    }
    function normalizeDash(text) {
      return String(text || "").replace(/[－—–~～至]/g, "-");
    }
    function stripTeacherTitle(name) {
      let value = String(name || "").trim();
      let changed = true;
      while (changed) {
        changed = false;
        TITLE_SUFFIXES.forEach((suffix) => {
          if (value.endsWith(suffix)) {
            value = value.slice(0, -suffix.length).trim();
            changed = true;
          }
        });
      }
      return value.trim();
    }
    function detectWeekType(rawText) {
      if (/双周|双/.test(rawText)) {
        return "even";
      }
      if (/单周|单/.test(rawText)) {
        return "odd";
      }
      return "all";
    }
    function filterWeekType(weeks, weekType) {
      return weeks.filter((week) => {
        if (weekType === "odd") {
          return week % 2 === 1;
        }
        if (weekType === "even") {
          return week % 2 === 0;
        }
        return true;
      });
    }
    function parseWeekText(text, options) {
      const config = options || {};
      const raw2 = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
      const weekType = detectWeekType(raw2);
      const defaultWeeks = range(config.defaultStartWeek || 1, config.defaultEndWeek || DEFAULT_TOTAL_WEEKS);
      const numericMatch = raw2.match(/[0-9]+(?:\s*-\s*[0-9]+)?(?:\s*[,，、]\s*[0-9]+(?:\s*-\s*[0-9]+)?)*\s*周?/);
      const clean = (numericMatch ? numericMatch[0] : raw2).replace(/第/g, "").replace(/周/g, "").replace(/[单双]/g, "").replace(/[()（）]/g, "").replace(/\s/g, "");
      const weeks = [];
      clean.split(/[，,、]/).forEach((part) => {
        if (!part) {
          return;
        }
        const rangeParts = part.split("-").filter(Boolean);
        if (rangeParts.length === 2) {
          const start = Number(rangeParts[0]);
          const end = Number(rangeParts[1]);
          if (start && end) {
            for (let week2 = start; week2 <= end; week2 += 1) {
              weeks.push(week2);
            }
          }
          return;
        }
        const week = Number(part);
        if (week) {
          weeks.push(week);
        }
      });
      const filteredWeeks = uniqueNumbers(filterWeekType(weeks.length ? weeks : defaultWeeks, weekType));
      return {
        startWeek: filteredWeeks[0] || 1,
        endWeek: filteredWeeks[filteredWeeks.length - 1] || 1,
        weeks: filteredWeeks,
        weekText: raw2 || config.defaultWeekText || "\u672A\u6807\u660E\u5468\u6B21",
        weekType
      };
    }
    function parseSectionText(text) {
      const value = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
      const match2 = value.match(/([\s\S]*?)[\[［【]([0-9\s,，、\-]+)[\]］】]\s*节?/);
      if (!match2) {
        return {
          classroom: value.replace(/^(教室|地点)[:：]/, "").trim(),
          startSection: 1,
          endSection: 1,
          hasSection: false
        };
      }
      const sections = match2[2].split(/[^0-9]+/).map((item) => Number(item.trim())).filter(Boolean);
      return {
        classroom: (match2[1] || "").replace(/^(教室|地点)[:：]/, "").trim(),
        startSection: sections[0] || 1,
        endSection: sections[sections.length - 1] || sections[0] || 1,
        hasSection: sections.length > 0
      };
    }
    function splitCourseBlocks(text) {
      return normalizeLineBreaks(text).split(/\n?\s*(?:-{5,}|—{3,}|─{3,}|={4,}|_{4,})\s*\n?/g).map((block) => block.trim()).filter(Boolean);
    }
    function isWeekLine(line) {
      return /([0-9０-９]+.*周|单周|双周)/.test(line);
    }
    function isSectionLine(line) {
      return /[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]\s*节?/.test(line);
    }
    function cleanCourseName(line) {
      return String(line || "").replace(/^(课程|课程名称)[:：]/, "").trim();
    }
    function cleanRemark(line) {
      return String(line || "").replace(/^备注[:：]?/, "").trim();
    }
    function dedupeStrings(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = String(value || "").trim();
        if (!text || seen[text]) {
          return;
        }
        seen[text] = true;
        result.push(text);
      });
      return result;
    }
    function getClassNameMatches(text) {
      const value = normalizeFullWidthDigits(decodeHtmlEntities(String(text || ""))).replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
      const matches = [];
      const pattern = /(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g;
      let match2 = null;
      while ((match2 = pattern.exec(value)) !== null) {
        matches.push(match2[0]);
      }
      return dedupeStrings(matches);
    }
    function splitClassNames(text) {
      const value = normalizeFullWidthDigits(decodeHtmlEntities(String(text || ""))).replace(/(?:上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]/g, " ").replace(/[；;,，、/／|]+/g, " ").replace(/\s+/g, " ").trim();
      return dedupeStrings(getClassNameMatches(value));
    }
    function getHiddenInputText(rawHtml) {
      const values = [];
      String(rawHtml || "").replace(/<input\b([^>]*)>/gi, (match2, attrText) => {
        const attrs = parseAttributes(attrText);
        const value = attrs.value || attrs.title || attrs.alt || "";
        if (value) {
          values.push(value);
        }
        return match2;
      });
      return values.join("\n");
    }
    function extractClassInfoFromText(rawText, options) {
      const config = options || {};
      const pieces = [
        rawText,
        config.className,
        config.cellTitle,
        config.hiddenInputText,
        config.nearbyText
      ].filter(Boolean);
      const text = normalizeLineBreaks(pieces.join("\n"));
      const labelMatches = [];
      const fieldMap = {};
      const labelPattern = /(上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]\s*([^\n\r<>{}]+)/g;
      let labelMatch = null;
      while ((labelMatch = labelPattern.exec(text)) !== null) {
        const label = labelMatch[1];
        const value = String(labelMatch[2] || "").trim();
        if (!value || /节次/.test(value)) {
          continue;
        }
        labelMatches.push(`${label}\uFF1A${value}`);
        const names = splitClassNames(value);
        if (/授课对象|上课对象/.test(label)) {
          fieldMap.audience = value;
        } else if (/教学班|上课班级/.test(label)) {
          fieldMap.teachingClass = value;
        } else if (/行政班|班级/.test(label)) {
          fieldMap.adminClass = value;
        }
        if (names.length) {
          fieldMap.classNames = (fieldMap.classNames || []).concat(names);
        }
      }
      const classNames = dedupeStrings((fieldMap.classNames || []).concat(splitClassNames(text)));
      return {
        className: classNames[0] || "",
        classNames,
        audience: fieldMap.audience || "",
        teachingClass: fieldMap.teachingClass || "",
        adminClass: fieldMap.adminClass || "",
        rawClassText: labelMatches.join("\n") || classNames.join("\u3001")
      };
    }
    function isClassNameLine(line) {
      const value = String(line || "").trim();
      return splitClassNames(value).length > 0 || /^(班级|行政班级|上课班级|授课对象)[:：]/.test(value);
    }
    function isClassInfoLine(line) {
      return /^(班级|行政班级|行政班|上课班级|授课对象|教学班|上课对象)[:：]/.test(String(line || "").trim());
    }
    function looksLikeLocationLine(line) {
      const value = String(line || "").trim();
      if (!value || isWeekLine(value) || isClassInfoLine(value)) {
        return false;
      }
      return /^[A-Za-z]\d[\w-]*|^\d+[A-Za-z]?[-－]\d+|楼|室|报告厅|实验室|语音室|校区|体育馆|操场/.test(value);
    }
    function looksLikeCourseStart(lines, index) {
      const line = String(lines[index] || "").trim();
      if (!line || isWeekLine(line) || isSectionLine(line) || isClassInfoLine(line) || looksLikeLocationLine(line)) {
        return false;
      }
      for (let offset = 1; offset <= 3; offset += 1) {
        if (isWeekLine(lines[index + offset] || "")) {
          return true;
        }
      }
      return false;
    }
    function splitSequentialCourseBlock(block) {
      const lines = String(block || "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 5) {
        return [String(block || "").trim()].filter(Boolean);
      }
      const blocks = [];
      let start = 0;
      while (start < lines.length) {
        const weekIndex = lines.findIndex((line, index) => index > start && isWeekLine(line));
        if (weekIndex < 0) {
          const rest = lines.slice(start).join("\n").trim();
          if (rest) {
            blocks.push(rest);
          }
          break;
        }
        let nextStart = -1;
        for (let index = weekIndex + 1; index < lines.length; index += 1) {
          if (looksLikeCourseStart(lines, index)) {
            nextStart = index;
            break;
          }
        }
        const end = nextStart >= 0 ? nextStart : lines.length;
        const current = lines.slice(start, end).join("\n").trim();
        if (current) {
          blocks.push(current);
        }
        if (nextStart < 0) {
          break;
        }
        start = nextStart;
      }
      return blocks;
    }
    function parseCourseText(rawText, options) {
      const config = options || {};
      return splitCourseBlocks(rawText).reduce((list, block) => list.concat(splitSequentialCourseBlock(block)), []).map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
          return null;
        }
        const weekIndex = lines.findIndex(isWeekLine);
        const sectionIndex = lines.findIndex(isSectionLine);
        const remarkIndexes = {};
        const ignoreIndexes = {};
        lines.forEach((line, lineIndex) => {
          if (/^备注[:：]?/.test(line)) {
            remarkIndexes[lineIndex] = true;
          }
        });
        const courseName = cleanCourseName(lines[0]);
        let teacherName = "";
        let locationLine = "";
        const classInfo = extractClassInfoFromText(block, {
          className: config.className,
          cellTitle: config.cellTitle,
          hiddenInputText: config.hiddenInputText,
          nearbyText: config.nearbyText
        });
        lines.forEach((line, lineIndex) => {
          if (lineIndex === 0 || lineIndex === weekIndex || lineIndex === sectionIndex || remarkIndexes[lineIndex]) {
            return;
          }
          if (isClassInfoLine(line) || isClassNameLine(line)) {
            ignoreIndexes[lineIndex] = true;
          } else if (weekIndex >= 0 && lineIndex > weekIndex && !locationLine) {
            locationLine = line;
          } else if (weekIndex < 0 && looksLikeLocationLine(line) && !locationLine) {
            locationLine = line;
          } else if (lineIndex < weekIndex && !teacherName) {
            teacherName = stripTeacherTitle(line);
          } else if (!teacherName && weekIndex < 0 && !looksLikeLocationLine(line)) {
            teacherName = stripTeacherTitle(line);
          } else if (line !== locationLine) {
            remarkIndexes[lineIndex] = true;
          }
        });
        const weekLine = weekIndex >= 0 ? lines[weekIndex] : "";
        const sectionLine = sectionIndex >= 0 ? lines[sectionIndex] : locationLine;
        const weekInfo = parseWeekText(weekLine, {
          defaultStartWeek: config.defaultStartWeek || 1,
          defaultEndWeek: config.defaultEndWeek || DEFAULT_TOTAL_WEEKS
        });
        const sectionInfo = parseSectionText(sectionLine);
        const remark = lines.filter((line, lineIndex) => remarkIndexes[lineIndex] && !ignoreIndexes[lineIndex]).map(cleanRemark).filter(Boolean).join("\n");
        return Object.assign(
          {
            id: `${config.idPrefix || "parsed-course"}-${index + 1}`,
            source: config.source || "school",
            semester: config.semester || "",
            className: classInfo.className || config.className || "",
            classNames: classInfo.classNames || [],
            audience: classInfo.audience || "",
            teachingClass: classInfo.teachingClass || "",
            adminClass: classInfo.adminClass || "",
            rawClassText: classInfo.rawClassText || "",
            courseName,
            teacherName,
            classroom: sectionInfo.classroom,
            weekday: config.weekday || 1,
            startSection: sectionInfo.hasSection ? sectionInfo.startSection : config.fallbackStartSection || sectionInfo.startSection,
            endSection: sectionInfo.hasSection ? sectionInfo.endSection : config.fallbackEndSection || sectionInfo.endSection,
            startWeek: weekInfo.startWeek,
            endWeek: weekInfo.endWeek,
            weeks: weekInfo.weeks,
            weekText: weekInfo.weekText,
            weekType: weekInfo.weekType,
            color: config.color || "",
            remark,
            rawText: block,
            rawHtml: config.rawHtml || ""
          },
          config.extra || {}
        );
      }).filter((course) => course && course.courseName);
    }
    function parseAttributes(tag) {
      const attrs = {};
      String(tag || "").replace(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (match2, key, raw2, doubleValue, singleValue, bareValue) => {
        attrs[key.toLowerCase()] = decodeHtmlEntities(doubleValue || singleValue || bareValue || "");
        return match2;
      });
      return attrs;
    }
    function extractKbTableHtml(html) {
      const source = String(html || "");
      const tableMatch = source.match(/<table\b[^>]*id=["']?kbtable["']?[^>]*>[\s\S]*?<\/table>/i);
      if (tableMatch) {
        return tableMatch[0];
      }
      const fallback = source.match(/<table\b[\s\S]*?<\/table>/i);
      return fallback ? fallback[0] : "";
    }
    function parseTableRows(tableHtml) {
      const rows = [];
      String(tableHtml || "").replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (rowMatch, rowHtml) => {
        const cells = [];
        rowHtml.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (cellMatch, tagName, attrText, innerHtml) => {
          cells.push({
            tagName: String(tagName || "").toLowerCase(),
            attrs: parseAttributes(attrText),
            html: innerHtml,
            rawHtml: cellMatch,
            text: normalizeLineBreaks(innerHtml).trim()
          });
          return cellMatch;
        });
        rows.push(cells);
        return rowMatch;
      });
      return rows;
    }
    function parseHeaderSectionText(text) {
      const value = normalizeFullWidthDigits(String(text || "")).replace(/\s+/g, "");
      if (!value) {
        return null;
      }
      const bracketMatch = value.match(/[\[［【]?([0-9,，、\-]+)[\]］】]?/);
      const raw2 = bracketMatch ? bracketMatch[1] : value;
      let sections = [];
      if (/^\d{4,}$/.test(raw2) && raw2.length % 2 === 0) {
        sections = raw2.match(/\d{2}/g).map(Number);
      } else {
        sections = raw2.split(/[^0-9]+/).map(Number).filter(Boolean);
      }
      sections = sections.filter(Boolean);
      if (!sections.length) {
        return null;
      }
      return {
        startSection: sections[0],
        endSection: sections[sections.length - 1]
      };
    }
    function isLikelyCourseCell(text) {
      const value = String(text || "").trim();
      if (!value) {
        return false;
      }
      if (/星期|周[一二三四五六日]|节次|上午|下午|晚上|时间/.test(value) && value.length <= 20) {
        return false;
      }
      return /[0-9０-９]+.*周|单周|双周|[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]|教师|教室|班级/.test(value);
    }
    function getColumnGroupSize(rows) {
      const maxCells = rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (maxCells <= 8) {
        return 1;
      }
      return Math.max(1, Math.round((maxCells - 1) / 7));
    }
    function parseScheduleHtml(html, context, parserOptions) {
      const config = parserOptions || {};
      const tableHtml = extractKbTableHtml(html);
      const warnings = [];
      if (!tableHtml) {
        return {
          courses: [],
          warnings: ["\u672A\u627E\u5230 table#kbtable"],
          meta: {
            rowCount: 0,
            columnGroupSize: 1
          }
        };
      }
      const rows = parseTableRows(tableHtml);
      const columnGroupSize = getColumnGroupSize(rows);
      const courses = [];
      const meta2 = {
        rowCount: rows.length,
        firstRowColumnCounts: rows.slice(0, 3).map((row) => row.length),
        columnGroupSize
      };
      rows.forEach((row, rowIndex) => {
        const rowHeader = row[0] ? normalizeLineBreaks(row[0].html || row[0].text).trim() : "";
        const rowClassInfo = extractClassInfoFromText(rowHeader);
        const rowClassName = rowClassInfo.className || "";
        row.forEach((cell, cellIndex) => {
          if (cellIndex === 0 || !isLikelyCourseCell(cell.text)) {
            return;
          }
          try {
            const dataColumnIndex = Math.max(0, cellIndex - 1);
            const weekday = Math.min(7, Math.floor(dataColumnIndex / columnGroupSize) + 1);
            const headerSection = parseHeaderSectionText(rows[1] && rows[1][cellIndex] ? rows[1][cellIndex].text : "");
            const fallbackSection = headerSection ? headerSection.startSection : Math.max(1, rowIndex);
            const fallbackEndSection = headerSection ? headerSection.endSection : fallbackSection;
            const effectiveClassName = rowClassName || context && context.className || "";
            const hiddenInputText = getHiddenInputText(cell.rawHtml);
            const parsed2 = parseCourseText(cell.html, {
              idPrefix: `${config.idPrefix || "schedule"}-${rowIndex}-${cellIndex}`,
              source: config.source || "school",
              semester: context && context.semester,
              className: effectiveClassName,
              cellTitle: cell.attrs.title || "",
              hiddenInputText,
              nearbyText: [rowHeader, cell.attrs.title || ""].filter(Boolean).join("\n"),
              weekday,
              fallbackStartSection: fallbackSection,
              fallbackEndSection,
              rawHtml: cell.rawHtml,
              extra: Object.assign(
                {
                  audienceType: config.audienceType || "student",
                  sourceType: config.sourceType || "class"
                },
                context && context.extra
              )
            }).map((course) => Object.assign({}, course, {
              rawHtml: cell.rawHtml,
              sourceType: config.sourceType || course.sourceType,
              audienceType: config.audienceType || course.audienceType
            }));
            if (!parsed2.length) {
              warnings.push(`\u7B2C${rowIndex + 1}\u884C\u7B2C${cellIndex + 1}\u5217\u672A\u89E3\u6790\u51FA\u8BFE\u7A0B`);
              return;
            }
            courses.push.apply(courses, parsed2);
          } catch (error) {
            warnings.push(`\u7B2C${rowIndex + 1}\u884C\u7B2C${cellIndex + 1}\u5217\u89E3\u6790\u5931\u8D25\uFF1A${error.message}`);
          }
        });
      });
      return {
        courses,
        warnings,
        meta: meta2
      };
    }
    function extractClassNameCandidates(html, context) {
      const source = String(html || "");
      const text = normalizeLineBreaks(source).replace(/\n{3,}/g, "\n\n");
      const keywords = ["\u884C\u653F\u73ED", "\u73ED\u7EA7", "\u4E0A\u8BFE\u73ED\u7EA7", "\u6388\u8BFE\u5BF9\u8C61", "25\u52A8\u7269", "24", "2025"];
      const candidates = [];
      const classNames = [];
      keywords.forEach((keyword) => {
        let start = 0;
        while (start < text.length) {
          const index = text.indexOf(keyword, start);
          if (index < 0) {
            break;
          }
          const snippet = text.slice(Math.max(0, index - 80), Math.min(text.length, index + 180)).replace(/\s+/g, " ").trim();
          const names = splitClassNames(snippet);
          if (snippet) {
            candidates.push({
              source: "keyword",
              keyword,
              text: snippet,
              classNames: names
            });
          }
          classNames.push.apply(classNames, names);
          start = index + keyword.length;
        }
      });
      const tableHtml = extractKbTableHtml(source);
      parseTableRows(tableHtml).forEach((row, rowIndex) => {
        const rowHeader = row[0] ? normalizeLineBreaks(row[0].html || row[0].text).trim() : "";
        const names = splitClassNames(rowHeader);
        if (names.length) {
          candidates.push({
            source: "row-header",
            rowIndex,
            text: rowHeader,
            classNames: names
          });
          classNames.push.apply(classNames, names);
        }
        row.forEach((cell, cellIndex) => {
          const values = [cell.attrs.title || "", getHiddenInputText(cell.rawHtml)].filter(Boolean);
          values.forEach((value) => {
            const namesFromValue = splitClassNames(value);
            if (namesFromValue.length) {
              candidates.push({
                source: "cell-attribute",
                rowIndex,
                cellIndex,
                text: value,
                classNames: namesFromValue
              });
              classNames.push.apply(classNames, namesFromValue);
            }
          });
        });
      });
      return {
        semester: context && context.semester,
        majorCode: context && context.majorCode,
        majorName: context && context.majorName,
        classNames: dedupeStrings(classNames),
        candidates
      };
    }
    function parsePersonalScheduleHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "personal",
        source: "school",
        sourceType: "personal",
        audienceType: "student"
      });
    }
    function parseClassScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "class-ifr",
        source: "school",
        sourceType: "class",
        audienceType: "student"
      });
    }
    function parseTeacherScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "teacher-ifr",
        source: "school",
        sourceType: "teacher",
        audienceType: "teacher"
      });
    }
    function parseClassroomScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "classroom-ifr",
        source: "school",
        sourceType: "classroom",
        audienceType: "classroom"
      });
    }
    function parseCourseScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "course-ifr",
        source: "school",
        sourceType: "course",
        audienceType: "course"
      });
    }
    function parseOptionTags(selectHtml) {
      const options = [];
      String(selectHtml || "").replace(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi, (match2, attrText, labelHtml) => {
        const attrs = parseAttributes(attrText);
        const name = normalizeLineBreaks(labelHtml).trim();
        const code = attrs.value || attrs.code || "";
        if (code || name) {
          options.push({ code, name });
        }
        return match2;
      });
      return options.filter((item) => item.name && !/^请选择|^全部/.test(item.name));
    }
    function extractSelectOptions(html, patterns) {
      const source = String(html || "");
      const result = [];
      source.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi, (match2, attrText, innerHtml) => {
        const attrs = parseAttributes(attrText);
        const marker = `${attrs.name || ""} ${attrs.id || ""}`.toLowerCase();
        if (patterns.some((pattern) => pattern.test(marker))) {
          result.push.apply(result, parseOptionTags(innerHtml));
        }
        return match2;
      });
      return result;
    }
    function parseSchoolOptionsHtml(html) {
      const semesters = extractSelectOptions(html, [/xnxq/, /xnxqh/, /semester/]);
      const colleges = extractSelectOptions(html, [/skyx/, /xy/, /college/]);
      const grades = extractSelectOptions(html, [/sknj/, /nj/, /grade/]).map((item) => item.code || item.name);
      return {
        semesters,
        colleges,
        grades,
        majors: [],
        warnings: [],
        meta: {
          hasKbtable: Boolean(extractKbTableHtml(html))
        }
      };
    }
    function tryParseJsonLike(text) {
      const raw2 = String(text || "").trim();
      const jsonStart = raw2.search(/[\[{]/);
      const jsonEnd = Math.max(raw2.lastIndexOf("]"), raw2.lastIndexOf("}"));
      const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? raw2.slice(jsonStart, jsonEnd + 1) : raw2;
      try {
        return JSON.parse(jsonText);
      } catch (error) {
        const relaxed = jsonText.replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":');
        return JSON.parse(relaxed);
      }
    }
    function normalizeMajorItem2(item, context) {
      const source = item || {};
      return {
        code: String(source.code || source.value || source.dm || source.zydm || source.zyh || source.id || ""),
        name: String(source.name || source.text || source.label || source.mc || source.zymc || source.zy || ""),
        collegeCode: String(context && context.collegeCode || source.collegeCode || source.skyx || ""),
        grade: String(context && context.grade || source.grade || source.sknj || "")
      };
    }
    function parseMajorAjaxResponse(text, context) {
      const warnings = [];
      let payload = [];
      try {
        payload = tryParseJsonLike(text);
      } catch (error) {
        warnings.push(`\u4E13\u4E1A\u8054\u52A8\u54CD\u5E94\u4E0D\u662F\u6807\u51C6 JSON\uFF1A${error.message}`);
        payload = [];
      }
      const list = Array.isArray(payload) ? payload : payload && (payload.rows || payload.data || payload.list || payload.majors) || [];
      const majors = (Array.isArray(list) ? list : []).map((item) => normalizeMajorItem2(item, context || {})).filter((item) => item.code || item.name);
      return {
        majors,
        warnings,
        meta: {
          count: majors.length
        }
      };
    }
    module2.exports = {
      decodeHtmlEntities,
      normalizeDash,
      normalizeFullWidthDigits,
      normalizeLineBreaks,
      parseClassScheduleIfrHtml,
      parseClassroomScheduleIfrHtml,
      parseCourseText,
      extractClassInfoFromText,
      extractClassNameCandidates,
      parseCourseScheduleIfrHtml,
      parseMajorAjaxResponse,
      parsePersonalScheduleHtml,
      parseSchoolOptionsHtml,
      parseSectionText,
      parseTeacherScheduleIfrHtml,
      parseWeekText,
      splitCourseBlocks,
      stripTeacherTitle
    };
  }
});

// ../../server/src/utils/courseNormalizer.js
var require_courseNormalizer = __commonJS({
  "../../server/src/utils/courseNormalizer.js"(exports2, module2) {
    var UNKNOWN_CLASSROOM_TEXT = "\u5F85\u8865\u5145";
    var MULTI_VENUE_TEXT = "\u591A\u4E2A\u5730\u70B9";
    var MULTI_TEACHER_TEXT = "\u591A\u4E2A\u6559\u5E08";
    var NOTICE_TEACHER_TEXT = "\u89C1\u901A\u77E5";
    var PE_NOTICE_TEXT = "\u4F53\u80B2\u8BFE\u5730\u70B9\u4EE5\u6559\u5E08/\u5B9E\u9645\u9009\u8BFE\u901A\u77E5\u4E3A\u51C6";
    var COURSE_KEYWORDS = [
      "\u5316\u5B66",
      "\u751F\u7269\u5316\u5B66",
      "\u52A8\u7269\u5B66",
      "\u6709\u673A\u5316\u5B66",
      "\u89E3\u5256",
      "\u82F1\u8BED",
      "\u6570\u5B66",
      "\u7269\u7406",
      "\u4F53\u80B2",
      "\u601D\u60F3",
      "\u653F\u6CBB",
      "\u5C31\u4E1A",
      "\u5B9E\u9A8C",
      "\u5DE5\u7A0B",
      "\u8BBE\u8BA1",
      "\u7BA1\u7406",
      "\u6CD5\u5B66",
      "\u533B\u5B66",
      "\u836F\u5B66",
      "\u8BA1\u7B97\u673A",
      "\u4EBA\u5DE5\u667A\u80FD",
      "\u5199\u4F5C",
      "\u9605\u8BFB",
      "\u5FC3\u7406",
      "\u521B\u65B0\u521B\u4E1A",
      "\u751F\u7406",
      "\u75C5\u7406",
      "\u5FAE\u751F\u7269",
      "\u9057\u4F20",
      "\u80B2\u79CD",
      "\u8425\u517B",
      "\u9972\u6599",
      "\u98DF\u54C1",
      "\u5B89\u5168\u6559\u80B2",
      "\u804C\u4E1A\u53D1\u5C55",
      "\u5F62\u52BF\u4E0E\u653F\u7B56",
      "\u519B\u4E8B\u7406\u8BBA",
      "\u52B3\u52A8\u6559\u80B2",
      "\u9A6C\u514B\u601D",
      "\u8FD1\u73B0\u4EE3\u53F2",
      "\u6BDB\u6CFD\u4E1C",
      "\u6982\u8BBA",
      "\u9AD8\u7B49\u6570\u5B66",
      "\u7EBF\u6027\u4EE3\u6570",
      "\u6982\u7387",
      "\u5927\u5B66\u751F",
      "\u5BFC\u8BBA",
      "\u539F\u7406",
      "\u57FA\u7840",
      "\u6280\u672F",
      "\u8BAD\u7EC3",
      "\u5B9E\u8BAD",
      "\u5B9E\u4E60",
      "\u8BFE\u7A0B",
      "\u4E13\u9898",
      "\u901A\u8BC6",
      "\u97F3\u4E50",
      "\u7F8E\u672F",
      "\u7ECF\u6D4E",
      "\u91D1\u878D",
      "\u4F1A\u8BA1",
      "\u7EDF\u8BA1",
      "\u8F6F\u4EF6",
      "\u7F51\u7EDC",
      "\u6570\u636E\u5E93"
    ];
    var STRONG_VENUE_TERMS = [
      "\u4F53\u80B2\u9986",
      "\u8FD0\u52A8\u573A",
      "\u6E38\u6CF3\u6C60",
      "\u7403\u573A",
      "\u7BEE\u7403\u573A",
      "\u8DB3\u7403\u573A",
      "\u7F51\u7403\u573A",
      "\u7FBD\u6BDB\u7403\u9986",
      "\u4E52\u4E53\u7403\u9986",
      "\u5065\u8EAB\u623F",
      "\u821E\u8E48\u5BA4",
      "\u9F99\u821F\u7801\u5934",
      "\u4ED9\u6EAA\u6E56",
      "\u64CD\u573A",
      "\u62A5\u544A\u5385",
      "\u8BED\u97F3\u5BA4",
      "\u673A\u623F",
      "\u4F1A\u8BAE\u5BA4",
      "\u5B9E\u8BAD\u5BA4",
      "\u753B\u5BA4",
      "\u5B9E\u9A8C\u5BA4",
      "\u5728\u7EBF\u8BFE\u7A0B",
      "\u7F51\u7EDC\u6559\u5B66\u5E73\u53F0"
    ];
    var VENUE_TERMS = [
      "\u697C",
      "\u5BA4",
      "\u9986",
      "\u573A",
      "\u6C60",
      "\u7801\u5934",
      "\u6821\u533A",
      "\u4E2D\u5FC3",
      "\u5E73\u53F0",
      "\u5385",
      "\u6559\u5BA4",
      "\u5B9E\u9A8C\u5BA4",
      "\u4ED9\u6EAA",
      "\u6C5F\u6E7E",
      "\u6CB3\u6EE8",
      "\u64CD\u573A",
      "\u7530\u5F84",
      "\u4F53\u80B2"
    ];
    var EMPTY_LIKE_TEXTS = /* @__PURE__ */ new Set([
      "",
      "\u5F85\u8865\u5145",
      "\u6682\u65E0",
      "\u65E0",
      "\u672A\u77E5",
      "\u81EA\u884C\u5B89\u6392",
      "\u5F85\u5B9A",
      "\u672A\u5B89\u6392",
      "\u591A\u4E2A\u5730\u70B9",
      "\u591A\u4E2A\u6559\u5E08",
      "\u89C1\u901A\u77E5",
      "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5"
    ]);
    function toText(value) {
      return String(value == null ? "" : value);
    }
    function toHalfWidth(value) {
      return toText(value).replace(/\u3000/g, " ").replace(
        /[\uff01-\uff5e]/g,
        (char) => String.fromCharCode(char.charCodeAt(0) - 65248)
      );
    }
    function cleanDisplayText(value) {
      return toHalfWidth(value).replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[，]/g, ",").replace(/[；]/g, ";").replace(/[：]/g, ":").replace(/[【]/g, "[").replace(/[】]/g, "]").replace(/\s+/g, " ").trim();
    }
    function normalizeText(text) {
      return cleanDisplayText(text).replace(/[第周节]/g, "").replace(/[()\[\]{}<>《》「」『』"'`]/g, "").replace(/[.,;:，。；：、/\\|_-]/g, "").replace(/\s+/g, "").trim();
    }
    function isEmptyLike(value) {
      return EMPTY_LIKE_TEXTS.has(cleanDisplayText(value));
    }
    function hasAnyKeyword(text, keywords) {
      const normalized = normalizeText(text);
      return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
    }
    function hasCourseKeyword(text) {
      return hasAnyKeyword(text, COURSE_KEYWORDS);
    }
    function hasVenueSignal(text) {
      return hasAnyKeyword(text, STRONG_VENUE_TERMS) || hasAnyKeyword(text, VENUE_TERMS);
    }
    function isClassroomCodeLike(text) {
      const compact = cleanDisplayText(text).replace(/\s+/g, "");
      return /^[A-Za-z]\d{1,2}[-－—]?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) || /^[A-Za-z]\d{1,2}(?:号)?楼?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) || /^[A-Za-z]{1,3}[-－—]?\d{2,4}(?:教室|室|厅)?$/.test(compact);
    }
    function isStrongVenueText(text) {
      const compact = normalizeText(text);
      if (!compact || isEmptyLike(compact)) {
        return false;
      }
      if (isClassroomCodeLike(text)) {
        return true;
      }
      const matched = STRONG_VENUE_TERMS.some((term) => compact.includes(normalizeText(term)));
      if (!matched) {
        return false;
      }
      if (hasCourseKeyword(text) && /(教育|课程|技术|概论|导论|训练|实训)$/.test(compact)) {
        return false;
      }
      return true;
    }
    function isCourseLike(text) {
      const display = cleanDisplayText(text);
      const compact = normalizeText(display);
      if (!compact || isEmptyLike(display)) {
        return false;
      }
      if (/^(?:大学)?体育[1-4]?$/.test(compact) || /^大学[\u4e00-\u9fa5A-Za-z]+[1-4]$/.test(compact)) {
        return true;
      }
      if (hasCourseKeyword(display)) {
        return true;
      }
      const chineseChars = compact.match(/[\u4e00-\u9fa5]/g) || [];
      const looksLikeLongCourseName = chineseChars.length >= 6 && !hasVenueSignal(display) && !/^[\u4e00-\u9fa5]{2,4}$/.test(compact);
      return looksLikeLongCourseName;
    }
    function isVenueLike(text) {
      const display = cleanDisplayText(text);
      const compact = normalizeText(display);
      if (!compact || isEmptyLike(display)) {
        return false;
      }
      if (isClassroomCodeLike(display) || isStrongVenueText(display)) {
        return true;
      }
      if (!hasAnyKeyword(display, VENUE_TERMS)) {
        return false;
      }
      if (isCourseLike(display)) {
        return false;
      }
      return true;
    }
    function splitPersonNameCandidates(text) {
      return cleanDisplayText(text).split(/[\/,，;；、\s]+/).map((item) => item.trim()).filter(Boolean);
    }
    function isSinglePersonNameLike(text) {
      const compact = normalizeText(text);
      return /^[\u4e00-\u9fa5]{2,4}$/.test(compact) && !hasCourseKeyword(compact) && !isVenueLike(compact);
    }
    function isPersonNameLike(text) {
      const parts = splitPersonNameCandidates(text);
      if (!parts.length) {
        return false;
      }
      return parts.every(isSinglePersonNameLike);
    }
    function isPhysicalEducationLike(course) {
      const item = course || {};
      const values = [
        item.displayCourseName,
        item.canonicalCourseName,
        item.courseName,
        item.name,
        item.title,
        item.teacherName,
        item.teacher,
        item.rawText
      ];
      if (values.some((value) => /大学体育|体育/.test(cleanDisplayText(value)))) {
        return true;
      }
      const rawCourseName = cleanDisplayText(item.courseName || item.name || item.title);
      const rawTeacherName = cleanDisplayText(item.teacherName || item.teacher);
      return isVenueLike(rawCourseName) && isCourseLike(rawTeacherName) && /体育/.test(rawTeacherName);
    }
    function firstText(values) {
      for (const value of values) {
        const text = cleanDisplayText(value);
        if (text) {
          return text;
        }
      }
      return "";
    }
    function splitRawTextCandidates(text) {
      const raw2 = cleanDisplayText(text);
      const candidates = raw2.split(/[\n\r\t|;；,，、]+/).map((item) => item.replace(/^(课程|课程名|名称|教师|老师|地点|教室)[:：]/, "").trim()).filter(Boolean);
      const peMatches = raw2.match(/大学体育[1-4]?|体育[1-4]?/g);
      if (peMatches) {
        candidates.push.apply(candidates, peMatches);
      }
      return candidates;
    }
    function extractCourseNameCandidate(rawCourse, fields) {
      const item = rawCourse || {};
      const candidates = [];
      [fields.teacherName, item.rawText, item.title, item.name].forEach((value) => {
        splitRawTextCandidates(value).forEach((candidate) => candidates.push(candidate));
      });
      for (const candidate of candidates) {
        if (isCourseLike(candidate) && !isVenueLike(candidate)) {
          return cleanDisplayText(candidate);
        }
      }
      return "";
    }
    function normalizeCourseIdentity(rawCourse, context) {
      const source = rawCourse || {};
      const config = context || {};
      const originalCourseName = firstText([source.courseName, source.name, source.title]);
      const originalTeacherName = firstText([source.teacherName, source.teacher]);
      const originalClassroom = firstText([source.classroom]);
      const rawText = firstText([source.rawText, config.rawText]);
      let displayCourseName = originalCourseName;
      let displayClassroom = originalClassroom;
      let displayTeacherName = originalTeacherName;
      let courseIdentityType = "normal";
      let normalizationReason = "normal";
      let isTeacherFieldActuallyCourseName = false;
      const courseNameIsVenue = isVenueLike(originalCourseName);
      const teacherNameIsCourse = isCourseLike(originalTeacherName);
      const teacherNameIsPeCourse = teacherNameIsCourse && /大学体育|体育/.test(originalTeacherName);
      if (courseNameIsVenue && originalTeacherName && (teacherNameIsCourse || teacherNameIsPeCourse)) {
        displayCourseName = originalTeacherName;
        displayClassroom = originalCourseName;
        displayTeacherName = NOTICE_TEACHER_TEXT;
        courseIdentityType = "venue_as_course";
        normalizationReason = "courseName_is_venue_teacherName_is_course";
        isTeacherFieldActuallyCourseName = true;
      } else if (!originalCourseName && teacherNameIsCourse) {
        displayCourseName = originalTeacherName;
        displayTeacherName = "";
        courseIdentityType = "teacher_as_course";
        normalizationReason = "teacherName_used_as_courseName";
        isTeacherFieldActuallyCourseName = true;
      } else if (courseNameIsVenue && !originalClassroom) {
        const extractedCourseName = extractCourseNameCandidate(source, {
          teacherName: originalTeacherName,
          rawText
        });
        if (extractedCourseName && normalizeText(extractedCourseName) !== normalizeText(originalCourseName)) {
          displayCourseName = extractedCourseName;
          displayClassroom = originalCourseName;
          if (normalizeText(originalTeacherName) === normalizeText(extractedCourseName)) {
            displayTeacherName = "";
            isTeacherFieldActuallyCourseName = true;
          }
          courseIdentityType = "venue_promoted_to_classroom";
          normalizationReason = "courseName_is_venue_extracted_courseName";
        }
      }
      if (!displayCourseName) {
        const extractedCourseName = extractCourseNameCandidate(source, {
          teacherName: originalTeacherName,
          rawText
        });
        if (extractedCourseName) {
          displayCourseName = extractedCourseName;
          normalizationReason = normalizationReason === "normal" ? "rawText_used_as_courseName" : normalizationReason;
        }
      }
      if (!displayClassroom && courseNameIsVenue && displayCourseName !== originalCourseName) {
        displayClassroom = originalCourseName;
      }
      const result = Object.assign({}, source, {
        rawCourseName: source.rawCourseName || originalCourseName,
        rawTeacherName: source.rawTeacherName || originalTeacherName,
        rawClassroom: source.rawClassroom || originalClassroom,
        venueCandidates: uniqueTexts([].concat(
          Array.isArray(source.venueCandidates) ? source.venueCandidates : [],
          courseNameIsVenue ? originalCourseName : "",
          isVenueLike(originalClassroom) ? originalClassroom : ""
        )),
        displayCourseName: cleanDisplayText(displayCourseName),
        canonicalCourseName: cleanDisplayText(displayCourseName),
        displayClassroom: cleanDisplayText(displayClassroom),
        canonicalClassroom: cleanDisplayText(displayClassroom),
        displayTeacherName: cleanDisplayText(displayTeacherName),
        canonicalTeacherName: cleanDisplayText(displayTeacherName),
        courseIdentityType,
        normalizationReason,
        isVenueCandidate: courseNameIsVenue,
        isTeacherFieldActuallyCourseName,
        isPhysicalEducationLike: false
      });
      result.isPhysicalEducationLike = isPhysicalEducationLike(result);
      if (result.isPhysicalEducationLike && result.courseIdentityType === "normal") {
        result.courseIdentityType = "physical_education";
      }
      return result;
    }
    function shouldKeepTeacherName(name) {
      const text = cleanDisplayText(name);
      return Boolean(text) && !isEmptyLike(text) && text !== NOTICE_TEACHER_TEXT && text !== MULTI_TEACHER_TEXT && text !== "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5" && !isCourseLike(text);
    }
    function shouldKeepVenueName(name) {
      const text = cleanDisplayText(name);
      return Boolean(text) && !isEmptyLike(text) && text !== UNKNOWN_CLASSROOM_TEXT && text !== MULTI_VENUE_TEXT;
    }
    function uniqueTexts(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = cleanDisplayText(value);
        const key = normalizeText(text);
        if (!text || !key || seen[key]) {
          return;
        }
        seen[key] = true;
        result.push(text);
      });
      return result;
    }
    function toRenderableCourse(course) {
      const normalized = normalizeCourseIdentity(course);
      const title = normalized.displayCourseName || normalized.canonicalCourseName || normalized.courseName || "";
      const classroom = normalized.displayClassroom || normalized.canonicalClassroom || normalized.classroom || "";
      const teacherName = normalized.displayTeacherName || normalized.canonicalTeacherName || normalized.teacherName || "";
      return Object.assign({}, normalized, {
        courseName: title,
        classroom,
        teacherName
      });
    }
    function buildTodayDisplayGroupKey(course, context) {
      const config = context || {};
      const sem = course.semester || config.semester || "";
      const classKey = config.classId || course.classId || config.className || course.className || "";
      const currentWeek = config.currentWeek || "";
      const weekday = config.weekday || course.weekday || "";
      const canonicalCourseName = normalizeText(
        course.canonicalCourseName || course.displayCourseName || course.courseName || ""
      );
      return [
        sem,
        classKey,
        currentWeek,
        weekday,
        course.startSection || "",
        course.endSection || "",
        canonicalCourseName
      ].join("_");
    }
    function mergeCanonicalCoursesForDisplay(courses, context) {
      const config = context || {};
      const normalizedCourses = (courses || []).map(toRenderableCourse);
      const strictSeen = {};
      const strictUniqueCourses = [];
      normalizedCourses.forEach((course) => {
        const strictKey = [
          course.semester || config.semester || "",
          course.classId || config.classId || course.className || config.className || "",
          config.currentWeek || "",
          config.weekday || course.weekday || "",
          course.startSection || "",
          course.endSection || "",
          normalizeText(course.canonicalCourseName || course.courseName || ""),
          normalizeText(course.canonicalClassroom || course.classroom || ""),
          normalizeText(course.canonicalTeacherName || course.teacherName || "")
        ].join("_");
        if (!strictSeen[strictKey]) {
          strictSeen[strictKey] = true;
          strictUniqueCourses.push(course);
        }
      });
      const groups = {};
      const groupKeys = [];
      strictUniqueCourses.forEach((course) => {
        const groupKey = buildTodayDisplayGroupKey(course, config);
        if (!groups[groupKey]) {
          groups[groupKey] = [];
          groupKeys.push(groupKey);
        }
        groups[groupKey].push(course);
      });
      const displayCourses = [];
      const mergedGroups = [];
      groupKeys.forEach((key) => {
        const group = groups[key];
        if (group.length === 1) {
          displayCourses.push(toRenderableCourse(group[0]));
          return;
        }
        const base = toRenderableCourse(group[0]);
        const canonicalCourseName = base.canonicalCourseName || base.displayCourseName || base.courseName;
        const venues = uniqueTexts(group.reduce((items2, item) => {
          if (Array.isArray(item.venueCandidates)) {
            items2.push.apply(items2, item.venueCandidates);
          }
          items2.push(item.displayClassroom || item.canonicalClassroom || item.classroom);
          return items2;
        }, []).filter(shouldKeepVenueName));
        const teachers = uniqueTexts(group.filter((item) => !item.isTeacherFieldActuallyCourseName).map((item) => item.displayTeacherName || item.canonicalTeacherName || item.teacherName).filter(shouldKeepTeacherName));
        const isPe = group.some((item) => item.isPhysicalEducationLike) || isPhysicalEducationLike(base);
        let displayClassroom = base.displayClassroom || base.classroom || "";
        if (venues.length > 1) {
          displayClassroom = MULTI_VENUE_TEXT;
        } else if (venues.length === 1) {
          displayClassroom = venues[0];
        } else {
          displayClassroom = isPe ? MULTI_VENUE_TEXT : "";
        }
        let displayTeacherName = base.displayTeacherName || base.teacherName || "";
        if (teachers.length > 1) {
          displayTeacherName = MULTI_TEACHER_TEXT;
        } else if (teachers.length === 1) {
          displayTeacherName = teachers[0];
        } else {
          displayTeacherName = NOTICE_TEACHER_TEXT;
        }
        const tag = venues.length > 1 || isPe ? "\u591A\u5730\u70B9" : "\u5DF2\u5408\u5E76";
        const merged = Object.assign({}, base, {
          id: key,
          courseName: canonicalCourseName,
          displayCourseName: canonicalCourseName,
          canonicalCourseName,
          classroom: displayClassroom,
          displayClassroom,
          canonicalClassroom: displayClassroom,
          teacherName: displayTeacherName,
          displayTeacherName,
          canonicalTeacherName: displayTeacherName,
          isMerged: true,
          mergedCount: group.length,
          mergedVenues: venues,
          mergedTeachers: teachers,
          mergedItems: group,
          tag,
          remark: isPe ? PE_NOTICE_TEXT : base.remark,
          isPhysicalEducationLike: isPe
        });
        displayCourses.push(merged);
        mergedGroups.push({
          key,
          courseName: canonicalCourseName,
          count: group.length,
          venues,
          teachers,
          isPhysicalEducationLike: isPe,
          items: group.map((item) => ({
            courseName: item.courseName,
            rawCourseName: item.rawCourseName || item.courseName,
            canonicalCourseName: item.canonicalCourseName,
            classroom: item.classroom,
            teacherName: item.teacherName,
            normalizationReason: item.normalizationReason
          }))
        });
      });
      return {
        courses: displayCourses,
        normalizedCourses,
        strictUniqueCourses,
        mergedGroups
      };
    }
    module2.exports = {
      MULTI_TEACHER_TEXT,
      MULTI_VENUE_TEXT,
      NOTICE_TEACHER_TEXT,
      PE_NOTICE_TEXT,
      buildTodayDisplayGroupKey,
      cleanDisplayText,
      isCourseLike,
      isPersonNameLike,
      isPhysicalEducationLike,
      isVenueLike,
      mergeCanonicalCoursesForDisplay,
      normalizeCourseIdentity,
      normalizeText,
      toRenderableCourse
    };
  }
});

// ../../server/src/utils/scheduleNormalizer.js
var require_scheduleNormalizer = __commonJS({
  "../../server/src/utils/scheduleNormalizer.js"(exports2, module2) {
    var { toRenderableCourse } = require_courseNormalizer();
    function toNumber(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    }
    function ensureWeeks(course) {
      if (Array.isArray(course.weeks) && course.weeks.length) {
        return course.weeks.map(Number).filter(Boolean);
      }
      const start = toNumber(course.startWeek, 1);
      const end = toNumber(course.endWeek, start);
      const weeks = [];
      for (let week = start; week <= end; week += 1) {
        weeks.push(week);
      }
      return weeks;
    }
    function compactText(value) {
      return String(value || "").trim().replace(/\s+/g, "").replace(/[【】\[\]（）()《》<>]/g, "");
    }
    var UNRELIABLE_CLASS_NAMES = /* @__PURE__ */ new Set([
      "\u672A\u547D\u540D",
      "\u672A\u547D\u540D\u73ED\u7EA7",
      "\u672A\u77E5",
      "\u672A\u77E5\u73ED\u7EA7",
      "\u6682\u65E0",
      "\u6682\u65E0\u73ED\u7EA7",
      "\u65E0\u73ED\u7EA7"
    ]);
    var COURSE_NAME_KEYWORDS = [
      "\u5927\u5B66\u4F53\u80B2",
      "\u5927\u5B66\u751F\u804C\u4E1A\u53D1\u5C55",
      "\u5F62\u52BF\u4E0E\u653F\u7B56",
      "\u804C\u4E1A\u53D1\u5C55",
      "\u5C31\u4E1A\u6307\u5BFC",
      "\u5B9E\u9A8C\u6280\u672F",
      "\u5927\u5B66\u82F1\u8BED",
      "\u82F1\u8BED",
      "\u6709\u673A\u5316\u5B66",
      "\u5206\u6790\u5316\u5B66",
      "\u52A8\u7269\u89E3\u5256\u5B66",
      "\u52A8\u7269\u751F\u7269\u5316\u5B66",
      "\u52A8\u7269\u673A\u80FD\u5B66",
      "\u52A8\u7269\u5B66",
      "\u519B\u4E8B\u7406\u8BBA",
      "\u521B\u65B0\u521B\u4E1A",
      "\u52B3\u52A8\u6559\u80B2",
      "\u5FC3\u7406\u5065\u5EB7",
      "\u601D\u60F3\u9053\u5FB7",
      "\u9A6C\u514B\u601D\u4E3B\u4E49",
      "\u8FD1\u73B0\u4EE3\u53F2",
      "\u6BDB\u6CFD\u4E1C\u601D\u60F3",
      "\u9AD8\u7B49\u6570\u5B66",
      "\u7EBF\u6027\u4EE3\u6570",
      "\u6982\u7387\u8BBA"
    ];
    function dedupeStrings(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = String(value || "").trim();
        if (!text || seen[text]) {
          return;
        }
        seen[text] = true;
        result.push(text);
      });
      return result;
    }
    function normalizeClassName(name) {
      const compact = compactText(name).replace(/^(班级|行政班级|行政班|上课班级|授课对象|教学班|上课对象)[:：]?/, "").replace(/专业课表$/, "").trim();
      if (/\d$/.test(compact)) {
        return `${compact}\u73ED`;
      }
      return compact;
    }
    function splitClassNameCandidates(value) {
      const raw2 = Array.isArray(value) ? value.join("\u3001") : String(value || "");
      const normalized = raw2.replace(/(?:上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]/g, " ").replace(/[；;,，、/／|]+/g, " ");
      const matches = [];
      const pattern = /(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g;
      let match2 = null;
      while ((match2 = pattern.exec(normalized)) !== null) {
        matches.push(normalizeClassName(match2[0]));
      }
      return dedupeStrings(matches);
    }
    function getMajorAliases(majorName) {
      const clean = compactText(majorName).replace(/[（(].*?[）)]/g, "").replace(/专业|方向|微/g, "");
      const aliases = [clean];
      if (clean.includes("\u52A8\u7269\u79D1\u5B66")) {
        aliases.push("\u52A8\u7269\u79D1\u5B66", "\u52A8\u79D1");
      }
      if (clean.includes("\u52A8\u7269\u533B\u5B66")) {
        aliases.push("\u52A8\u7269\u533B\u5B66", "\u52A8\u533B");
      }
      if (clean.includes("\u673A\u68B0\u8BBE\u8BA1\u5236\u9020\u53CA\u5176\u81EA\u52A8\u5316")) {
        aliases.push("\u673A\u68B0\u8BBE\u8BA1", "\u673A\u68B0");
      }
      if (clean.includes("\u6570\u5B66\u4E0E\u5E94\u7528\u6570\u5B66")) {
        aliases.push("\u6570\u5B66", "\u5E94\u7528\u6570\u5B66");
      }
      if (clean.length >= 2) {
        aliases.push(clean.slice(0, 2));
      }
      if (clean.length >= 4) {
        aliases.push(clean.slice(0, 4));
      }
      return dedupeStrings(aliases.filter((item) => item && item.length >= 2));
    }
    function hasClassNameShape(name, context = {}) {
      const compact = compactText(name);
      const hasGradeToken = /(?:^|[^\d])(?:20\d{2}|\d{2})级?/.test(compact) || /^(?:20\d{2}|\d{2})/.test(compact);
      const hasMajorText = /[\u4e00-\u9fa5A-Za-z]{2,}/.test(compact);
      const hasClassNo = /\d{1,2}班?$/.test(compact) || /[一二三四五六七八九十]{1,3}班$/.test(compact);
      const majorAliases = getMajorAliases(context.majorName);
      const hasMajorName = majorAliases.length ? majorAliases.some((alias) => compact.includes(alias)) : true;
      return hasGradeToken && hasMajorText && hasClassNo && hasMajorName;
    }
    function isLikelyClassName(name, context = {}) {
      const compact = compactText(normalizeClassName(name));
      if (!compact || UNRELIABLE_CLASS_NAMES.has(compact)) {
        return false;
      }
      if (/^(未命名|未知|暂无|无).*(班级|行政班|班)?$/.test(compact)) {
        return false;
      }
      const courseName = compactText(context.courseName);
      if (courseName && compact === courseName) {
        return false;
      }
      if (Array.isArray(context.courses)) {
        const cleanClassName = compact.replace(/^(20\d{2}|\d{2})级?/, "").replace(/\d+班$/, "").replace(/班$/, "");
        const isConfused = context.courses.some((course) => {
          if (!course || !course.courseName) return false;
          const cName = compactText(course.courseName);
          const cleanCName = cName.replace(/\d+$/, "");
          if (compact === cName) return true;
          if (cleanClassName && cleanCName) {
            if (cleanClassName === cleanCName) return true;
            if (cleanClassName.includes(cleanCName) || cleanCName.includes(cleanClassName)) {
              if (cleanClassName.length >= 2 && cleanCName.length >= 2) {
                return true;
              }
            }
          }
          return false;
        });
        if (isConfused) {
          return false;
        }
      }
      if (COURSE_NAME_KEYWORDS.some((keyword) => compact.includes(keyword))) {
        return false;
      }
      return hasClassNameShape(compact, context);
    }
    function isReliableClassName(name, options = {}) {
      return isLikelyClassName(name, options);
    }
    function getReliableClassNamesForCourse(course, context = {}) {
      const candidates = [];
      if (Array.isArray(course && course.classNames)) {
        candidates.push.apply(candidates, course.classNames);
      }
      [
        course && course.className,
        course && course.adminClass,
        course && course.teachingClass,
        course && course.audience,
        course && course.rawClassText
      ].forEach((value) => {
        candidates.push.apply(candidates, splitClassNameCandidates(value));
      });
      return dedupeStrings(candidates.map(normalizeClassName)).filter(
        (className) => isLikelyClassName(className, {
          courseName: course && course.courseName,
          courses: context.courses,
          majorName: context.majorName
        })
      );
    }
    function buildMajorScheduleName(context = {}) {
      const grade2 = context.grade || "";
      const majorName = context.majorName || "\u672A\u77E5\u4E13\u4E1A";
      return `${grade2}\u7EA7${majorName}\u4E13\u4E1A\u8BFE\u8868`;
    }
    function buildMajorSharedScheduleName(context = {}) {
      const grade2 = context.grade || "";
      const majorName = context.majorName || "\u672A\u77E5\u4E13\u4E1A";
      return `${grade2}\u7EA7${majorName}\u4E13\u4E1A\u5171\u4EAB\u8BFE\u7A0B`;
    }
    function withDisplayClassName(course, className, extra = {}) {
      return Object.assign({}, course, extra, {
        originalClassName: course && course.className ? course.className : "",
        className
      });
    }
    function buildClassScheduleEntries(courses, context = {}) {
      const classGroups = /* @__PURE__ */ new Map();
      const unresolvedCourses = [];
      const config = Object.assign({}, context, { courses });
      (courses || []).forEach((course) => {
        const reliableClassNames = getReliableClassNamesForCourse(course, config);
        if (reliableClassNames.length) {
          reliableClassNames.forEach((className) => {
            if (!classGroups.has(className)) {
              classGroups.set(className, []);
            }
            classGroups.get(className).push(withDisplayClassName(course, className));
          });
        } else {
          unresolvedCourses.push(course);
        }
      });
      if (classGroups.size === 0) {
        if (!courses || courses.length === 0) {
          return [];
        }
        const aggregateName = buildMajorScheduleName(context);
        return [{
          semester: context.semester,
          className: aggregateName,
          displayType: "major-schedule",
          isAggregated: true,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: courses.map((course) => withDisplayClassName(course, aggregateName, {
            sourceClassNameUnreliable: true
          }))
        }];
      }
      const classEntries = Array.from(classGroups.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true })).map(([className, groupedCourses]) => {
        const copiedUnresolved = unresolvedCourses.map((course) => withDisplayClassName(course, className, {
          sourceClassNameUnreliable: true,
          sharedByMajor: true
        }));
        return {
          semester: context.semester,
          className,
          displayType: "class-schedule",
          isAggregated: false,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: groupedCourses.concat(copiedUnresolved)
        };
      });
      if (unresolvedCourses.length) {
        const sharedName = buildMajorSharedScheduleName(context);
        classEntries.push({
          semester: context.semester,
          className: sharedName,
          displayType: "major-shared-schedule",
          isAggregated: true,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: unresolvedCourses.map((course) => withDisplayClassName(course, sharedName, {
            sourceClassNameUnreliable: true,
            sharedByMajor: true
          }))
        });
      }
      return classEntries;
    }
    function normalizeCourseItem(course, context) {
      const config = context || {};
      const normalized = Object.assign({}, course);
      normalized.id = normalized.id || `${normalized.sourceType || "course"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      normalized.semester = normalized.semester || config.semester || "2025-2026\u5B66\u5E74\u7B2C\u4E8C\u5B66\u671F";
      normalized.className = normalized.className || config.className || "";
      normalized.classNames = Array.isArray(normalized.classNames) ? normalized.classNames : splitClassNameCandidates(normalized.className);
      normalized.audience = normalized.audience || "";
      normalized.teachingClass = normalized.teachingClass || "";
      normalized.adminClass = normalized.adminClass || "";
      normalized.rawClassText = normalized.rawClassText || "";
      normalized.teacherName = normalized.teacherName || config.teacherName || "";
      normalized.classroom = normalized.classroom || config.classroom || "";
      normalized.courseName = normalized.courseName || "";
      normalized.weekday = toNumber(normalized.weekday, 1);
      const hasNoSections = normalized.startSection === void 0 && normalized.endSection === void 0 && !normalized.sections;
      normalized.startSection = toNumber(normalized.startSection, hasNoSections ? null : 1);
      normalized.endSection = toNumber(normalized.endSection, normalized.startSection);
      const hasNoWeeks = (!normalized.weeks || normalized.weeks.length === 0) && normalized.startWeek === void 0 && normalized.endWeek === void 0;
      normalized.startWeek = toNumber(normalized.startWeek, hasNoWeeks ? null : 1);
      normalized.endWeek = toNumber(normalized.endWeek, normalized.startWeek);
      if (hasNoWeeks) {
        normalized.weeks = [];
        normalized.weekText = "\u5F85\u786E\u8BA4\u5468\u6B21";
      } else {
        normalized.weeks = ensureWeeks(normalized);
        normalized.weekText = normalized.weekText || `${normalized.startWeek}-${normalized.endWeek}\u5468`;
      }
      normalized.weekType = normalized.weekType || "all";
      normalized.source = normalized.source || "school";
      normalized.sourceType = normalized.sourceType || config.sourceType || "class";
      normalized.audienceType = normalized.audienceType || config.audienceType || "student";
      normalized.rawText = normalized.rawText || "";
      normalized.rawHtml = normalized.rawHtml || "";
      return toRenderableCourse(normalized);
    }
    function normalizeCourseList(courses, context) {
      return (courses || []).map((course) => normalizeCourseItem(course, context)).filter((course) => {
        if (!course.courseName) return false;
        if (course.startSection === null || course.endSection === null) {
          console.warn(`\u26A0\uFE0F \u8FC7\u6EE4\u975E\u6CD5\u8BFE\u7A0B: \u8282\u6B21\u4E3A\u7A7A \u300A${course.courseName}\u300B`);
          return false;
        }
        return true;
      });
    }
    function groupCoursesBy(courses, key, fallbackName) {
      const groups = {};
      (courses || []).forEach((course) => {
        const groupName = course[key] || fallbackName || "\u672A\u547D\u540D";
        if (!groups[groupName]) {
          groups[groupName] = [];
        }
        groups[groupName].push(course);
      });
      return groups;
    }
    module2.exports = {
      buildClassScheduleEntries,
      buildMajorScheduleName,
      buildMajorSharedScheduleName,
      groupCoursesBy,
      isLikelyClassName,
      isReliableClassName,
      normalizeCourseItem,
      normalizeCourseList
    };
  }
});

// ../../server/src/utils/safeLogger.js
var require_safeLogger = __commonJS({
  "../../server/src/utils/safeLogger.js"(exports2, module2) {
    var SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization|ticket|execution|captcha)/i;
    function maskStudentId(studentId) {
      const value = String(studentId || "").trim();
      if (!value) {
        return "";
      }
      if (value.length <= 8) {
        if (value.length <= 4) {
          return "****";
        }
        return `${value.slice(0, 2)}****${value.slice(-2)}`;
      }
      return `${value.slice(0, 4)}****${value.slice(-4)}`;
    }
    function redactSecrets(value) {
      if (Array.isArray(value)) {
        return value.map(redactSecrets);
      }
      if (value && typeof value === "object") {
        const output = {};
        Object.keys(value).forEach((key) => {
          output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(value[key]);
        });
        return output;
      }
      if (typeof value === "string") {
        return value.replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]").replace(/(ticket=)[^&\s]+/gi, "$1[REDACTED]").replace(/(password|passwd|pwd|token|authorization|execution|captcha)=([^&\s]+)/gi, "$1=[REDACTED]");
      }
      return value;
    }
    function safeLog(label, payload) {
      console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] [${label}]`, JSON.stringify(redactSecrets(payload || {})));
    }
    module2.exports = {
      maskStudentId,
      redactSecrets,
      safeLog
    };
  }
});

// ../../server/src/services/releaseService.js
var require_releaseService = __commonJS({
  "../../server/src/services/releaseService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var zlib = require("zlib");
    var { safeLog } = require_safeLogger();
    var STORAGE_DIR = path2.join(__dirname, "../../storage");
    var RELEASES_DIR = path2.join(STORAGE_DIR, "releases");
    var ACTIVE_RELEASE_PATH = path2.join(RELEASES_DIR, "active.json");
    var SNAPSHOTS_DIR = path2.join(STORAGE_DIR, "snapshots");
    var CURRENT_SNAPSHOT_PATH = path2.join(SNAPSHOTS_DIR, "current.json");
    var CURRENT_SNAPSHOT_GZ_PATH = path2.join(SNAPSHOTS_DIR, "current.json.gz");
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function ensureStorageDirs() {
      ensureDir(STORAGE_DIR);
      ensureDir(RELEASES_DIR);
      ensureDir(SNAPSHOTS_DIR);
    }
    function readJsonFile(filePath) {
      try {
        if (!fs2.existsSync(filePath)) {
          return null;
        }
        return JSON.parse(fs2.readFileSync(filePath, "utf-8"));
      } catch (error) {
        safeLog("release-read-json-failed", { filePath, error: error.message });
        return null;
      }
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs2.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      try {
        if (fs2.existsSync(filePath) && process.platform === "win32") {
          try {
            fs2.unlinkSync(filePath);
          } catch (e2) {
          }
        }
        fs2.renameSync(tempPath, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        try {
          fs2.unlinkSync(tempPath);
        } catch (e2) {
        }
      }
    }
    function normalizeVersion(version) {
      return String(version || "").trim().replace(/[:/\\?%*|"<>]/g, "-").replace(/\s+/g, "-");
    }
    function generateReleaseVersion() {
      const now = /* @__PURE__ */ new Date();
      const pad = (value) => String(value).padStart(2, "0");
      return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
      ].join("-") + `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    }
    function getReleaseDir(version) {
      return path2.join(RELEASES_DIR, normalizeVersion(version));
    }
    function getReleaseFiles(version) {
      const releaseDir = getReleaseDir(version);
      return {
        releaseDir,
        bootstrapPath: path2.join(releaseDir, "bootstrap.json"),
        classSchedulesPath: path2.join(releaseDir, "class-schedules.json"),
        resourcesPath: path2.join(releaseDir, "resources.json"),
        snapshotPath: path2.join(releaseDir, "snapshot.json"),
        manifestPath: path2.join(releaseDir, "manifest.json"),
        classesIndexPath: path2.join(releaseDir, "classes-index.json"),
        teachersIndexPath: path2.join(releaseDir, "teachers-index.json"),
        classroomsIndexPath: path2.join(releaseDir, "classrooms-index.json"),
        coursesIndexPath: path2.join(releaseDir, "courses-index.json"),
        classScheduleDir: path2.join(releaseDir, "schedules", "class"),
        teacherScheduleDir: path2.join(releaseDir, "schedules", "teacher"),
        classroomScheduleDir: path2.join(releaseDir, "schedules", "classroom"),
        courseScheduleDir: path2.join(releaseDir, "schedules", "course")
      };
    }
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function getResources(snapshot) {
      const source = snapshot && snapshot.resources && typeof snapshot.resources === "object" ? snapshot.resources : {};
      const topLevel = snapshot && typeof snapshot === "object" ? snapshot : {};
      return {
        teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(topLevel.teachers),
        classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(topLevel.classrooms),
        courses: asArray(source.courses).length ? asArray(source.courses) : asArray(topLevel.courses),
        teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(topLevel.teacherSchedules),
        classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(topLevel.classroomSchedules),
        courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(topLevel.courseSchedules)
      };
    }
    function readLegacyResourceArray(fileName) {
      const value = readJsonFile(path2.join(STORAGE_DIR, fileName));
      return Array.isArray(value) ? value : [];
    }
    function hydrateLegacySnapshotResources(snapshot) {
      const resources = getResources(snapshot);
      if (resources.teacherSchedules.length || resources.classroomSchedules.length || resources.courseSchedules.length) {
        return Object.assign({}, snapshot, { resources });
      }
      return Object.assign({}, snapshot, {
        resources: Object.assign({}, resources, {
          teacherSchedules: readLegacyResourceArray("teacher-schedules.json"),
          classroomSchedules: readLegacyResourceArray("classroom-schedules.json"),
          courseSchedules: readLegacyResourceArray("course-schedules.json"),
          teachers: readLegacyResourceArray("teachers.json"),
          classrooms: readLegacyResourceArray("classrooms.json"),
          courses: readLegacyResourceArray("courses.json")
        })
      });
    }
    function countRelease(snapshot) {
      const catalog = snapshot.catalog || {};
      const resources = getResources(snapshot);
      const classSchedules = asArray(snapshot.classSchedules);
      const adminClassCount = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
      return {
        collegeCount: asArray(catalog.colleges).length,
        collegesCount: asArray(catalog.colleges).length,
        majorCount: asArray(snapshot.majors).length,
        majorsCount: asArray(snapshot.majors).length,
        classScheduleCount: classSchedules.length,
        adminClassCount,
        majorAggregateCount: classSchedules.length - adminClassCount,
        noScheduleMajorCount: snapshot.coverage?.noScheduleMajorCount || 0,
        teacherScheduleCount: resources.teacherSchedules.length,
        classroomScheduleCount: resources.classroomSchedules.length,
        courseScheduleCount: resources.courseSchedules.length
      };
    }
    function stableScheduleId(kind, value, index) {
      const key = `${kind}:${String(value || "")}:${index}`;
      return cryptoHash(key).slice(0, 16);
    }
    function cryptoHash(value) {
      return require("crypto").createHash("sha1").update(String(value || "")).digest("hex");
    }
    function safeScheduleId(kind, value, fallbackValue, index) {
      const raw2 = String(value || "").trim();
      const fallback = stableScheduleId(kind, fallbackValue || raw2, index);
      const safe = raw2.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!safe || safe.length > 80) {
        return fallback;
      }
      return safe;
    }
    function getFirstText(item, keys) {
      for (const key of keys) {
        if (item && item[key] !== void 0 && item[key] !== null && String(item[key]).trim()) {
          return String(item[key]).trim();
        }
      }
      return "";
    }
    function summarizeCourses(schedule) {
      const courses = Array.isArray(schedule?.courses) ? schedule.courses : [];
      return {
        courseCount: courses.length,
        firstCourseName: getFirstText(courses[0], ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"])
      };
    }
    function stripDebugCourseFields(course) {
      if (!course || typeof course !== "object") {
        return course;
      }
      const copy = Object.assign({}, course);
      delete copy.rawHtml;
      delete copy.rawCellHtml;
      delete copy.sourceHtml;
      delete copy.debugHtml;
      return copy;
    }
    function buildSchedulePayload(schedule, extra) {
      const payload = Object.assign({}, schedule || {}, extra || {});
      if (Array.isArray(payload.courses)) {
        payload.courses = payload.courses.map(stripDebugCourseFields);
      }
      return payload;
    }
    function buildClassDerivedFiles(snapshot, files) {
      ensureDir(files.classScheduleDir);
      const index = asArray(snapshot.classSchedules).map((item, position) => {
        const name = getFirstText(item, ["className", "title", "name"]) || `class-${position + 1}`;
        const id = safeScheduleId("class", item.classId || item.id, `${snapshot.semester}:${name}`, position);
        const summary = summarizeCourses(item);
        const payload = buildSchedulePayload(item, { id });
        writeJsonAtomic(path2.join(files.classScheduleDir, `${id}.json`), payload);
        return {
          id,
          name,
          className: name,
          semester: item.semester || snapshot.semester || "",
          collegeCode: item.collegeCode || "",
          collegeName: item.collegeName || "",
          grade: item.grade || "",
          majorCode: item.majorCode || "",
          majorName: item.majorName || "",
          displayType: item.displayType || "",
          isAggregated: !!item.isAggregated,
          courseCount: summary.courseCount,
          firstCourseName: summary.firstCourseName,
          updatedAt: item.updatedAt || snapshot.updatedAt || ""
        };
      });
      writeJsonAtomic(files.classesIndexPath, index);
      return index;
    }
    function buildNamedScheduleDerivedFiles(snapshot, files, kind, schedules, names, nameKeys, dirPath, indexPath) {
      ensureDir(dirPath);
      const scheduleByName = /* @__PURE__ */ new Map();
      asArray(schedules).forEach((schedule, index2) => {
        const name = getFirstText(schedule, nameKeys);
        if (!name) return;
        if (!scheduleByName.has(name)) {
          scheduleByName.set(name, { schedule, index: index2 });
        }
      });
      const seen = /* @__PURE__ */ new Set();
      const index = [];
      const addItem = (source, sourceIndex) => {
        const name = getFirstText(source, nameKeys);
        if (!name || seen.has(name)) return;
        seen.add(name);
        const matched = scheduleByName.get(name);
        const schedule = matched ? matched.schedule : Object.assign({}, source, { courses: [] });
        const id = safeScheduleId(kind, source.id || source[`${kind}Id`] || schedule.id, `${snapshot.semester}:${name}`, sourceIndex);
        const summary = summarizeCourses(schedule);
        writeJsonAtomic(path2.join(dirPath, `${id}.json`), buildSchedulePayload(schedule, { id }));
        index.push({
          id,
          name,
          [`${kind}Name`]: name,
          semester: schedule.semester || snapshot.semester || "",
          collegeCode: source.collegeCode || schedule.collegeCode || "",
          collegeName: source.collegeName || schedule.collegeName || "",
          campus: source.campus || schedule.campus || "",
          courseCount: summary.courseCount,
          firstCourseName: summary.firstCourseName,
          updatedAt: schedule.updatedAt || snapshot.updatedAt || ""
        });
      };
      asArray(names).forEach(addItem);
      asArray(schedules).forEach((schedule, indexNum) => addItem(schedule, indexNum));
      writeJsonAtomic(indexPath, index);
      return index;
    }
    function writeDerivedIndexes(snapshot, files) {
      const resources = getResources(snapshot);
      const classes = buildClassDerivedFiles(snapshot, files);
      const teachers = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "teacher",
        resources.teacherSchedules,
        resources.teachers,
        ["teacherName", "name", "title"],
        files.teacherScheduleDir,
        files.teachersIndexPath
      );
      const classrooms = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "classroom",
        resources.classroomSchedules,
        resources.classrooms,
        ["roomName", "classroomName", "classroom", "name"],
        files.classroomScheduleDir,
        files.classroomsIndexPath
      );
      const courses = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "course",
        resources.courseSchedules,
        resources.courses,
        ["courseName", "displayCourseName", "canonicalCourseName", "name", "title"],
        files.courseScheduleDir,
        files.coursesIndexPath
      );
      return { classes, teachers, classrooms, courses };
    }
    function hasCourseTiming(course) {
      return course.weekday !== void 0 || course.dayOfWeek !== void 0 || course.week !== void 0;
    }
    function hasCourseSections(course) {
      return course.startSection !== void 0 && course.endSection !== void 0;
    }
    function hasCourseName(course) {
      return Boolean(
        course.courseName || course.displayCourseName || course.canonicalCourseName || course.name || course.title
      );
    }
    function validateCourse(course, location) {
      if (!course || typeof course !== "object") {
        return `${location}: course must be an object`;
      }
      if (!hasCourseTiming(course)) {
        return `${location}: missing weekday/dayOfWeek`;
      }
      if (!hasCourseSections(course)) {
        return `${location}: missing startSection/endSection`;
      }
      if (!hasCourseName(course)) {
        return `${location}: missing courseName/displayCourseName`;
      }
      return "";
    }
    function validateScheduleList(list, label, requireClassName) {
      const errors = [];
      asArray(list).forEach((schedule, index) => {
        if (!schedule || typeof schedule !== "object") {
          errors.push(`${label}[${index}] must be an object`);
          return;
        }
        if (requireClassName && !(schedule.className || schedule.title || schedule.name)) {
          errors.push(`${label}[${index}] missing className/title`);
        }
        if (!Array.isArray(schedule.courses)) {
          errors.push(`${label}[${index}].courses must be an array`);
          return;
        }
        schedule.courses.forEach((course, courseIndex) => {
          const courseError = validateCourse(course, `${label}[${index}].courses[${courseIndex}]`);
          if (courseError) {
            errors.push(courseError);
          }
        });
      });
      return errors;
    }
    function validateReleaseSnapshot(snapshot) {
      const errors = [];
      if (!snapshot || typeof snapshot !== "object") {
        return {
          valid: false,
          errors: ["snapshot must be an object"],
          counts: {}
        };
      }
      if (!snapshot.catalog || !Array.isArray(snapshot.catalog.colleges) || snapshot.catalog.colleges.length <= 0) {
        errors.push("catalog.colleges.length must be greater than 0");
      }
      if (!Array.isArray(snapshot.majors) || snapshot.majors.length <= 0) {
        errors.push("majorsCount must be greater than 0");
      }
      if (!Array.isArray(snapshot.classSchedules) || snapshot.classSchedules.length <= 0) {
        errors.push("classScheduleCount must be greater than 0");
      }
      errors.push.apply(errors, validateScheduleList(snapshot.classSchedules, "classSchedules", true));
      const resources = getResources(snapshot);
      errors.push.apply(errors, validateScheduleList(resources.teacherSchedules, "resources.teacherSchedules", false));
      errors.push.apply(errors, validateScheduleList(resources.classroomSchedules, "resources.classroomSchedules", false));
      errors.push.apply(errors, validateScheduleList(resources.courseSchedules, "resources.courseSchedules", false));
      return {
        valid: errors.length === 0,
        errors,
        counts: countRelease(snapshot)
      };
    }
    function buildBootstrap(snapshot, version, counts) {
      const updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      return {
        success: true,
        dataSource: "snapshot",
        updatedAt,
        version,
        semester: snapshot.semester,
        catalog: snapshot.catalog || {},
        counts,
        versions: {
          snapshot: version,
          catalog: version,
          majors: version,
          classSchedules: version,
          resources: version
        },
        metaDetails: {
          source: snapshot.source || "local-sync-client",
          disclaimer: snapshot.disclaimer || "\u672C\u5DE5\u5177\u4E3A\u4E2A\u4EBA\u5F00\u53D1\uFF0C\u975E\u5B66\u6821\u5B98\u65B9\u670D\u52A1\u3002\u8BFE\u7A0B\u6570\u636E\u7531\u5F00\u53D1\u8005\u6574\u7406\u7EF4\u62A4\u53CA\u7528\u6237\u53CD\u9988\u4FEE\u6B63\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u5177\u4F53\u5B89\u6392\u8BF7\u4EE5\u4EFB\u8BFE\u6559\u5E08\u901A\u77E5\u53CA\u6B63\u5F0F\u901A\u77E5\u4E3A\u51C6\u3002",
          catalogUpdatedAt: updatedAt,
          majorsUpdatedAt: updatedAt,
          classSchedulesUpdatedAt: updatedAt,
          resourcesUpdatedAt: updatedAt
        }
      };
    }
    function buildManifest(snapshot, version, counts, validation) {
      const updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      return {
        version,
        semester: snapshot.semester,
        updatedAt,
        source: snapshot.source || "local-sync-client",
        counts,
        validation: {
          valid: validation.valid,
          errors: validation.errors,
          validatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      };
    }
    function coerceSnapshot(rawSnapshot) {
      const snapshot = Object.assign({}, rawSnapshot || {});
      snapshot.version = normalizeVersion(snapshot.version || generateReleaseVersion());
      snapshot.updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      snapshot.resources = getResources(snapshot);
      snapshot.coverage = Object.assign({}, snapshot.coverage || {}, countRelease(snapshot));
      return snapshot;
    }
    function writeReleaseSnapshot(rawSnapshot) {
      ensureStorageDirs();
      const snapshot = coerceSnapshot(rawSnapshot);
      const version = snapshot.version;
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const files = getReleaseFiles(version);
      const bootstrap = buildBootstrap(snapshot, version, validation.counts);
      const manifest = buildManifest(snapshot, version, validation.counts, validation);
      writeJsonAtomic(files.snapshotPath, snapshot);
      writeJsonAtomic(files.bootstrapPath, bootstrap);
      writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
      writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
      writeJsonAtomic(files.manifestPath, manifest);
      const derived = writeDerivedIndexes(snapshot, files);
      return {
        version,
        releaseDir: files.releaseDir,
        manifest,
        bootstrap,
        derived,
        snapshot
      };
    }
    function readReleaseSnapshot(version) {
      if (!version) {
        return null;
      }
      const files = getReleaseFiles(version);
      const snapshot = readJsonFile(files.snapshotPath);
      if (snapshot) {
        return snapshot;
      }
      const bootstrap = readJsonFile(files.bootstrapPath);
      const classSchedules = readJsonFile(files.classSchedulesPath);
      const resources = readJsonFile(files.resourcesPath);
      const manifest = readJsonFile(files.manifestPath);
      if (!bootstrap || !Array.isArray(classSchedules)) {
        return null;
      }
      return {
        version: normalizeVersion(version),
        semester: bootstrap.semester || manifest?.semester,
        updatedAt: bootstrap.updatedAt || manifest?.updatedAt,
        source: bootstrap.metaDetails?.source || manifest?.source || "local-sync-client",
        disclaimer: bootstrap.metaDetails?.disclaimer,
        catalog: bootstrap.catalog || {},
        majors: [],
        classSchedules,
        resources: getResources({ resources }),
        coverage: bootstrap.counts || manifest?.counts || {}
      };
    }
    function writeCurrentSnapshotCompat(snapshot) {
      ensureStorageDirs();
      writeJsonAtomic(CURRENT_SNAPSHOT_PATH, snapshot);
      fs2.writeFileSync(CURRENT_SNAPSHOT_GZ_PATH, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), "utf-8")));
    }
    function activateReleaseVersion(version) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const snapshot = readReleaseSnapshot(normalizedVersion);
      if (!snapshot) {
        const err = new Error(`Release ${normalizedVersion} not found`);
        err.statusCode = 404;
        throw err;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const active = {
        version: normalizedVersion,
        activatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        semester: snapshot.semester,
        counts: validation.counts
      };
      writeJsonAtomic(ACTIVE_RELEASE_PATH, active);
      writeCurrentSnapshotCompat(Object.assign({}, snapshot, {
        version: normalizedVersion,
        coverage: Object.assign({}, snapshot.coverage || {}, validation.counts)
      }));
      return {
        active,
        snapshot,
        validation
      };
    }
    function activateReleaseFromSnapshot(rawSnapshot) {
      const written = writeReleaseSnapshot(rawSnapshot);
      const activated = activateReleaseVersion(written.version);
      return Object.assign({}, written, activated);
    }
    function getActiveReleaseInfo() {
      ensureStorageDirs();
      return readJsonFile(ACTIVE_RELEASE_PATH);
    }
    function readActiveReleaseSnapshot() {
      const active = getActiveReleaseInfo();
      if (!active || !active.version) {
        return null;
      }
      const snapshot = readReleaseSnapshot(active.version);
      if (!snapshot) {
        return null;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        safeLog("active-release-invalid", { version: active.version, errors: validation.errors });
        return null;
      }
      return Object.assign({}, snapshot, {
        version: active.version,
        updatedAt: snapshot.updatedAt || active.updatedAt,
        coverage: Object.assign({}, snapshot.coverage || {}, active.counts || {})
      });
    }
    function readCurrentSnapshotCompat() {
      const current = readJsonFile(CURRENT_SNAPSHOT_PATH);
      if (current) {
        return current;
      }
      try {
        if (fs2.existsSync(CURRENT_SNAPSHOT_GZ_PATH)) {
          return JSON.parse(zlib.gunzipSync(fs2.readFileSync(CURRENT_SNAPSHOT_GZ_PATH)).toString("utf-8"));
        }
      } catch (error) {
        safeLog("release-read-current-gzip-failed", { error: error.message });
      }
      return null;
    }
    function getActiveSnapshotData() {
      const releaseSnapshot = readActiveReleaseSnapshot();
      if (releaseSnapshot) {
        return Object.assign({}, releaseSnapshot, {
          snapshotSource: "release"
        });
      }
      const currentSnapshot = readCurrentSnapshotCompat();
      if (currentSnapshot) {
        return Object.assign({}, currentSnapshot, {
          snapshotSource: "legacy-current"
        });
      }
      return null;
    }
    function getReleaseStatus() {
      const active = getActiveReleaseInfo();
      const snapshot = active ? readReleaseSnapshot(active.version) : null;
      const validation = snapshot ? validateReleaseSnapshot(snapshot) : null;
      return {
        activeReleaseVersion: active?.version || null,
        activeReleaseUpdatedAt: active?.updatedAt || null,
        activeReleaseActivatedAt: active?.activatedAt || null,
        semester: active?.semester || snapshot?.semester || null,
        counts: validation?.counts || active?.counts || {},
        valid: validation ? validation.valid : false,
        errors: validation ? validation.errors : [],
        storagePath: RELEASES_DIR
      };
    }
    function listReleases(limit = 20) {
      ensureStorageDirs();
      const entries = fs2.readdirSync(RELEASES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
        const version = entry.name;
        const files = getReleaseFiles(version);
        const manifest = readJsonFile(files.manifestPath);
        const stat = fs2.statSync(files.releaseDir);
        return {
          version,
          updatedAt: manifest?.updatedAt || stat.mtime.toISOString(),
          semester: manifest?.semester || "",
          counts: manifest?.counts || {},
          valid: manifest?.validation?.valid !== false
        };
      }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      return entries.slice(0, limit);
    }
    function deleteReleaseVersion(version) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const active = getActiveReleaseInfo();
      if (active && active.version === normalizedVersion) {
        const err = new Error("\u4E0D\u80FD\u5220\u9664\u5F53\u524D active release\uFF0C\u8BF7\u5148\u56DE\u6EDA\u6216\u6FC0\u6D3B\u5176\u4ED6\u7248\u672C");
        err.statusCode = 400;
        throw err;
      }
      const files = getReleaseFiles(normalizedVersion);
      const relative = path2.relative(RELEASES_DIR, files.releaseDir);
      if (!relative || relative.startsWith("..") || path2.isAbsolute(relative)) {
        const err = new Error("Invalid release path");
        err.statusCode = 400;
        throw err;
      }
      if (!fs2.existsSync(files.releaseDir)) {
        const err = new Error(`Release ${normalizedVersion} not found`);
        err.statusCode = 404;
        throw err;
      }
      fs2.rmSync(files.releaseDir, { recursive: true, force: true });
      return { version: normalizedVersion, deleted: true };
    }
    var derivedCache = /* @__PURE__ */ new Map();
    function getDerivedFileInfo(kind, files) {
      const map = {
        class: { indexPath: files.classesIndexPath, scheduleDir: files.classScheduleDir },
        teacher: { indexPath: files.teachersIndexPath, scheduleDir: files.teacherScheduleDir },
        classroom: { indexPath: files.classroomsIndexPath, scheduleDir: files.classroomScheduleDir },
        course: { indexPath: files.coursesIndexPath, scheduleDir: files.courseScheduleDir }
      };
      return map[kind] || null;
    }
    function getReadableReleaseInfo() {
      const active = getActiveReleaseInfo();
      if (active && active.version) {
        return {
          source: "active-release",
          version: active.version,
          semester: active.semester,
          updatedAt: active.updatedAt,
          snapshot: null
        };
      }
      const snapshot = readCurrentSnapshotCompat();
      if (!snapshot) {
        return null;
      }
      const updatedAt = snapshot.updatedAt || snapshot.generatedAt || "";
      const version = normalizeVersion(
        snapshot.version || snapshot.releaseVersion || `legacy-current-${cryptoHash(`${snapshot.semester || ""}:${updatedAt}`).slice(0, 12)}`
      );
      return {
        source: "legacy-current",
        version,
        semester: snapshot.semester || snapshot.term || "",
        updatedAt,
        snapshot: hydrateLegacySnapshotResources(Object.assign({}, snapshot, { version }))
      };
    }
    function ensureDerivedIndexes(version, fallbackSnapshot) {
      const files = getReleaseFiles(version);
      const allExist = fs2.existsSync(files.classesIndexPath) && fs2.existsSync(files.teachersIndexPath) && fs2.existsSync(files.classroomsIndexPath) && fs2.existsSync(files.coursesIndexPath);
      if (allExist) {
        if (fallbackSnapshot) {
          const resources = getResources(fallbackSnapshot);
          const classIndex = readJsonFile(files.classesIndexPath, []);
          const teacherIndex = readJsonFile(files.teachersIndexPath, []);
          const classroomIndex = readJsonFile(files.classroomsIndexPath, []);
          const courseIndex = readJsonFile(files.coursesIndexPath, []);
          const shouldRefresh = asArray(fallbackSnapshot.classSchedules).length > 0 && asArray(classIndex).length === 0 || resources.teacherSchedules.length > 0 && asArray(teacherIndex).length === 0 || resources.classroomSchedules.length > 0 && asArray(classroomIndex).length === 0 || resources.courseSchedules.length > 0 && asArray(courseIndex).length === 0;
          if (!shouldRefresh) {
            return files;
          }
        } else {
          return files;
        }
      }
      const snapshot = fallbackSnapshot ? coerceSnapshot(Object.assign({}, fallbackSnapshot, { version })) : readReleaseSnapshot(version);
      if (snapshot) {
        writeDerivedIndexes(snapshot, files);
      }
      return files;
    }
    function readActiveIndex(kind) {
      const active = getReadableReleaseInfo();
      if (!active || !active.version) {
        return { success: false, reasonCode: "NO_RELEASE_DATA", items: [] };
      }
      const files = ensureDerivedIndexes(active.version, active.snapshot);
      const info = getDerivedFileInfo(kind, files);
      if (!info || !fs2.existsSync(info.indexPath)) {
        return { success: false, reasonCode: "NO_INDEX", items: [] };
      }
      const stat = fs2.statSync(info.indexPath);
      const cacheKey = `${active.version}:${kind}:index`;
      const cached = derivedCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.value;
      }
      const items2 = readJsonFile(info.indexPath) || [];
      const value = {
        success: true,
        dataSource: active.source === "legacy-current" ? "legacy-current-index" : "release-index",
        version: active.version,
        semester: active.semester,
        updatedAt: active.updatedAt,
        etag: `"${active.version}-${kind}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        items: Array.isArray(items2) ? items2 : []
      };
      derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
      return value;
    }
    function searchActiveIndex(kind, query, options = {}) {
      const index = readActiveIndex(kind);
      if (!index.success) {
        return index;
      }
      const q = String(query || "").trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(options.limit || "30", 10) || 30, 1), 100);
      const offset = Math.max(parseInt(options.offset || "0", 10) || 0, 0);
      const source = index.items || [];
      const matchesField = (item, optionValue, keys) => {
        const expected = String(optionValue || "").trim();
        if (!expected) return true;
        return keys.some((key) => String(item[key] || "").trim() === expected);
      };
      const scoped = source.filter((item) => {
        if (!matchesField(item, options.semester, ["semester"])) return false;
        if (!matchesField(item, options.collegeCode, ["collegeCode"])) return false;
        if (!matchesField(item, options.collegeName, ["collegeName", "college"])) return false;
        if (!matchesField(item, options.grade, ["grade"])) return false;
        if (!matchesField(item, options.majorCode, ["majorCode"])) return false;
        if (!matchesField(item, options.majorName, ["majorName"])) return false;
        if (!matchesField(item, options.campus, ["campus", "campusName"])) return false;
        return true;
      });
      const filtered = q ? scoped.filter((item) => {
        const haystack = [
          item.id,
          item.name,
          item.className,
          item.teacherName,
          item.roomName,
          item.classroomName,
          item.courseName,
          item.collegeName,
          item.majorName,
          item.grade,
          item.firstCourseName
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      }) : scoped;
      return Object.assign({}, index, {
        query: q,
        total: filtered.length,
        limit,
        offset,
        items: filtered.slice(offset, offset + limit)
      });
    }
    function readActiveSchedule(kind, id) {
      const active = getReadableReleaseInfo();
      if (!active || !active.version) {
        return { success: false, reasonCode: "NO_RELEASE_DATA" };
      }
      const files = ensureDerivedIndexes(active.version, active.snapshot);
      const info = getDerivedFileInfo(kind, files);
      if (!info) {
        return { success: false, reasonCode: "INVALID_KIND" };
      }
      const safeId = safeScheduleId(kind, id, id, 0);
      const filePath = path2.join(info.scheduleDir, `${safeId}.json`);
      const relative = path2.relative(info.scheduleDir, filePath);
      if (relative.startsWith("..") || path2.isAbsolute(relative)) {
        return { success: false, reasonCode: "INVALID_ID" };
      }
      const stat = fs2.existsSync(filePath) ? fs2.statSync(filePath) : null;
      if (!stat) {
        return { success: false, reasonCode: "NOT_FOUND" };
      }
      const cacheKey = `${active.version}:${kind}:schedule:${safeId}`;
      const cached = derivedCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.value;
      }
      const schedule = readJsonFile(filePath);
      const value = {
        success: true,
        dataSource: active.source === "legacy-current" ? "legacy-current-index" : "release-index",
        version: active.version,
        semester: schedule?.semester || active.semester,
        updatedAt: schedule?.updatedAt || active.updatedAt,
        etag: `"${active.version}-${kind}-${safeId}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        schedule
      };
      derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
      return value;
    }
    function parseSnapshotBuffer(buffer) {
      const isGzip = buffer.length >= 2 && buffer[0] === 31 && buffer[1] === 139;
      const jsonText = isGzip ? zlib.gunzipSync(buffer).toString("utf-8") : buffer.toString("utf-8");
      return {
        isGzip,
        snapshot: JSON.parse(jsonText),
        size: buffer.length
      };
    }
    module2.exports = {
      ACTIVE_RELEASE_PATH,
      RELEASES_DIR,
      activateReleaseFromSnapshot,
      activateReleaseVersion,
      countRelease,
      getActiveSnapshotData,
      getReleaseStatus,
      deleteReleaseVersion,
      readActiveIndex,
      readActiveSchedule,
      listReleases,
      normalizeVersion,
      parseSnapshotBuffer,
      readActiveReleaseSnapshot,
      searchActiveIndex,
      validateReleaseSnapshot,
      writeDerivedIndexes,
      writeReleaseSnapshot
    };
  }
});

// ../fosu-sync-client/upload.js
var require_upload = __commonJS({
  "../fosu-sync-client/upload.js"(exports2, module2) {
    var axios2 = require("axios");
    var crypto2 = require("crypto");
    var fs2 = require("fs");
    var os = require("os");
    var path2 = require("path");
    var { pipeline } = require("stream/promises");
    var zlib = require("zlib");
    function parseArgs(argv) {
      const args = {};
      for (const arg of argv) {
        if (!arg.startsWith("--")) continue;
        const match2 = arg.match(/^--([^=]+)=(.*)$/);
        if (match2) {
          args[match2[1]] = match2[2];
        } else {
          args[arg.slice(2)] = true;
        }
      }
      return args;
    }
    function resolveProjectRoot(startDir) {
      let current = path2.resolve(startDir || process.cwd());
      while (true) {
        const hasServer = fs2.existsSync(path2.join(current, "server"));
        const hasMiniprogram = fs2.existsSync(path2.join(current, "miniprogram"));
        const hasPackage = fs2.existsSync(path2.join(current, "package.json"));
        const hasGit = fs2.existsSync(path2.join(current, ".git"));
        if (hasServer && hasMiniprogram || hasPackage && hasGit) {
          return current;
        }
        const parent = path2.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return path2.resolve(__dirname, "../..");
    }
    function resolveInputFilePath2(fileArg, options = {}) {
      if (!fileArg) {
        return { resolved: null, tried: [] };
      }
      if (path2.isAbsolute(fileArg)) {
        return { resolved: fileArg, tried: [fileArg] };
      }
      const cwd = path2.resolve(options.cwd || process.cwd());
      const projectRoot = options.projectRoot || resolveProjectRoot(cwd);
      const normalized = path2.normalize(fileArg).replace(/\\/g, "/");
      const candidates = [];
      if (normalized.startsWith("tools/fosu-sync-client/")) {
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(cwd, normalized.slice("tools/fosu-sync-client/".length)));
      } else {
        candidates.push(path2.resolve(cwd, fileArg));
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(projectRoot, "tools/fosu-sync-client", fileArg));
      }
      const tried = [];
      for (const candidate of candidates) {
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        if (fs2.existsSync(candidate)) {
          return { resolved: candidate, tried };
        }
      }
      return { resolved: null, tried };
    }
    function toBytesMb(value, fallbackMb) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return fallbackMb * 1024 * 1024;
      }
      return Math.floor(num * 1024 * 1024);
    }
    function hashFile(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto2.createHash("sha256");
        const stream = fs2.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
      });
    }
    async function gzipFile(inputPath, outputPath) {
      await pipeline(
        fs2.createReadStream(inputPath),
        zlib.createGzip({ level: 9 }),
        fs2.createWriteStream(outputPath)
      );
      return outputPath;
    }
    function readLeadingText(filePath, maxBytes = 4 * 1024 * 1024) {
      const stat = fs2.statSync(filePath);
      const length = Math.min(stat.size, maxBytes);
      const fd = fs2.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(length);
        fs2.readSync(fd, buffer, 0, length, 0);
        return buffer.toString("utf-8");
      } finally {
        fs2.closeSync(fd);
      }
    }
    function extractJsonMetadata(filePath) {
      const head = readLeadingText(filePath);
      const pick = (key) => {
        const match2 = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        return match2 ? match2[1] : "";
      };
      return {
        term: pick("term") || pick("semester"),
        releaseVersion: pick("releaseVersion") || pick("version"),
        generatedAt: pick("generatedAt") || pick("updatedAt")
      };
    }
    function formatMb(bytes) {
      return (Number(bytes || 0) / 1024 / 1024).toFixed(2);
    }
    function getAuthHeaders(mode, token) {
      if (mode === "relay") {
        return {
          "x-relay-token": token,
          Authorization: `Bearer ${token}`
        };
      }
      return {
        "x-admin-token": token,
        Authorization: `Bearer ${token}`
      };
    }
    function shouldRetry(error) {
      if (!error) return false;
      if (!error.response) return true;
      const status = error.response.status;
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }
    function retryDelayMs(attempt) {
      return Math.min(15e3, 700 * Math.pow(2, attempt - 1));
    }
    async function postJson(url, body, headers, timeoutMs) {
      const response = await axios2.post(url, body, {
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return response.data;
    }
    async function uploadChunkWithRetry(url, buffer, headers, timeoutMs, attemptCount) {
      let lastError;
      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        try {
          const response = await axios2.post(url, buffer, {
            headers: Object.assign({
              "Content-Type": "application/octet-stream",
              "Content-Length": buffer.length,
              "x-chunk-sha256": crypto2.createHash("sha256").update(buffer).digest("hex")
            }, headers),
            timeout: timeoutMs,
            proxy: false,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });
          return response.data;
        } catch (error) {
          lastError = error;
          const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
          console.warn(`chunk upload failed (${attempt}/${attemptCount}): ${detail}`);
          if (!shouldRetry(error) || attempt >= attemptCount) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        }
      }
      throw lastError;
    }
    function readChunk(filePath, start, endInclusive) {
      const length = endInclusive - start + 1;
      const buffer = Buffer.allocUnsafe(length);
      const fd = fs2.openSync(filePath, "r");
      try {
        fs2.readSync(fd, buffer, 0, length, start);
        return buffer;
      } finally {
        fs2.closeSync(fd);
      }
    }
    function normalizeServer(value) {
      return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
    }
    async function prepareUploadFile(filePath, params) {
      const stat = fs2.statSync(filePath);
      const originalSize = stat.size;
      const originalSha256 = await hashFile(filePath);
      const shouldGzip = params.gzip === true || params.gzip === "true" || params["no-gzip"] !== true;
      if (!shouldGzip) {
        return {
          uploadPath: filePath,
          contentEncoding: "identity",
          originalSize,
          originalSha256
        };
      }
      const gzipPath = path2.resolve(
        params["gzip-output"] || params.gzipOutput || `${filePath}.gz`
      );
      console.log(`gzip: ${filePath}`);
      console.log(`gzip output: ${gzipPath}`);
      await gzipFile(filePath, gzipPath);
      return {
        uploadPath: gzipPath,
        contentEncoding: "gzip",
        originalSize,
        originalSha256
      };
    }
    async function uploadStagingFile(options) {
      const params = options.params || {};
      const filePath = path2.resolve(options.filePath);
      if (!fs2.existsSync(filePath)) {
        throw new Error(`file not found: ${filePath}`);
      }
      const mode = options.authMode || "admin";
      const token = options.token || "";
      if (!token) {
        throw new Error(mode === "relay" ? "missing relay token" : "missing ADMIN_API_TOKEN");
      }
      const server = normalizeServer(options.server);
      const endpointBase = mode === "relay" ? `${server}/api/relay/staging/upload` : `${server}/api/admin/staging/upload`;
      const timeoutMs = Number(params.timeout || params.timeoutMs || process.env.SYNC_UPLOAD_TIMEOUT_MS || 18e4);
      const retryCount = Number(params.retries || process.env.SYNC_UPLOAD_RETRIES || 3);
      const chunkSize = toBytesMb(params["chunk-mb"] || params.chunkMb || process.env.SYNC_LOCAL_UPLOAD_CHUNK_MB, 8);
      const metadata = Object.assign({}, extractJsonMetadata(filePath), options.metadata || {});
      const prepared = await prepareUploadFile(filePath, params);
      const uploadStat = fs2.statSync(prepared.uploadPath);
      const uploadSha256 = await hashFile(prepared.uploadPath);
      const totalChunks = Math.ceil(uploadStat.size / chunkSize);
      const headers = getAuthHeaders(mode, token);
      console.log(`source file: ${filePath}`);
      console.log(`source size: ${formatMb(prepared.originalSize)} MB`);
      console.log(`upload file: ${prepared.uploadPath}`);
      console.log(`upload size: ${formatMb(uploadStat.size)} MB`);
      console.log(`chunk size: ${formatMb(chunkSize)} MB, chunks: ${totalChunks}`);
      console.log(`server: ${server}`);
      const initBody = {
        fileName: path2.basename(filePath),
        term: metadata.term || options.term || "",
        releaseVersion: metadata.releaseVersion || "",
        note: options.note || params.note || "",
        source: options.source || (mode === "relay" ? "relay-agent" : "local-upload-cli"),
        contentEncoding: prepared.contentEncoding,
        contentType: "application/json",
        chunkSize,
        totalChunks,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256
      };
      const init = await postJson(`${endpointBase}/init`, initBody, headers, timeoutMs);
      const uploadId = init.uploadId || init.upload?.uploadId;
      if (!uploadId) {
        throw new Error(`init response missing uploadId: ${JSON.stringify(init)}`);
      }
      const startedAt = Date.now();
      let uploaded = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(uploadStat.size - 1, start + chunkSize - 1);
        const buffer = readChunk(prepared.uploadPath, start, end);
        const chunkUrl = `${endpointBase}/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`;
        await uploadChunkWithRetry(chunkUrl, buffer, headers, timeoutMs, retryCount);
        uploaded += buffer.length;
        const elapsed = Math.max(1, (Date.now() - startedAt) / 1e3);
        const percent = (uploaded / uploadStat.size * 100).toFixed(2);
        const speed = formatMb(uploaded / elapsed);
        console.log(`[${chunkIndex + 1}/${totalChunks}] ${percent}% ${formatMb(uploaded)}/${formatMb(uploadStat.size)} MB, ${speed} MB/s`);
      }
      const finalize = await postJson(`${endpointBase}/finalize`, {
        uploadId,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256,
        totalChunks,
        note: options.note || params.note || "",
        uploaderNote: options.note || params.note || "",
        environment: options.environment || metadata.environment || ""
      }, headers, timeoutMs);
      const payload = finalize.data || finalize.upload || finalize;
      console.log("upload finalized:");
      console.log(JSON.stringify({
        uploadId,
        stagingId: finalize.stagingId || uploadId,
        relayUploadId: payload.relayUploadId || finalize.relayUploadId,
        term: payload.term || finalize.term || metadata.term || "",
        releaseVersion: payload.releaseVersion || finalize.releaseVersion || metadata.releaseVersion || "",
        counts: payload.counts || payload.summary || finalize.counts || {},
        status: payload.status || finalize.status || "pending-review"
      }, null, 2));
      return finalize;
    }
    async function runFromCli(argv = process.argv.slice(2)) {
      const params = parseArgs(argv);
      const fileArg = params.file || params.input;
      const resolved = resolveInputFilePath2(fileArg || "");
      if (!resolved.resolved) {
        throw new Error([
          "Staging JSON file not found.",
          `received: ${fileArg || ""}`,
          `cwd: ${process.cwd()}`,
          `projectRoot: ${resolveProjectRoot(process.cwd())}`,
          "tried:",
          ...resolved.tried.map((item) => `  - ${item}`)
        ].join(os.EOL));
      }
      const mode = params.relay ? "relay" : "admin";
      const token = params.token || (mode === "relay" ? process.env.RELAY_TOKEN : process.env.ADMIN_API_TOKEN);
      return uploadStagingFile({
        filePath: resolved.resolved,
        server: params.server || process.env.FOSU_API_BASE || "https://class.katelya.eu.org",
        token,
        authMode: mode,
        params,
        term: params.term,
        note: params.note
      });
    }
    if (require.main === module2) {
      runFromCli().catch((error) => {
        const response = error.response;
        if (response) {
          console.error(`upload failed: HTTP ${response.status}`);
          console.error(JSON.stringify(response.data || {}, null, 2));
        } else {
          console.error(`upload failed: ${error.stack || error.message}`);
        }
        process.exit(1);
      });
    }
    module2.exports = {
      parseArgs,
      resolveInputFilePath: resolveInputFilePath2,
      resolveProjectRoot,
      runFromCli,
      uploadStagingFile
    };
  }
});

// ../fosu-sync-client/sync.js
var { chromium } = require("playwright");
var fs = require("fs");
var path = require("path");
var axios = require("axios");
var cheerio = require("cheerio");
var crypto = require("crypto");
var diagnose = require_diagnose();
var envPath = path.resolve(__dirname, ".env");
require("dotenv").config({ path: envPath });
var ALL_SCOPES = ["classSchedules", "teacherSchedules", "classroomSchedules", "courseSchedules", "classrooms", "teachers", "courses"];
console.log(`[env] .env path: ${envPath}`);
console.log(`[env] FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
console.log(`[env] PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_GRADE_RANGE: ${process.env.SYNC_GRADE_RANGE || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_GRADES (\u4E13\u4E1A\u540C\u6B65\u4F7F\u7528): ${process.env.SYNC_GRADES || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_CLASS_GRADES (\u73ED\u7EA7\u8BFE\u8868\u540C\u6B65\u4F7F\u7528): ${process.env.SYNC_CLASS_GRADES || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_UPLOAD_CHUNK_SIZE: ${process.env.SYNC_UPLOAD_CHUNK_SIZE || "10"}`);
console.log(`[env] SYNC_SKIP_NO_SCHEDULE_CACHE: ${process.env.SYNC_SKIP_NO_SCHEDULE_CACHE || "true"}`);
console.log(`[env] SYNC_RECHECK_NO_SCHEDULE: ${process.env.SYNC_RECHECK_NO_SCHEDULE || "false"}`);
console.log(`[env] ADMIN_API_TOKEN: ${process.env.ADMIN_API_TOKEN ? "present" : "missing"}`);
var parser = require_parser();
var normalizer = require_scheduleNormalizer();
var courseIdentity = require_courseNormalizer();
var releaseService = require_releaseService();
var stagingUploader = require_upload();
var proxyEnvNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
var detectedProxyEnv = proxyEnvNames.map((name) => [name, process.env[name]]).filter(([, value]) => Boolean(value));
var INITIAL_DETECTED_PROXIES = [...detectedProxyEnv];
var disableProxy = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
if (detectedProxyEnv.length > 0) {
  console.warn(`\u26A0\uFE0F \u68C0\u6D4B\u5230\u4EE3\u7406\u73AF\u5883\u53D8\u91CF: ${detectedProxyEnv.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  if (disableProxy) {
    console.warn("\u26A0\uFE0F \u540C\u6B65\u4E0A\u4F20\u9ED8\u8BA4\u7981\u7528\u73AF\u5883\u4EE3\u7406\uFF0C\u907F\u514D 127.0.0.1:10808 \u7B49\u672C\u5730\u4EE3\u7406\u6C61\u67D3 VPS \u4E0A\u4F20\u3002");
  }
}
if (disableProxy) {
  proxyEnvNames.forEach((name) => {
    delete process.env[name];
  });
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
  axios.defaults.proxy = false;
}
var FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
var FOSU_API_BASE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";
var cachedProjectRoot = null;
function resolveProjectPath() {
  if (cachedProjectRoot) return cachedProjectRoot;
  const startDir = process.cwd();
  let currentDir = startDir;
  while (true) {
    const serverPath = path.join(currentDir, "server");
    const miniprogramPath = path.join(currentDir, "miniprogram");
    if (fs.existsSync(serverPath) && fs.statSync(serverPath).isDirectory() && fs.existsSync(miniprogramPath) && fs.statSync(miniprogramPath).isDirectory()) {
      cachedProjectRoot = currentDir;
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  const fallbackPath = path.resolve(__dirname, "../..");
  cachedProjectRoot = fallbackPath;
  return fallbackPath;
}
var PROJECT_ROOT = resolveProjectPath();
function resolveInputFilePath(fileArg) {
  if (!fileArg) {
    return {
      resolved: null,
      tried: []
    };
  }
  if (path.isAbsolute(fileArg)) {
    return {
      resolved: fileArg,
      tried: [fileArg]
    };
  }
  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const tried = [];
  const normalizedFile = path.normalize(fileArg).replace(/\\/g, "/");
  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    const pRootJoined = path.resolve(projectRoot, fileArg);
    tried.push(pRootJoined);
    if (fs.existsSync(pRootJoined)) {
      return { resolved: pRootJoined, tried };
    }
    const relativePart = normalizedFile.substring("tools/fosu-sync-client/".length);
    const pCwdStripped = path.resolve(cwd, relativePart);
    tried.push(pCwdStripped);
    if (fs.existsSync(pCwdStripped)) {
      return { resolved: pCwdStripped, tried };
    }
  } else {
    const pCwd = path.resolve(cwd, fileArg);
    tried.push(pCwd);
    if (fs.existsSync(pCwd)) {
      return { resolved: pCwd, tried };
    }
    if (projectRoot) {
      const pRoot = path.resolve(projectRoot, fileArg);
      tried.push(pRoot);
      if (fs.existsSync(pRoot)) {
        return { resolved: pRoot, tried };
      }
      const pClient = path.resolve(projectRoot, "tools/fosu-sync-client", fileArg);
      tried.push(pClient);
      if (fs.existsSync(pClient)) {
        return { resolved: pClient, tried };
      }
    }
  }
  return {
    resolved: null,
    tried
  };
}
function resolveOutputFilePath(outputArg) {
  if (!outputArg) return null;
  if (path.isAbsolute(outputArg)) return outputArg;
  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const normalizedFile = path.normalize(outputArg).replace(/\\/g, "/");
  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    return path.resolve(projectRoot, outputArg);
  }
  if (projectRoot) {
    return path.resolve(projectRoot, outputArg);
  }
  return path.resolve(cwd, outputArg);
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
var FOSU_SYNC_AUTH_MODE = process.env.FOSU_SYNC_AUTH_MODE || "playwright-manual";
var SESSION_PATH = path.join(__dirname, ".session", "session.json");
function getEnvFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === void 0 || value === "") {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}
function getTermStartDate(term) {
  const map = {
    "2025-2026-1": "2025-09-01",
    "2025-2026-2": "2026-03-09",
    "2026-2027-1": "2026-09-01",
    "2026-2027-2": "2027-03-01",
    "2027-2028-1": "2027-09-01",
    "2027-2028-2": "2028-03-01"
  };
  return map[term] || "";
}
function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`\u26A0\uFE0F \u8BFB\u53D6 JSON \u6587\u4EF6\u5931\u8D25\uFF0C\u5C06\u6309\u7A7A\u6570\u7EC4\u5904\u7406: ${filePath} (${error.message})`);
    return [];
  }
}
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function getMajorIdentityKey(major, semester2) {
  return [
    semester2,
    major.collegeCode || "",
    major.grade || "",
    major.code || major.majorCode || ""
  ].join("::");
}
function getLegacyMajorProgressKey(major) {
  return `${major.grade}_${major.code || major.majorCode || ""}`;
}
function hasCompletedMajor(progress, major, semester2) {
  const completed = progress && Array.isArray(progress.completed) ? progress.completed : [];
  return completed.includes(getMajorIdentityKey(major, semester2)) || completed.includes(getLegacyMajorProgressKey(major));
}
function markCompletedMajor(progress, major, semester2) {
  const key = getMajorIdentityKey(major, semester2);
  if (!Array.isArray(progress.completed)) {
    progress.completed = [];
  }
  if (!progress.completed.includes(key)) {
    progress.completed.push(key);
  }
}
function upsertNoScheduleMajor(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}
function removeNoScheduleMajor(records, major, semester2) {
  const key = getMajorIdentityKey(major, semester2);
  return records.filter((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) !== key);
}
function upsertClassNameCandidateRecord(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}
async function waitBetweenClassSyncRequests(isFiltered) {
  const configuredDelay = Number(process.env.SYNC_CLASS_REQUEST_DELAY_MS || 0);
  if (Number.isFinite(configuredDelay) && configuredDelay >= 0 && process.env.SYNC_CLASS_REQUEST_DELAY_MS !== void 0) {
    console.log(`      \u23F3 \u6309 CLI/env \u914D\u7F6E\u7B49\u5F85 ${configuredDelay}ms...`);
    await sleep(configuredDelay);
    return;
  }
  const delayMin = isFiltered ? 800 : 1500;
  const delayMax = isFiltered ? 1500 : 3e3;
  const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
  console.log(`      \u23F3 \u968F\u673A\u7B49\u5F85 ${delay}ms...`);
  await sleep(delay);
}
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const httpUrl = `${FOSU_BASE_URL.replace(/^https:/i, "http:")}${cleanPath}`;
  const httpsUrl = `${FOSU_BASE_URL}${cleanPath}`;
  try {
    await page.goto(httpUrl, options);
  } catch (err) {
    try {
      await page.goto(httpsUrl, options);
    } catch (httpsErr) {
      throw new Error(`\u5BFC\u822A\u5230 ${cleanPath} \u5F7B\u5E95\u5931\u8D25 (HTTP: ${err.message}, HTTPS: ${httpsErr.message})`);
    }
  }
}
function parseCookieString(cookieStr, domain) {
  if (!cookieStr) return [];
  const domainHost = new URL(domain).hostname;
  return cookieStr.split(";").map((pair) => {
    const parts = pair.split("=");
    if (parts.length >= 2) {
      return {
        name: parts[0].trim(),
        value: parts.slice(1).join("=").trim(),
        domain: domainHost,
        path: "/"
      };
    }
    return null;
  }).filter(Boolean);
}
function getRetryDelay(attempt) {
  const base = Math.min(3e4, 1e3 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}
async function uploadToVps(endpoint, data, options = {}) {
  if (getEnvFlag("SYNC_LOCAL_STAGING_ONLY", false)) {
    console.log(`\u2139\uFE0F \u672C\u673A Staging \u6A21\u5F0F\uFF1A\u8DF3\u8FC7 VPS \u5199\u5165 ${endpoint}`);
    return { success: true, skipped: true, endpoint };
  }
  if (!ADMIN_API_TOKEN) {
    console.error("\u274C \u672C\u5730\u672A\u914D\u7F6E ADMIN_API_TOKEN\uFF01\u65E0\u6CD5\u5411 VPS \u5199\u5165\u6570\u636E\u3002");
    throw new Error("Missing ADMIN_API_TOKEN");
  }
  const url = `${FOSU_API_BASE}${endpoint}`;
  console.log(`\u{1F4E4} \u6B63\u5728\u4E0A\u4F20\u6570\u636E\u5230 VPS: ${url} ...`);
  const maxRetries = options.maxRetries === void 0 ? 4 : options.maxRetries;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`\u2705 VPS \u54CD\u5E94: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      const retryable = shouldRetryError(error);
      console.error(`\u274C \u4E0A\u4F20\u5931\u8D25 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
        console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
      }
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   \u23F3 \u7F51\u7EDC\u6296\u52A8\u53EF\u91CD\u8BD5\uFF0C${delay}ms \u540E\u7EE7\u7EED...`);
      await sleep(delay);
    }
  }
}
async function fetchVpsSyncStatus() {
  const url = `${FOSU_API_BASE}/api/admin/sync/status`;
  console.log(`\u{1F50E} \u6B63\u5728\u8BFB\u53D6 VPS \u540C\u6B65\u72B6\u6001: ${url} ...`);
  const response = await axios.get(url, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false,
    // 显式禁用代理
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  return response.data;
}
function generateSnapshotVersion() {
  const now = /* @__PURE__ */ new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}
function normalizeScheduleEntryCourses(entry, fallbackContext = {}) {
  const context = Object.assign({}, fallbackContext, {
    semester: entry.semester || fallbackContext.semester,
    className: entry.className || fallbackContext.className,
    sourceType: entry.sourceType || fallbackContext.sourceType || "class",
    audienceType: entry.audienceType || fallbackContext.audienceType || "student"
  });
  const courses = normalizer.normalizeCourseList(entry.courses || [], context);
  return Object.assign({}, entry, { courses });
}
function parsePositiveLimit(value) {
  const number = parseInt(value || "", 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function isUsableResourceName(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !["\u5F85\u8865\u5145", "\u6682\u65E0", "\u65E0", "\u672A\u77E5", "\u591A\u4E2A\u5730\u70B9", "\u591A\u4E2A\u6559\u5E08", "\u89C1\u901A\u77E5", "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5"].includes(text);
}
function limitMapEntries(map, limit) {
  const entries = Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }));
  return limit > 0 ? entries.slice(0, limit) : entries;
}
function pushGroupedCourse(map, key, course) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(course);
}
function buildSnapshotResources(classSchedules, options = {}) {
  const includeTeachers = options.includeTeachers !== void 0 ? options.includeTeachers : getEnvFlag("SYNC_RESOURCES_TEACHERS", false);
  const includeClassrooms = options.includeClassrooms !== void 0 ? options.includeClassrooms : getEnvFlag("SYNC_RESOURCES_CLASSROOMS", false);
  const includeCourses = options.includeCourses !== void 0 ? options.includeCourses : getEnvFlag("SYNC_RESOURCES_COURSES", false);
  const limit = parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
  const teacherMap = /* @__PURE__ */ new Map();
  const classroomMap = /* @__PURE__ */ new Map();
  const courseMap = /* @__PURE__ */ new Map();
  (classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => {
      const baseCourse = Object.assign({}, course, {
        semester: course.semester || schedule.semester,
        classId: course.classId || schedule.classId || "",
        className: course.className || schedule.className || "",
        collegeCode: course.collegeCode || schedule.collegeCode || "",
        collegeName: course.collegeName || schedule.collegeName || "",
        grade: course.grade || schedule.grade || "",
        majorCode: course.majorCode || schedule.majorCode || "",
        majorName: course.majorName || schedule.majorName || ""
      });
      const courseName = baseCourse.canonicalCourseName || baseCourse.displayCourseName || baseCourse.courseName;
      const teacherName = baseCourse.canonicalTeacherName || baseCourse.displayTeacherName || baseCourse.teacherName;
      const classroom = baseCourse.canonicalClassroom || baseCourse.displayClassroom || baseCourse.classroom;
      if (includeTeachers && isUsableResourceName(teacherName) && !baseCourse.isTeacherFieldActuallyCourseName && !courseIdentity.isCourseLike(teacherName)) {
        pushGroupedCourse(teacherMap, teacherName, baseCourse);
      }
      if (includeClassrooms && isUsableResourceName(classroom)) {
        pushGroupedCourse(classroomMap, classroom, baseCourse);
      }
      if (includeCourses && isUsableResourceName(courseName) && !courseIdentity.isVenueLike(courseName)) {
        pushGroupedCourse(courseMap, courseName, baseCourse);
      }
    });
  });
  const teacherEntries = limitMapEntries(teacherMap, limit);
  const classroomEntries = limitMapEntries(classroomMap, limit);
  const courseEntries = limitMapEntries(courseMap, limit);
  return {
    teachers: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courseCount: courses.length })),
    classrooms: classroomEntries.map(([roomName, courses]) => ({ roomName, courseCount: courses.length })),
    courses: courseEntries.map(([courseName, courses]) => ({ courseName, courseCount: courses.length })),
    teacherSchedules: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courses })),
    classroomSchedules: classroomEntries.map(([roomName, courses]) => ({ roomName, courses })),
    courseSchedules: courseEntries.map(([courseName, courses]) => ({ courseName, courses }))
  };
}
function emptySnapshotResources() {
  return {
    teachers: [],
    classrooms: [],
    courses: [],
    teacherSchedules: [],
    classroomSchedules: [],
    courseSchedules: []
  };
}
function normalizeSnapshotResources(resources) {
  const source = Object.assign(emptySnapshotResources(), resources || {});
  return {
    teachers: source.teachers || [],
    classrooms: source.classrooms || [],
    courses: source.courses || [],
    teacherSchedules: (source.teacherSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "teacher",
      audienceType: "teacher"
    })),
    classroomSchedules: (source.classroomSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "classroom",
      audienceType: "classroom"
    })),
    courseSchedules: (source.courseSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "course",
      audienceType: "course"
    }))
  };
}
function collectSnapshotCourses(snapshot) {
  const result = [];
  (snapshot.classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => result.push({ scheduleType: "class", scheduleName: schedule.className, course }));
  });
  const resources = snapshot.resources || {};
  [
    ["teacher", resources.teacherSchedules || [], "teacherName"],
    ["classroom", resources.classroomSchedules || [], "roomName"],
    ["course", resources.courseSchedules || [], "courseName"]
  ].forEach(([scheduleType, schedules, nameKey]) => {
    schedules.forEach((schedule) => {
      (schedule.courses || []).forEach((course) => result.push({
        scheduleType,
        scheduleName: schedule[nameKey],
        course
      }));
    });
  });
  return result;
}
function buildNormalizeReport(snapshot) {
  const entries = collectSnapshotCourses(snapshot);
  const reasons = {};
  const samples = [];
  let normalizedCourseCount = 0;
  let venueCourseNameCount = 0;
  let teacherFieldCourseNameCount = 0;
  let physicalEducationLikeCount = 0;
  entries.forEach((entry) => {
    const course = entry.course || {};
    const reason = course.normalizationReason || "normal";
    reasons[reason] = (reasons[reason] || 0) + 1;
    const changed = reason !== "normal" || course.rawCourseName && course.canonicalCourseName && course.rawCourseName !== course.canonicalCourseName || course.rawClassroom && course.canonicalClassroom && course.rawClassroom !== course.canonicalClassroom || course.rawTeacherName && course.canonicalTeacherName && course.rawTeacherName !== course.canonicalTeacherName;
    if (changed) {
      normalizedCourseCount++;
      if (samples.length < 30) {
        samples.push({
          scheduleType: entry.scheduleType,
          scheduleName: entry.scheduleName,
          rawCourseName: course.rawCourseName || course.courseName,
          rawTeacherName: course.rawTeacherName || course.teacherName,
          rawClassroom: course.rawClassroom || course.classroom,
          canonicalCourseName: course.canonicalCourseName,
          canonicalClassroom: course.canonicalClassroom,
          canonicalTeacherName: course.canonicalTeacherName,
          normalizationReason: reason
        });
      }
    }
    if (course.isVenueCandidate) {
      venueCourseNameCount++;
    }
    if (course.isTeacherFieldActuallyCourseName) {
      teacherFieldCourseNameCount++;
    }
    if (course.isPhysicalEducationLike) {
      physicalEducationLikeCount++;
    }
  });
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    snapshotVersion: snapshot.version,
    semester: snapshot.semester,
    totalCourseCount: entries.length,
    normalizedCourseCount,
    venueCourseNameCount,
    teacherFieldCourseNameCount,
    physicalEducationLikeCount,
    reasons,
    samples
  };
}
function writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer) {
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json"), snapshotJson, "utf-8");
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json.gz"), compressedBuffer);
  const cliParams = global.CLI_PARAMS || {};
  if (cliParams.output) {
    const outputPath = resolveOutputFilePath(cliParams.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, snapshotJson, "utf-8");
    console.log(`\u{1F4BE} \u5DF2\u6309 output \u53C2\u6570\u5BFC\u51FA\u6570\u636E\u81F3: ${outputPath}`);
  }
  const normalizeReport = buildNormalizeReport(snapshot);
  fs.writeFileSync(path.join(debugDir, "normalize-report-latest.json"), JSON.stringify(normalizeReport, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u89C4\u8303\u5316\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/normalize-report-latest.json\uFF0C\u4FEE\u6B63\u8BFE\u7A0B ${normalizeReport.normalizedCourseCount}/${normalizeReport.totalCourseCount} \u6761`);
  return normalizeReport;
}
function buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, options = {}) {
  const version = generateSnapshotVersion();
  const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const noScheduleCachePath = path.join(__dirname, ".debug", "no-schedule-majors.json");
  const noScheduleMajors = readJsonArray(noScheduleCachePath);
  const md5 = (str) => crypto.createHash("md5").update(str).digest("hex");
  const updatedSchedules = (allClassSchedules || []).map((item) => {
    const classId = item.classId || md5(`${item.semester}_${item.collegeCode}_${item.grade}_${item.majorCode}_${item.className}`);
    const withClassId = Object.assign({}, item, { classId });
    return normalizeScheduleEntryCourses(withClassId, {
      semester: item.semester || activeSemester,
      classId,
      className: item.className,
      sourceType: "class",
      audienceType: "student"
    });
  });
  let oldResources = { teachers: [], classrooms: [], courses: [], teacherSchedules: [], classroomSchedules: [], courseSchedules: [] };
  const oldResourcesPath = path.join(__dirname, ".debug", "resources-latest.json");
  if (fs.existsSync(oldResourcesPath)) {
    try {
      oldResources = JSON.parse(fs.readFileSync(oldResourcesPath, "utf-8"));
    } catch (e2) {
    }
  }
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const derivedResources = buildSnapshotResources(updatedSchedules, options.resources || {});
  const resources = normalizeSnapshotResources(resourceSchedules || {
    teachers: options.resources?.includeTeachers ? derivedResources.teachers : oldResources.teachers || [],
    classrooms: options.resources?.includeClassrooms ? derivedResources.classrooms : oldResources.classrooms || [],
    courses: options.resources?.includeCourses ? derivedResources.courses : oldResources.courses || [],
    teacherSchedules: options.resources?.includeTeacherSchedules ? derivedResources.teacherSchedules : oldResources.teacherSchedules || [],
    classroomSchedules: options.resources?.includeClassroomSchedules ? derivedResources.classroomSchedules : oldResources.classroomSchedules || [],
    courseSchedules: options.resources?.includeCourseSchedules ? derivedResources.courseSchedules : oldResources.courseSchedules || []
  });
  const collegeCount = (catalog.colleges || []).length;
  const majorCount = (majors || []).length;
  const classScheduleCount = updatedSchedules.length;
  const adminClassCount = updatedSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const noScheduleMajorCount = noScheduleMajors.length;
  const teacherScheduleCount = resources.teacherSchedules.length;
  const classroomScheduleCount = resources.classroomSchedules.length;
  const courseScheduleCount = resources.courseSchedules.length;
  const timeTableSections = [
    { section: 1, start: "08:00", end: "08:40" },
    { section: 2, start: "08:45", end: "09:25" },
    { section: 3, start: "09:40", end: "10:20" },
    { section: 4, start: "10:25", end: "11:05" },
    { section: 5, start: "11:10", end: "11:50" },
    { section: 6, start: "13:30", end: "14:10" },
    { section: 7, start: "14:15", end: "14:55" },
    { section: 8, start: "15:10", end: "15:50" },
    { section: 9, start: "15:55", end: "16:35" },
    { section: 10, start: "16:40", end: "17:20" },
    { section: 11, start: "18:30", end: "19:10" },
    { section: 12, start: "19:15", end: "19:55" },
    { section: 13, start: "20:05", end: "20:45" },
    { section: 14, start: "20:50", end: "21:30" }
  ];
  const cliParams = global.CLI_PARAMS || {};
  const generatedCommand = global.GENERATED_COMMAND || `node sync.js local-campus ${process.argv.slice(2).join(" ")}`;
  const termStartDate = cliParams.start || getTermStartDate(activeSemester) || "2026-03-09";
  const cacheUsage = global.CLASS_SCHEDULE_CACHE_USAGE || {};
  const metaWarnings = [];
  if (cacheUsage.warning) {
    metaWarnings.push(cacheUsage.warning);
  }
  const counts = {
    classScheduleCount,
    adminClassCount,
    majorAggregateCount,
    teacherScheduleCount,
    classroomScheduleCount,
    courseScheduleCount,
    classroomCount: resources.classrooms.length,
    teacherCount: resources.teachers.length,
    courseCount: resources.courses.length,
    collegeCount,
    majorCount,
    gradeCount: (catalog.grades || []).length,
    noScheduleMajorCount
  };
  const summaryParts = [];
  if (includeScopes.includes("classSchedules")) summaryParts.push("\u884C\u653F\u73ED\u8BFE\u8868");
  if (includeScopes.includes("teachers")) summaryParts.push("\u6559\u5E08\u5217\u8868");
  if (includeScopes.includes("teacherSchedules")) summaryParts.push("\u6559\u5E08\u8BFE\u8868");
  if (includeScopes.includes("classrooms")) summaryParts.push("\u6559\u5BA4\u5217\u8868");
  if (includeScopes.includes("classroomSchedules")) summaryParts.push("\u6559\u5BA4\u8BFE\u8868");
  if (includeScopes.includes("courses")) summaryParts.push("\u8BFE\u7A0B\u5217\u8868");
  if (includeScopes.includes("courseSchedules")) summaryParts.push("\u8BFE\u7A0B\u8BFE\u8868");
  const scopeSummary = "\u66F4\u65B0: " + summaryParts.join(", ") + "; \u4FDD\u7559\u5176\u4ED6\u5386\u53F2\u6570\u636E";
  return {
    schemaVersion: "1.0",
    releaseVersion: cliParams.version || version,
    term: activeSemester,
    termStartDate,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    version,
    semester: activeSemester,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    releaseNote: cliParams.note || "\u5168\u6821\u8BFE\u8868\u6570\u636E\u5DF2\u66F4\u65B0",
    source: "local-sync-client",
    disclaimer: "\u672C\u5DE5\u5177\u4E3A\u4E2A\u4EBA\u5F00\u53D1\uFF0C\u975E\u5B66\u6821\u5B98\u65B9\u670D\u52A1\u3002\u8BFE\u7A0B\u6570\u636E\u7531\u5F00\u53D1\u8005\u6574\u7406\u7EF4\u62A4\u53CA\u7528\u6237\u53CD\u9988\u4FEE\u6B63\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u5177\u4F53\u5B89\u6392\u8BF7\u4EE5\u4EFB\u8BFE\u6559\u5E08\u901A\u77E5\u53CA\u6B63\u5F0F\u901A\u77E5\u4E3A\u51C6\u3002",
    // 注入 meta
    meta: {
      term: activeSemester,
      startDate: termStartDate,
      includeScopes,
      classScope: cliParams.classScope || cliParams["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: cliParams.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(cliParams.forceRefresh || cliParams["force-refresh"]),
      ignoreProgress: Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]),
      scopeSummary,
      generatedCommand,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      counts,
      cacheUsage: {
        usedClassScheduleCache: Boolean(cacheUsage.usedClassScheduleCache || cacheUsage.used),
        cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
        cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null
      },
      warnings: metaWarnings,
      usedClassScheduleCache: Boolean(cacheUsage.usedClassScheduleCache || cacheUsage.used),
      cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
      cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null
    },
    catalog: {
      semesters: catalog.semesters || [],
      colleges: catalog.colleges || [],
      grades: catalog.grades || [],
      weeks: catalog.weeks || [],
      sections: catalog.sections || []
    },
    majors: majors || [],
    classSchedules: updatedSchedules,
    resources,
    timeTable: {
      sections: timeTableSections
    },
    coverage: {
      collegeCount,
      majorCount,
      classScheduleCount,
      adminClassCount,
      majorAggregateCount,
      noScheduleMajorCount,
      teacherScheduleCount,
      classroomScheduleCount,
      courseScheduleCount
    }
  };
}
async function uploadSnapshot(buffer) {
  const url = `${FOSU_API_BASE}/api/admin/release/upload`;
  console.log(`\u{1F4E4} \u6B63\u5728\u4E0A\u4F20\u5FEB\u7167 (\u4F53\u79EF: ${(buffer.length / 1024 / 1024).toFixed(2)} MB) to: ${url}...`);
  const maxRetries = 4;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`\u2705 \u5FEB\u7167\u4E0A\u4F20 VPS \u6210\u529F: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      console.error(`\u274C \u5FEB\u7167\u4E0A\u4F20 VPS \u5931\u8D25 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
        console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
      }
      if (!shouldRetryError(error) || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   \u23F3 \u5FEB\u7167\u4E0A\u4F20\u5C06\u5728 ${delay}ms \u540E\u91CD\u8BD5...`);
      await sleep(delay);
    }
  }
}
async function activateSnapshot(version) {
  const url = `${FOSU_API_BASE}/api/admin/release/activate`;
  console.log(`\u{1F514} \u6B63\u5728\u8BF7\u6C42\u6FC0\u6D3B\u5FEB\u7167 (\u7248\u672C: ${version}) to: ${url}...`);
  try {
    const response = await axios.post(url, { version }, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false
      // 显式禁用代理
    });
    return response.data;
  } catch (error) {
    console.error(`\u274C \u5FEB\u7167\u6FC0\u6D3B\u5931\u8D25: ${error.message}`);
    if (error.response) {
      console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
      console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}
async function verifyEndpoints() {
  const bootstrapUrl = `${FOSU_API_BASE}/api/fosu/bootstrap`;
  const statusUrl = `${FOSU_API_BASE}/api/admin/sync/status`;
  const releaseStatusUrl = `${FOSU_API_BASE}/api/admin/release/status`;
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1 bootstrap \u63A5\u53E3: ${bootstrapUrl}...`);
  const bRes = await axios.get(bootstrapUrl, { proxy: false });
  console.log(`   \u6210\u529F: ${bRes.data.success}, \u6570\u636E\u6E90: ${bRes.data.dataSource}, \u73ED\u7EA7\u6570: ${bRes.data.counts?.classScheduleCount}`);
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1\u7BA1\u7406\u5458\u72B6\u6001\u63A5\u53E3: ${statusUrl}...`);
  const sRes = await axios.get(statusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   \u5FEB\u7167\u7248\u672C: ${sRes.data.snapshotVersion}, \u5FEB\u7167\u66F4\u65B0\u65F6\u95F4: ${sRes.data.snapshotUpdatedAt}`);
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1 release \u72B6\u6001\u63A5\u53E3: ${releaseStatusUrl}...`);
  const rRes = await axios.get(releaseStatusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   Active release: ${rRes.data.activeReleaseVersion}, updatedAt: ${rRes.data.activeReleaseUpdatedAt}`);
  return {
    bootstrap: bRes.data,
    status: sRes.data,
    releaseStatus: rRes.data
  };
}
function printReleaseSummary(snapshot, uploadResponse, activateResponse, verifyResponse) {
  const coverage = snapshot.coverage || {};
  const dryRun = Boolean(uploadResponse && uploadResponse.dryRun);
  console.log("\n================ [sync:release \u53D1\u5E03\u6458\u8981] ================");
  console.log(`- semester: ${snapshot.semester}`);
  console.log(`- collegesCount: ${coverage.collegeCount || coverage.collegesCount || 0}`);
  console.log(`- majorsCount: ${coverage.majorCount || coverage.majorsCount || 0}`);
  console.log(`- classScheduleCount: ${coverage.classScheduleCount || 0}`);
  console.log(`- teacherScheduleCount: ${coverage.teacherScheduleCount || 0}`);
  console.log(`- classroomScheduleCount: ${coverage.classroomScheduleCount || 0}`);
  console.log(`- courseScheduleCount: ${coverage.courseScheduleCount || 0}`);
  console.log(`- snapshotVersion: ${snapshot.version}`);
  console.log(`- updatedAt: ${snapshot.updatedAt}`);
  console.log(`- upload batches: ${dryRun ? 0 : uploadResponse ? 1 : 0}`);
  console.log(`- failed batches: 0`);
  console.log(`- activeReleaseVersion: ${dryRun ? "(dry-run, not activated)" : activateResponse?.version || verifyResponse?.releaseStatus?.activeReleaseVersion || ""}`);
  console.log("=======================================================\n");
}
function validateLocalReleaseSnapshot(snapshot) {
  const validation = releaseService.validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    console.error("\u274C \u672C\u5730 release \u6821\u9A8C\u5931\u8D25\uFF1A");
    validation.errors.slice(0, 20).forEach((error) => console.error(`   - ${error}`));
    if (validation.errors.length > 20) {
      console.error(`   ... \u8FD8\u6709 ${validation.errors.length - 20} \u4E2A\u9519\u8BEF`);
    }
    throw new Error("Release validation failed");
  }
  console.log(`\u2705 \u672C\u5730 release \u6821\u9A8C\u901A\u8FC7\uFF1AclassScheduleCount=${validation.counts.classScheduleCount}`);
  return validation;
}
function getUploadChunkSize() {
  const parsed2 = parseInt(process.env.SYNC_UPLOAD_CHUNK_SIZE || "10", 10);
  if (Number.isFinite(parsed2) && parsed2 > 0) {
    return parsed2;
  }
  console.warn(`\u26A0\uFE0F SYNC_UPLOAD_CHUNK_SIZE=${process.env.SYNC_UPLOAD_CHUNK_SIZE} \u65E0\u6548\uFF0C\u5DF2\u56DE\u9000\u4E3A 10\u3002`);
  return 10;
}
function getFormattedTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}
function shouldRetryError(error) {
  if (!error) return false;
  if (error.response) {
    const status = error.response.status;
    if ([502, 503, 504].includes(status)) {
      return true;
    }
    if ([400, 401, 403].includes(status)) {
      return false;
    }
  }
  const errCode = error.code || "";
  const errMessage = error.message || "";
  const retryCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
  if (retryCodes.includes(errCode)) {
    return true;
  }
  const retryMessages = [
    "socket hang up",
    "timeout",
    "Client network socket disconnected before secure TLS connection was established",
    "disconnected before secure TLS connection"
  ];
  if (retryMessages.some((msg) => errMessage.includes(msg))) {
    return true;
  }
  return false;
}
async function uploadWithRetry(endpoint, chunk, chunkNumber, totalChunks) {
  const maxRetries = 5;
  const retryDelays = [2e3, 5e3, 1e4, 2e4, 3e4];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await uploadToVps(endpoint, chunk, { maxRetries: 1 });
      if (!Array.isArray(chunk) && Array.isArray(chunk && chunk.items)) {
        chunk.length = chunk.items.length;
      }
      console.log(`   \u2705 [chunk ${chunkNumber}/${totalChunks}] \u4E0A\u4F20\u6210\u529F (\u5171 ${chunk.length} \u6761)`);
      return result;
    } catch (error) {
      const isRetryable = shouldRetryError(error);
      const attemptStr = `[chunk ${chunkNumber}/${totalChunks}] \u7B2C ${attempt} \u6B21\u5C1D\u8BD5\u5931\u8D25.`;
      if (attempt <= maxRetries && isRetryable) {
        const delay = retryDelays[attempt - 1] || 3e4;
        console.warn(`   \u26A0\uFE0F ${attemptStr} \u9519\u8BEF\u53EF\u91CD\u8BD5: ${error.message}\u3002\u5C06\u5728 ${delay / 1e3}s \u540E\u8FDB\u884C\u7B2C ${attempt + 1} \u6B21\u5C1D\u8BD5...`);
        await sleep(delay);
      } else {
        console.error(`   \u274C ${attemptStr} \u53D1\u751F\u4E0D\u53EF\u91CD\u8BD5\u9519\u8BEF\u6216\u91CD\u8BD5\u6B21\u6570\u8D85\u9650\u3002\u9519\u8BEF: ${error.message}`);
        throw error;
      }
    }
  }
}
function readUploadProgress(sourceFilePath) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const forceRestart = getEnvFlag("SYNC_UPLOAD_FORCE_RESTART", false);
  if (forceRestart) {
    console.log("\u2139\uFE0F SYNC_UPLOAD_FORCE_RESTART=true\uFF0C\u5FFD\u7565\u5DF2\u5B58\u5728\u7684\u4E0A\u4F20\u8FDB\u5EA6\uFF0C\u5C06\u4ECE\u5934\u5F00\u59CB\u91CD\u65B0\u4E0A\u4F20\u3002");
    return { uploadedChunkIndexes: [] };
  }
  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      if (progress.sourceFile === sourceFilePath) {
        console.log(`\u2139\uFE0F \u6062\u590D\u4E0A\u6B21\u4E0A\u4F20\u8FDB\u5EA6\uFF0C\u5DF2\u6210\u529F\u4E0A\u4F20\u6279\u6B21: ${progress.uploadedChunkIndexes.join(", ")}`);
        return progress;
      } else {
        console.log(`\u2139\uFE0F \u8FDB\u5EA6\u6587\u4EF6\u4E2D\u7684\u6E90\u6587\u4EF6\u4E0D\u5339\u914D (${progress.sourceFile} vs ${sourceFilePath})\uFF0C\u91CD\u65B0\u5F00\u59CB\u3002`);
      }
    } catch (e2) {
      console.warn("\u26A0\uFE0F \u8BFB\u53D6\u4E0A\u4F20\u8FDB\u5EA6\u6587\u4EF6\u5931\u8D25\uFF0C\u5C06\u91CD\u65B0\u4E0A\u4F20\u3002");
    }
  }
  return { uploadedChunkIndexes: [] };
}
function writeUploadProgress(sourceFilePath, semester2, total, chunkSize, uploadedChunkIndexes) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const progress = {
    sourceFile: sourceFilePath,
    semester: semester2,
    total,
    chunkSize,
    uploadedChunkIndexes,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}
function saveFullClassSchedules(allClassSchedules, semester2) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const payload = {
    success: true,
    type: "class-schedules",
    semester: semester2,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    itemCount: allClassSchedules.length,
    items: allClassSchedules
  };
  const latestPath = path.join(debugDir, "class-schedules-latest.json");
  const timestampPath = path.join(debugDir, `class-schedules-${getFormattedTimestamp()}.json`);
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(timestampPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3:
  - ${latestPath}
  - ${timestampPath}`);
  return { latestPath, timestampPath };
}
async function uploadClassSchedulesInChunks(classSchedules, debugDir, sourceFilePath, semester2) {
  const chunkSize = getUploadChunkSize();
  const totalChunks = Math.ceil(classSchedules.length / chunkSize);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const progress = readUploadProgress(sourceFilePath);
  const uploadedChunkIndexes = progress.uploadedChunkIndexes || [];
  console.log(`\u{1F4E6} \u5F00\u59CB\u5206\u5757\u4E0A\u4F20\u73ED\u7EA7\u8BFE\u8868: ${classSchedules.length} \u6761\uFF0C\u6BCF\u6279 ${chunkSize} \u6761\uFF0C\u5171 ${totalChunks} \u6279\u3002`);
  for (let index = 0; index < totalChunks; index++) {
    const chunkNumber = index + 1;
    if (uploadedChunkIndexes.includes(chunkNumber)) {
      console.log(`\u23ED\uFE0F [chunk ${chunkNumber}/${totalChunks}] \u8BE5\u5206\u5757\u5DF2\u4E0A\u4F20\u8FC7\uFF0C\u81EA\u52A8\u8DF3\u8FC7\u3002`);
      continue;
    }
    const start = index * chunkSize;
    const chunk = classSchedules.slice(start, start + chunkSize);
    try {
      await uploadWithRetry("/api/admin/sync/class-schedules?mode=merge", chunk, chunkNumber, totalChunks);
      uploadedChunkIndexes.push(chunkNumber);
      writeUploadProgress(sourceFilePath, semester2, classSchedules.length, chunkSize, uploadedChunkIndexes);
    } catch (error) {
      const failedPath = path.join(debugDir, `failed-class-schedules-chunk-${chunkNumber}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(chunk, null, 2), "utf-8");
      console.error(`\u274C [chunk ${chunkNumber}/${totalChunks}] \u5386\u7ECF\u591A\u6B21\u91CD\u8BD5\u4E0A\u4F20\u5931\u8D25\uFF0C\u5931\u8D25\u6279\u6B21\u5DF2\u4FDD\u5B58: ${failedPath}`);
      console.error(`\u26A0\uFE0F \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3 .debug/class-schedules-latest.json\uFF0C\u53EF\u7A0D\u540E\u6267\u884C upload-only \u7EE7\u7EED\u4E0A\u4F20\u3002`);
      throw error;
    }
  }
  try {
    const progressPath = path.join(debugDir, "class-upload-progress.json");
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
      console.log("\u{1F389} \u6240\u6709\u5206\u5757\u5DF2\u4E0A\u4F20\u6210\u529F\uFF0C\u5DF2\u6E05\u9664\u65AD\u70B9\u7EED\u4F20\u8FDB\u5EA6\u3002");
    }
  } catch (e2) {
  }
  const status = await fetchVpsSyncStatus();
  console.log("\n\u{1F50D} === [VPS \u540C\u6B65\u72B6\u6001\u9A8C\u8BC1] ===");
  console.log(`- classScheduleCount: ${status.classScheduleCount ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- classSchedulesUpdatedAt: ${status.classSchedulesUpdatedAt ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- storageMounted: ${status.storageMounted ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- storagePath: ${status.storagePath ?? "\u672A\u83B7\u53D6"}`);
  console.log("==============================\n");
  return status;
}
function readClassSchedulesFromFile() {
  const debugDir = path.join(__dirname, ".debug");
  const candidates = [];
  if (process.env.SYNC_CLASS_UPLOAD_FILE) {
    candidates.push(path.resolve(process.env.SYNC_CLASS_UPLOAD_FILE));
  }
  candidates.push(path.join(debugDir, "class-schedules-latest.json"));
  candidates.push(path.join(debugDir, "last-class-schedules.json"));
  candidates.push(path.join(debugDir, "last-class-schedules-upload.json"));
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        console.log(`\u{1F4D6} \u6B63\u5728\u4ECE\u672C\u5730\u6587\u4EF6\u8BFB\u53D6\u8BFE\u8868\u6570\u636E: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);
        let items2 = null;
        if (Array.isArray(json)) {
          items2 = json;
        } else if (json && Array.isArray(json.items)) {
          items2 = json.items;
        } else if (json && Array.isArray(json.data)) {
          items2 = json.data;
        } else if (json && Array.isArray(json.classSchedules)) {
          items2 = json.classSchedules;
        }
        if (items2 && items2.length > 0) {
          console.log(`\u2705 \u6210\u529F\u63D0\u53D6\u51FA ${items2.length} \u6761\u8BFE\u8868\u6570\u636E\u3002`);
          return { items: items2, filePath };
        }
      } catch (err) {
        console.warn(`\u26A0\uFE0F \u8BFB\u53D6\u6587\u4EF6\u5931\u8D25\uFF0C\u5C1D\u8BD5\u4E0B\u4E00\u4E2A\u8DEF\u5F84: ${filePath} (${err.message})`);
      }
    }
  }
  const errorMessage = [
    "\u274C \u672A\u627E\u5230\u4EFB\u4F55\u6709\u6548\u7684\u5B8C\u6574\u8BFE\u8868\u7F13\u5B58\u6587\u4EF6\uFF01",
    "\u5DF2\u68C0\u67E5\u7684\u8DEF\u5F84\u5217\u8868\u5982\u4E0B\uFF1A"
  ];
  candidates.forEach((c) => errorMessage.push(`  - ${c}`));
  if (fs.existsSync(debugDir)) {
    const files = fs.readdirSync(debugDir);
    const failedChunks = files.filter((f) => f.startsWith("failed-class-schedules-chunk-"));
    if (failedChunks.length > 0) {
      errorMessage.push(`\u5F53\u524D\u76EE\u5F55\u4E0B\u4EC5\u53D1\u73B0\u5206\u5757\u5931\u8D25\u6587\u4EF6: ${failedChunks.join(", ")}\uFF0C\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u662F\u5B8C\u6574\u6570\u636E\u3002`);
    }
  }
  throw new Error(errorMessage.join("\n"));
}
function tryReadClassSchedulesFromFile() {
  try {
    return readClassSchedulesFromFile();
  } catch (error) {
    return { items: [], filePath: null, error };
  }
}
function readClassScheduleCacheForSemester(semester2) {
  const cache = tryReadClassSchedulesFromFile();
  const items2 = Array.isArray(cache.items) ? cache.items : [];
  if (items2.length === 0) {
    return cache;
  }
  const matchedItems = items2.filter((item) => {
    const itemSemester = item && (item.semester || item.term || item.xnxqh);
    return !itemSemester || !semester2 || itemSemester === semester2;
  });
  if (matchedItems.length === 0) {
    return {
      items: [],
      filePath: cache.filePath,
      error: new Error(`\u5386\u53F2 classSchedules \u7F13\u5B58\u5B58\u5728\uFF0C\u4F46\u6CA1\u6709\u5339\u914D\u5B66\u671F ${semester2} \u7684\u8BFE\u8868\u8BB0\u5F55\u3002`)
    };
  }
  if (matchedItems.length !== items2.length) {
    console.log(`\u2139\uFE0F \u5386\u53F2\u8BFE\u8868\u7F13\u5B58\u6309\u5B66\u671F ${semester2} \u8FC7\u6EE4: ${items2.length} -> ${matchedItems.length} \u6761\u3002`);
  }
  return { items: matchedItems, filePath: cache.filePath };
}
function getClassScheduleIdentity(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  return item.classId || [
    item.semester || item.term || "",
    item.collegeCode || "",
    item.grade || "",
    item.majorCode || item.code || "",
    item.className || item.name || ""
  ].join("::");
}
function mergeClassSchedules(existing, incoming) {
  const merged = /* @__PURE__ */ new Map();
  (existing || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  (incoming || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
}
function printPowerShellCommands() {
  console.log("\n\u{1F4A1} Windows PowerShell \u5E38\u7528\u547D\u4EE4\u6307\u5357\uFF1A");
  console.log("--------------------------------------------------");
  console.log("\u{1F449} \u53EA\u6293\u53D6\u4E0D\u4E0A\u4F20 (Crawl Only):");
  console.log('   $env:SYNC_CLASS_SCOPE="all"');
  console.log('   $env:SYNC_CLASS_GRADES="2025,2024,2023,2022"');
  console.log('   $env:SYNC_CLASS_MAX_CONCURRENCY="1"');
  console.log('   $env:SYNC_CLASS_REQUEST_DELAY_MS="900"');
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY="true"');
  console.log("   npm run sync:class");
  console.log("");
  console.log("\u{1F449} \u53EA\u4E0A\u4F20\u672C\u5730\u7F13\u5B58 (Upload Only):");
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY=""');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:upload-cache");
  console.log("");
  console.log("\u{1F449} \u5F3A\u5236\u91CD\u65B0\u4E0A\u4F20\u672C\u5730\u7F13\u5B58 (Force Restart Upload):");
  console.log('   $env:SYNC_UPLOAD_FORCE_RESTART="true"');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:class");
  console.log("--------------------------------------------------\n");
}
async function handleUploadOnly() {
  const debugDir = path.join(__dirname, ".debug");
  try {
    const { items: items2, filePath } = readClassSchedulesFromFile();
    const semester2 = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    console.log(`\u{1F680} \u5F00\u59CB\u5728 upload-only \u6A21\u5F0F\u4E0B\u4E0A\u4F20\u6570\u636E\uFF0C\u6570\u636E\u6E90\uFF1A${filePath}\uFF0C\u5171\u8BA1 ${items2.length} \u6761\u3002`);
    await uploadClassSchedulesInChunks(items2, debugDir, filePath, semester2);
    console.log(`\u2705 \u672C\u5730\u7F13\u5B58\u6570\u636E\u4E0A\u4F20\u540C\u6B65\u6210\u529F\uFF01`);
  } catch (error) {
    console.error(`\u274C \u6267\u884C upload-only \u6A21\u5F0F\u5931\u8D25: 
${error.message}`);
    printPowerShellCommands();
    process.exit(1);
  }
}
async function handleOfflineRelease() {
  const zlib = require("zlib");
  console.log("\u{1F680} \u5F00\u59CB\u5728 offline-release \u6A21\u5F0F\u4E0B\u53D1\u5E03\u5FEB\u7167...");
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  const schedPath = path.join(__dirname, ".debug", "class-schedules-latest.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath) || !fs.existsSync(schedPath)) {
    throw new Error("\u79BB\u7EBF\u6A21\u5F0F\u4E0B\uFF0C\u5FC5\u987B\u5B58\u5728 last-catalog.json, last-majors.json \u548C .debug/class-schedules-latest.json \u7F13\u5B58\u6587\u4EF6\uFF01");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  const schedJson = JSON.parse(fs.readFileSync(schedPath, "utf-8"));
  const allClassSchedules = Array.isArray(schedJson) ? schedJson : schedJson.items || [];
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u672C\u5730\u8BFE\u8868\u7F13\u5B58\u6587\u4EF6\u4E2D\u7684\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF\u4E3A 0");
  }
  console.log(`\u{1F4D6} \u6210\u529F\u4ECE\u672C\u5730\u52A0\u8F7D\u57FA\u7840\u914D\u7F6E\u4E0E\u8BFE\u8868\u7F13\u5B58 (\u5171\u8BA1 ${allClassSchedules.length} \u6761\u8BFE\u8868)`);
  const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
    resources: {
      includeTeachers: includeReleaseResources,
      includeClassrooms: includeReleaseResources,
      includeCourses: includeReleaseResources
    }
  });
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
  const compressedBuffer = zlib.gzipSync(snapshotBuffer);
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
  console.log(`
\u{1F4BE} \u672C\u5730\u5FEB\u7167\u5DF2\u751F\u6210\u5E76\u538B\u7F29\uFF1A.debug/snapshot-latest.json \u548C .debug/snapshot-latest.json.gz (\u4F53\u79EF: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
  validateLocalReleaseSnapshot(snapshot);
  if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
    printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
    fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify({
      success: true,
      dryRun: true,
      version: snapshot.version,
      semester: snapshot.semester,
      updatedAt: snapshot.updatedAt,
      coverage: snapshot.coverage,
      normalizeReport,
      uploadSize: compressedBuffer.length
    }, null, 2), "utf-8");
    console.log("\u2139\uFE0F SYNC_RELEASE_DRY_RUN=true\uFF0C\u5DF2\u5B8C\u6210\u672C\u5730 release \u6784\u5EFA\u4E0E\u6821\u9A8C\uFF0C\u672A\u4E0A\u4F20\u6216\u6FC0\u6D3B VPS\u3002");
    return;
  }
  const uploadRes = await uploadSnapshot(compressedBuffer);
  const activateRes = await activateSnapshot(snapshot.version);
  console.log(`\u2705 \u5FEB\u7167\u6FC0\u6D3B\u6210\u529F! \u54CD\u5E94: ${JSON.stringify(activateRes)}`);
  const verifyRes = await verifyEndpoints();
  printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
  const report = {
    success: true,
    version: snapshot.version,
    semester: snapshot.semester,
    updatedAt: snapshot.updatedAt,
    coverage: snapshot.coverage,
    normalizeReport,
    uploadSize: compressedBuffer.length,
    serverStatus: verifyRes
  };
  fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u603B\u7ED3\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/sync-report-latest.json`);
  console.log("\n\u{1F389} [Release] \u79BB\u7EBF\u66B4\u529B\u5FEB\u7167\u53D1\u5E03\u5B8C\u6210\uFF01");
}
async function handleLocalStagingUpload(params) {
  const fileArg = params.file || params.input || "";
  const { resolved: filePath, tried } = resolveInputFilePath(fileArg);
  if (!filePath || !fs.existsSync(filePath)) {
    const errorMsg = [
      "Staging JSON \u6587\u4EF6\u4E0D\u5B58\u5728\u3002",
      `Received file arg: ${fileArg}`,
      `Current working directory (cwd): ${process.cwd()}`,
      `Detected project root: ${resolveProjectPath()}`,
      "Tried candidate paths:",
      ...tried.map((p) => `  - ${p}`)
    ].join("\n");
    throw new Error(errorMsg);
  }
  if (!ADMIN_API_TOKEN) {
    throw new Error("\u7F3A\u5C11 ADMIN_API_TOKEN\uFF0C\u65E0\u6CD5\u4E0A\u4F20\u5230\u540E\u53F0 Staging \u533A");
  }
  console.log(`Staging JSON resolved path: ${filePath}`);
  console.log("local-upload uses gzip + chunk upload and only writes pending-review Staging; it does not publish release.");
  return stagingUploader.uploadStagingFile({
    filePath,
    server: params.server || FOSU_API_BASE,
    token: ADMIN_API_TOKEN,
    authMode: "admin",
    params,
    term: params.term || process.env.PREFERRED_SEMESTER || "",
    note: params.note || "",
    source: "local-upload-cli"
  });
}
function writeLocalStagingDebugFailure(params, catalog, majors, error) {
  const term = params.term || process.env.PREFERRED_SEMESTER || catalog?.semesters?.[0]?.value || "term";
  const debugPayload = {
    success: false,
    type: "local-campus-staging-debug",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    error: error && (error.stack || error.message) || String(error),
    meta: {
      term,
      startDate: params.start || process.env.SYNC_TERM_START_DATE || "",
      includeScopes: global.CLI_PARAMS?.includeScopes || ALL_SCOPES,
      classScope: params.classScope || params["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: params.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(params.forceRefresh || params["force-refresh"]),
      ignoreProgress: Boolean(params.ignoreProgress || params["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(params.ignoreNoScheduleCache || params["ignore-no-schedule-cache"]),
      generatedCommand: global.GENERATED_COMMAND || process.argv.join(" "),
      counts: {
        collegeCount: catalog?.colleges?.length || 0,
        majorCount: majors?.length || 0,
        classScheduleCount: 0
      },
      cacheUsage: global.CLASS_SCHEDULE_CACHE_USAGE || null,
      warnings: ["\u672A\u751F\u6210\u6B63\u5F0F Staging JSON\uFF0C\u8BF7\u6309 error \u5B57\u6BB5\u5904\u7406\u540E\u91CD\u65B0\u8FD0\u884C\u3002"]
    }
  };
  const output = resolveOutputFilePath(params.debugOutput || path.join("staging", `debug-${term}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(debugPayload, null, 2), "utf-8");
  console.error(`\u{1F9EA} \u5DF2\u751F\u6210 debug JSON\uFF0C\u4E0D\u4F1A\u4F5C\u4E3A\u6B63\u5F0F Staging \u53D1\u5E03: ${output}`);
  return output;
}
async function handleLocalCampusStaging(page, params) {
  console.log("\n================ [\u672C\u673A\u6821\u56ED\u7F51\u91C7\u96C6 Staging] ================");
  process.env.SYNC_LOCAL_STAGING_ONLY = "true";
  process.env.SYNC_CLASS_CRAWL_ONLY = "true";
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map((c) => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map((g) => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);
  if (!isFiltered && includeScopes.includes("classSchedules")) {
    if (!process.env.SYNC_CLASS_SCOPE) {
      process.env.SYNC_CLASS_SCOPE = "all";
    }
  }
  const catalog = await syncCatalog(page);
  const majors = await syncMajors(page, catalog);
  let allClassSchedules = [];
  if (includeScopes.includes("classSchedules")) {
    try {
      allClassSchedules = await syncClassSchedules(page, catalog, majors);
    } catch (error) {
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
    if (!allClassSchedules || allClassSchedules.length === 0) {
      const error = new Error("\u672C\u673A\u6821\u56ED\u7F51\u91C7\u96C6\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u672A\u751F\u6210\u6B63\u5F0F Staging JSON");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message}\u3002\u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
  } else {
    console.log("\u2139\uFE0F \u540C\u6B65\u8303\u56F4\u4E0D\u5305\u542B\u884C\u653F\u73ED\u8BFE\u8868 (classSchedules)\u3002\u4ECE\u672C\u5730\u52A0\u8F7D\u5DF2\u6709\u7F13\u5B58\u4EE5\u4FDD\u62A4\u5B66\u751F\u8BFE\u8868\u3002");
    const cache = readClassScheduleCacheForSemester(process.env.PREFERRED_SEMESTER || params.term || catalog.semesters?.[0]?.value);
    allClassSchedules = cache.items || [];
    if (!allClassSchedules.length) {
      const error = cache.error || new Error("\u53EA\u66F4\u65B0\u516C\u5171\u8D44\u6E90\u65F6\u672A\u627E\u5230\u53EF\u5408\u5E76\u7684\u5386\u53F2 classSchedules\uFF0C\u7981\u6B62\u751F\u6210\u4F1A\u6E05\u7A7A\u5B66\u751F\u8BFE\u8868\u7684 Staging\u3002");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
    global.CLASS_SCHEDULE_CACHE_USAGE = {
      usedClassScheduleCache: true,
      cacheSource: cache.filePath,
      cacheWarning: "\u540C\u6B65\u8303\u56F4\u4E0D\u5305\u542B classSchedules\uFF0C\u5DF2\u5408\u5E76\u5386\u53F2\u884C\u653F\u73ED\u8BFE\u8868\u7F13\u5B58\u4EE5\u9632\u6B62\u53D1\u5E03\u540E\u6E05\u7A7A\u5B66\u751F\u8BFE\u8868\u3002"
    };
  }
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
    resources: {
      includeTeachers: includeScopes.includes("teachers"),
      includeClassrooms: includeScopes.includes("classrooms"),
      includeCourses: includeScopes.includes("courses"),
      includeTeacherSchedules: includeScopes.includes("teacherSchedules"),
      includeClassroomSchedules: includeScopes.includes("classroomSchedules"),
      includeCourseSchedules: includeScopes.includes("courseSchedules")
    }
  });
  if (includeScopes.includes("classSchedules") && (!snapshot.classSchedules || snapshot.classSchedules.length === 0)) {
    const error = new Error("includeScopes \u5305\u542B classSchedules\uFF0C\u4F46\u6700\u7EC8\u5FEB\u7167 classSchedules \u4E3A 0\uFF0C\u5DF2\u7981\u6B62\u751F\u6210\u6B63\u5F0F Staging\u3002");
    const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
    throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
  }
  validateLocalReleaseSnapshot(snapshot);
  const defaultOutput = path.join("staging", `${snapshot.semester || params.term || "term"}-full.json`);
  const output = resolveOutputFilePath(params.output || defaultOutput);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`\u{1F4BE} Staging JSON \u5DF2\u751F\u6210: ${output}`);
  console.log(`\u{1F4CA} \u884C\u653F\u73ED\u8BFE\u8868: ${snapshot.coverage.classScheduleCount || 0}, \u6559\u5E08\u8BFE\u8868: ${snapshot.coverage.teacherScheduleCount || 0}, \u6559\u5BA4\u8BFE\u8868: ${snapshot.coverage.classroomScheduleCount || 0}, \u8BFE\u7A0B\u8BFE\u8868: ${snapshot.coverage.courseScheduleCount || 0}`);
  console.log("\u2139\uFE0F \u5F53\u524D\u547D\u4EE4\u4E0D\u4F1A\u4E0A\u4F20\u3001\u4E0D\u4F1A\u53D1\u5E03\uFF1B\u4E0B\u4E00\u6B65\u8FD0\u884C sync:local-upload \u4E0A\u4F20\u5230 VPS Staging\u3002");
  return snapshot;
}
var RESOURCE_SYNC_CONFIGS = {
  teacher: {
    flag: "SYNC_RESOURCES_TEACHERS",
    schedulesKey: "teacherSchedules",
    indexKey: "teachers",
    endpointType: "teacher",
    label: "\u6559\u5E08"
  },
  classroom: {
    flag: "SYNC_RESOURCES_CLASSROOMS",
    schedulesKey: "classroomSchedules",
    indexKey: "classrooms",
    endpointType: "classroom",
    label: "\u6559\u5BA4"
  },
  course: {
    flag: "SYNC_RESOURCES_COURSES",
    schedulesKey: "courseSchedules",
    indexKey: "courses",
    endpointType: "course",
    label: "\u8BFE\u7A0B"
  }
};
function normalizeResourceTypeList(types) {
  const list = Array.isArray(types) && types.length ? types : ["teacher", "classroom", "course"];
  return list.filter((type) => RESOURCE_SYNC_CONFIGS[type]);
}
function getResourceDelayConfig() {
  const requestDelay = parseInt(process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "", 10);
  const min = parseInt(process.env.SYNC_RESOURCE_DELAY_MIN_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "800", 10);
  const max = parseInt(process.env.SYNC_RESOURCE_DELAY_MAX_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "1500", 10);
  return {
    concurrency: parseInt(process.env.SYNC_RESOURCE_MAX_CONCURRENCY || process.env.SYNC_RESOURCE_CONCURRENCY || "1", 10) || 1,
    requestDelayMs: Number.isFinite(requestDelay) && requestDelay >= 0 ? requestDelay : null,
    minDelayMs: Number.isFinite(min) ? min : 800,
    maxDelayMs: Number.isFinite(max) ? max : 1500
  };
}
function getResourceUploadChunkSize() {
  const value = parseInt(process.env.SYNC_RESOURCE_UPLOAD_CHUNK_SIZE || process.env.SYNC_UPLOAD_CHUNK_SIZE || "20", 10);
  return Number.isFinite(value) && value > 0 ? value : 20;
}
function buildResourceUploadId(type) {
  return `${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}
async function uploadResourceSchedules(resources, resourceTypes, semester2) {
  const results = {};
  const chunkSize = getResourceUploadChunkSize();
  const delayConfig = getResourceDelayConfig();
  const requestDelayMs = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : Math.max(0, delayConfig.minDelayMs);
  for (const type of normalizeResourceTypeList(resourceTypes)) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    const items2 = resources[config.schedulesKey] || [];
    const totalChunks = Math.max(1, Math.ceil(items2.length / chunkSize));
    const uploadId = buildResourceUploadId(type);
    console.log(`[resources] uploading ${type}: ${items2.length} items, ${chunkSize} per chunk, ${totalChunks} chunks`);
    let finalResult = null;
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkNumber = index + 1;
      const chunk = items2.slice(index * chunkSize, (index + 1) * chunkSize);
      const payload = {
        resourceType: type,
        semester: semester2,
        uploadId,
        chunkIndex: chunkNumber,
        totalChunks,
        chunkItemCount: chunk.length,
        items: chunk,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      finalResult = await uploadWithRetry(`/api/admin/sync/resources?type=${config.endpointType}`, payload, chunkNumber, totalChunks);
      if (chunkNumber < totalChunks && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }
    results[type] = Object.assign({
      resourceType: type,
      uploadId,
      chunkSize,
      totalChunks
    }, finalResult || {});
  }
  return results;
}
async function handleResourcesSync(resourceTypes) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  if (!fs.existsSync(manifestPath)) {
    console.error("\u274C \u6CA1\u6709\u627E\u5230\u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\uFF0Csync:resources \u53EA\u80FD\u57FA\u4E8E\u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u6D3E\u751F\u8D44\u6E90\u3002\u8BF7\u5148\u8FD0\u884C npm run sync:class \u6216 npm run sync:fresh\u3002");
    throw new Error("Missing class-schedules-manifest.json");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    console.error(`\u274C \u8BFB\u53D6\u6216\u89E3\u6790\u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u5931\u8D25: ${err.message}`);
    throw err;
  }
  if (manifest.semester !== preferredSemester) {
    const allowStale = getEnvFlag("SYNC_RESOURCES_ALLOW_STALE", false);
    if (!allowStale) {
      console.error(`\u274C \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u7684\u5B66\u671F [${manifest.semester}] \u4E0E\u5F53\u524D\u914D\u7F6E\u7684 Preferred Semester [${preferredSemester}] \u4E0D\u4E00\u81F4\uFF01`);
      console.error('\u{1F4A1} \u63D0\u793A: \u5DF2\u963B\u6B62\u6267\u884C\u4EE5\u9632\u6B62\u6D3E\u751F\u9519\u8BEF\u6570\u636E\u3002\u5982\u679C\u60A8\u786E\u5B9E\u9700\u8981\uFF0C\u8BF7\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF: $env:SYNC_RESOURCES_ALLOW_STALE="true"\u3002');
      throw new Error("Semester mismatch in manifest");
    } else {
      console.warn(`\u26A0\uFE0F \u8B66\u544A: \u73ED\u7EA7\u8BFE\u8868\u5B66\u671F [${manifest.semester}] \u4E0E\u914D\u7F6E\u7684 [${preferredSemester}] \u4E0D\u4E00\u81F4\uFF0C\u4F46\u5DF2\u8BBE\u7F6E SYNC_RESOURCES_ALLOW_STALE=true\uFF0C\u5C06\u7EE7\u7EED\u6267\u884C\u3002`);
    }
  }
  const crawledTime = new Date(manifest.crawledAt).getTime();
  const nowTime = Date.now();
  const diffHours = (nowTime - crawledTime) / (1e3 * 60 * 60);
  if (diffHours > 24) {
    console.warn(`\u26A0\uFE0F \u5F3A\u8B66\u544A: \u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u751F\u6210\u65F6\u95F4 [${manifest.crawledAt}] \u8DDD\u4ECA\u5DF2\u8D85\u8FC7 ${diffHours.toFixed(1)} \u5C0F\u65F6\uFF0C\u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u53EF\u80FD\u4E0D\u662F\u6700\u65B0\u6570\u636E\u3002`);
  }
  const requireFresh = getEnvFlag("SYNC_RESOURCES_REQUIRE_FRESH", false);
  if (requireFresh && diffHours > 6) {
    console.error(`\u274C \u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u5DF2\u8FC7\u671F\uFF01\u751F\u6210\u65F6\u95F4\u8DDD\u4ECA\u5DF2\u8D85\u8FC7 6 \u5C0F\u65F6 (${diffHours.toFixed(1)} \u5C0F\u65F6)\uFF0C\u4E14\u8BBE\u7F6E\u4E86 SYNC_RESOURCES_REQUIRE_FRESH=true\u3002`);
    throw new Error("Class schedules cache is stale (exceeded 6 hours)");
  }
  const { items: items2, filePath } = readClassSchedulesFromFile();
  let fileMtime = "\u672A\u77E5";
  try {
    const stat = fs.statSync(filePath);
    fileMtime = stat.mtime.toISOString();
  } catch (e2) {
  }
  console.log("\n=================== [sync:resources \u5F00\u59CB\u6D3E\u751F\u8D44\u6E90] ===================");
  console.log(`- \u5F53\u524D\u8BFB\u53D6\u7684 class-schedules-latest.json \u8DEF\u5F84: ${filePath}`);
  console.log(`- \u8BE5\u6587\u4EF6\u5B9E\u9645\u4FEE\u6539\u65F6\u95F4 (mtime): ${fileMtime}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u5B66\u671F (manifest semester): ${manifest.semester}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u751F\u6210\u65F6\u95F4 (manifest crawledAt): ${manifest.crawledAt}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF (classScheduleCount): ${manifest.classScheduleCount || items2.length}`);
  console.log("- \u8BF4\u660E\uFF1A\u6B64\u547D\u4EE4\u4E0D\u4F1A\u8BBF\u95EE\u6559\u52A1 100 \u7F51\uFF0C\u53EA\u4F1A\u57FA\u4E8E\u521A\u624D\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u6D3E\u751F\u6559\u5E08/\u6559\u5BA4/\u8BFE\u7A0B\u7EF4\u5EA6\u3002");
  console.log("===================================================================\n");
  const types = normalizeResourceTypeList(resourceTypes);
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course")
  };
  const semester2 = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const normalizedClassSchedules = items2.map((item) => normalizeScheduleEntryCourses(item, {
    semester: item.semester || semester2,
    sourceType: "class",
    audienceType: "student"
  }));
  const resources = buildSnapshotResources(normalizedClassSchedules, includeOptions);
  const resourcesPath = path.join(debugDir, "resources-latest.json");
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), "utf-8");
  const uploadResults = await uploadResourceSchedules(resources, types, semester2);
  types.forEach((type) => {
    const config = RESOURCE_SYNC_CONFIGS[type];
    fs.writeFileSync(
      path.join(debugDir, `${type}-schedules-latest.json`),
      JSON.stringify({
        resourceType: type,
        semester: semester2,
        items: resources[config.schedulesKey] || []
      }, null, 2),
      "utf-8"
    );
  });
  const report = {
    success: true,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceFile: filePath,
    resourceTypes: types,
    resourceRequestPolicy: getResourceDelayConfig(),
    flags: {
      SYNC_RESOURCES_TEACHERS: includeOptions.includeTeachers,
      SYNC_RESOURCES_CLASSROOMS: includeOptions.includeClassrooms,
      SYNC_RESOURCES_COURSES: includeOptions.includeCourses,
      SYNC_RESOURCE_LIMIT: parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT)
    },
    counts: {
      teachers: resources.teachers.length,
      classrooms: resources.classrooms.length,
      courses: resources.courses.length,
      teacherSchedules: resources.teacherSchedules.length,
      classroomSchedules: resources.classroomSchedules.length,
      courseSchedules: resources.courseSchedules.length
    },
    uploadResults
  };
  fs.writeFileSync(path.join(debugDir, "resources-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u8D44\u6E90\u7EF4\u5EA6\u6570\u636E\u5DF2\u751F\u6210: ${resourcesPath}`);
  console.log(`\u{1F4CA} resources counts: ${JSON.stringify(report.counts)}`);
  let resourcesChecksum = "";
  try {
    const fileContent = fs.readFileSync(resourcesPath, "utf-8");
    resourcesChecksum = crypto.createHash("md5").update(fileContent).digest("hex");
  } catch (e2) {
  }
  const resourcesManifest = {
    semester: semester2,
    generatedAt: report.generatedAt,
    source: path.basename(filePath),
    teacherScheduleCount: resources.teacherSchedules.length,
    classroomScheduleCount: resources.classroomSchedules.length,
    courseScheduleCount: resources.courseSchedules.length,
    checksum: resourcesChecksum
  };
  const resourcesManifestPath = path.join(debugDir, "resources-manifest.json");
  fs.writeFileSync(resourcesManifestPath, JSON.stringify(resourcesManifest, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u8D44\u6E90\u7EF4\u5EA6\u6E05\u5355\u5DF2\u4FDD\u5B58\u81F3: ${resourcesManifestPath}`);
  return resources;
}
async function initBrowserContext() {
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--no-proxy-server"
  ];
  let browser;
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false,
        // 设为 false 以确保与系统通道的最大兼容性，并且能够直观展示同步过程
        args: launchArgs
      };
      if (channel) {
        config.channel = channel;
        console.log(`\u5C1D\u8BD5\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u901A\u9053: ${channel} ...`);
      } else {
        console.log("\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668 ...");
      }
      browser = await chromium.launch(config);
      break;
    } catch (e2) {
      console.warn(`\u26A0\uFE0F \u6D4F\u89C8\u5668\u901A\u9053 ${channel || "\u5185\u7F6E"} \u542F\u52A8\u5931\u8D25: ${e2.message}`);
      if (channel === null) {
        console.error("\n\u{1F4A1} \u63D0\u793A: \u5982\u679C\u60A8\u60F3\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668\uFF0C\u8BF7\u5148\u8FD0\u884C\u4EE5\u4E0B\u547D\u4EE4\u5B89\u88C5\uFF1A");
        console.error("   npx playwright install chromium");
      }
    }
  }
  if (!browser) {
    console.error("\u274C \u65E0\u6CD5\u542F\u52A8\u4EFB\u4F55\u6D4F\u89C8\u5668\uFF01\u8BF7\u68C0\u67E5 Playwright \u5B89\u88C5\u662F\u5426\u5B8C\u6574\u3002");
    process.exit(1);
  }
  let context;
  if (FOSU_SYNC_AUTH_MODE === "playwright-manual") {
    if (!fs.existsSync(SESSION_PATH)) {
      console.error("\u274C \u672C\u5730\u672A\u627E\u5230 session.json \u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\uFF01");
      console.error(getExpiredSessionTip());
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      storageState: SESSION_PATH,
      ignoreHTTPSErrors: true
    });
  } else if (FOSU_SYNC_AUTH_MODE === "manual-cookie") {
    if (!process.env.FOSU_MANUAL_COOKIE) {
      console.error("\u274C \u9009\u62E9\u4E86 manual-cookie \u6A21\u5F0F\uFF0C\u4F46\u672A\u5728 .env \u4E2D\u914D\u7F6E FOSU_MANUAL_COOKIE\uFF01");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true
    });
    const cookies = parseCookieString(process.env.FOSU_MANUAL_COOKIE, FOSU_BASE_URL);
    await context.addCookies(cookies);
    console.log(`\u{1F511} \u5DF2\u4ECE .env \u4E2D\u6CE8\u5165 ${cookies.length} \u4E2A Cookie \u81F3\u6D4F\u89C8\u5668\u4F1A\u8BDD\u3002`);
  } else {
    console.error(`\u274C \u672A\u77E5\u7684\u767B\u5F55\u6A21\u5F0F: ${FOSU_SYNC_AUTH_MODE}`);
    await browser.close();
    process.exit(1);
  }
  return { browser, context };
}
function getExpiredSessionTip() {
  const invocationCwd = path.resolve(process.env.INIT_CWD || process.cwd());
  const isProjectRoot = invocationCwd === PROJECT_ROOT;
  const rootPackageJson = path.join(PROJECT_ROOT, "package.json");
  const hasRootLoginScript = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPackageJson, "utf-8"));
      return Boolean(pkg.scripts && pkg.scripts.login);
    } catch (error) {
      return false;
    }
  })();
  const lines = [
    "\u8BF7\u5728\u9879\u76EE\u6839\u76EE\u5F55\u6267\u884C npm run login\uFF0C\u767B\u5F55\u6210\u529F\u540E\u91CD\u65B0\u8FD0\u884C\u5F53\u524D\u540C\u6B65\u547D\u4EE4\u3002"
  ];
  if (!isProjectRoot) {
    lines.push("\u4F60\u53EF\u80FD\u4E0D\u5728\u9879\u76EE\u6839\u76EE\u5F55\uFF0C\u8BF7\u5148 cd \u5230 FosuClass \u6839\u76EE\u5F55\u3002");
  }
  if (!hasRootLoginScript) {
    lines.push("\u5F53\u524D\u6839\u76EE\u5F55 package.json \u672A\u68C0\u6D4B\u5230 login script\uFF0C\u8BF7\u8865\u5145\u540E\u518D\u91CD\u8BD5\u3002");
  }
  return lines.join("\n");
}
async function checkSession(page) {
  console.log("\u{1F512} \u6B63\u5728\u6821\u9A8C\u4F1A\u8BDD\u6709\u6548\u6027...");
  try {
    await gotoPage(page, "/framework/xsMain.jsp", { waitUntil: "networkidle" });
  } catch (error) {
    console.error(`\u274C \u5BFC\u822A\u81F3\u6559\u52A1\u9875\u5931\u8D25\uFF0C\u53EF\u80FD\u672A\u8FDE\u5185\u7F51\u6216\u63E1\u624B\u5F7B\u5E95\u5931\u8D25: ${error.message}`);
    console.error(getExpiredSessionTip());
    return false;
  }
  const currentUrl = page.url();
  if (currentUrl.includes("authserver.fosu.edu.cn") || currentUrl.includes("login")) {
    console.error("\u274C \u4F1A\u8BDD\u5DF2\u8FC7\u671F\u6216\u65E0\u6548\uFF01\u88AB\u91CD\u5B9A\u5411\u5230\u4E86\u767B\u5F55\u9875\u9762\u3002");
    console.error(getExpiredSessionTip());
    return false;
  }
  const content = await page.content();
  if (content.includes("\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1") || content.includes("\u5BC6\u7801\u767B\u5F55")) {
    console.error("\u274C \u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF01\u9875\u9762\u5305\u542B\u767B\u5F55\u6807\u8BC6\u3002");
    console.error(getExpiredSessionTip());
    return false;
  }
  console.log("\u{1F389} \u4F1A\u8BDD\u6709\u6548\uFF0C\u6559\u52A1\u7CFB\u7EDF\u4E3B\u9875\u52A0\u8F7D\u6B63\u5E38\u3002");
  return true;
}
function inferPreferredSemester() {
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 1 && month <= 8) {
    return `${year - 1}-${year}-2`;
  } else {
    return `${year}-${year}-1`;
  }
}
async function selectSemester(page, preferredSemester) {
  if (!preferredSemester) {
    return null;
  }
  console.log(`\u914D\u7F6E\u5B66\u671F\uFF1A${preferredSemester}`);
  const selectResult = await page.evaluate((prefSem) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (let sIdx = 0; sIdx < selects.length; sIdx++) {
      const sel = selects[sIdx];
      const name = sel.getAttribute("name") || "";
      const id = sel.getAttribute("id") || "";
      for (let oIdx = 0; oIdx < sel.options.length; oIdx++) {
        const opt = sel.options[oIdx];
        const val = opt.value || "";
        const txt = opt.textContent || "";
        if (val.includes(prefSem) || txt.includes(prefSem)) {
          return {
            selectIndex: sIdx,
            selectName: name,
            selectId: id,
            optionValue: val,
            optionText: txt.trim()
          };
        }
      }
    }
    return null;
  }, preferredSemester);
  if (!selectResult) {
    const allSemOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const debugInfo = [];
      selects.forEach((sel) => {
        const name = sel.getAttribute("name") || sel.getAttribute("id") || "unnamed";
        if (/xnxq/i.test(name)) {
          const opts = Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent.trim() }));
          debugInfo.push({ name, opts });
        }
      });
      return debugInfo;
    });
    console.error(`\u274C \u65E0\u6CD5\u5728\u6559\u52A1\u7CFB\u7EDF\u4E2D\u5339\u914D\u5230\u76EE\u6807\u5B66\u671F: ${preferredSemester}`);
    if (allSemOptions.length > 0) {
      console.error("\u6559\u52A1\u7CFB\u7EDF\u4E2D\u5B66\u671F\u4E0B\u62C9\u6846\u7684\u53EF\u9009\u503C\u5982\u4E0B\uFF1A");
      allSemOptions.forEach((sel) => {
        sel.opts.forEach((opt) => {
          console.error(`  - \u503C: ${opt.value}, \u6587\u672C: ${opt.text}`);
        });
      });
    }
    throw new Error(`\u672A\u627E\u5230\u5339\u914D\u7684\u5B66\u671F: ${preferredSemester}`);
  }
  let selector = "";
  if (selectResult.selectName) {
    selector = `select[name="${selectResult.selectName}"]`;
  } else if (selectResult.selectId) {
    selector = `select[id="${selectResult.selectId}"]`;
  } else {
    selector = `select:nth-of-type(${selectResult.selectIndex + 1})`;
  }
  console.log(`\u9875\u9762\u5339\u914D\u5B66\u671F\uFF1A${selectResult.optionText}`);
  await page.selectOption(selector, selectResult.optionValue);
  await page.waitForTimeout(1500);
  const finalValue = await page.$eval(selector, (el) => el.value);
  if (!finalValue.includes(preferredSemester)) {
    throw new Error(`\u9009\u62E9\u5B66\u671F\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u6700\u7EC8\u9009\u4E2D\u7684\u503C ${finalValue} \u4E0E\u671F\u671B\u503C ${preferredSemester} \u4E0D\u5339\u914D\uFF01`);
  }
  console.log(`\u6700\u7EC8\u4F7F\u7528\u5B66\u671F\uFF1A${preferredSemester}`);
  return {
    value: selectResult.optionValue,
    label: selectResult.optionText
  };
}
function getCollegeSlug(collegeName2) {
  const map = {
    "\u4EBA\u6587": "human",
    "\u4F20": "college",
    "\u52A8\u7269": "animal",
    "\u52A8\u79D1": "animal",
    "\u751F\u547D": "life",
    "\u5546": "business",
    "\u6CD5": "law",
    "\u533B": "medical",
    "\u5DE5": "engineering",
    "\u7406": "science",
    "\u6750\u6599": "materials",
    "\u7535\u4FE1": "telecom",
    "\u673A\u7535": "mechatronic",
    "\u8BA1\u7B97\u673A": "computer",
    "\u6570\u5B66": "math",
    "\u7269\u7406": "physics",
    "\u5316\u5B66": "chemistry",
    "\u73AF\u5883": "env",
    "\u571F\u6728": "civil",
    "\u98DF\u54C1": "food",
    "\u8BBE\u8BA1": "design",
    "\u827A\u672F": "art",
    "\u4F53\u80B2": "sports",
    "\u9A6C\u514B\u601D": "marx",
    "\u56FD\u9645": "intl",
    "\u7EE7\u6559": "continue"
  };
  let slug = "college";
  for (const [key, val] of Object.entries(map)) {
    if (collegeName2.includes(key)) {
      slug = val;
      break;
    }
  }
  return slug;
}
var savedSampleCount = 0;
function saveMajorResponseSample(rawText, meta2, parsedCount, emptyNameCount) {
  if (savedSampleCount >= 3) return;
  savedSampleCount++;
  const sampleDir = path.join(__dirname, ".debug", "major-response-samples");
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  const slug = getCollegeSlug(meta2.collegeName);
  const safeName = `${meta2.collegeCode}-${meta2.grade}-${slug}-college`;
  const rawPath = path.join(sampleDir, `${safeName}.raw.txt`);
  const metaPath = path.join(sampleDir, `${safeName}.meta.json`);
  let sanitizedRaw = rawText;
  sanitizedRaw = sanitizedRaw.replace(/JSESSIONID=[a-zA-Z0-9.\-_]+/gi, "JSESSIONID=REDACTED");
  sanitizedRaw = sanitizedRaw.replace(/cookie/gi, "REDACTED");
  fs.writeFileSync(rawPath, sanitizedRaw, "utf-8");
  const metaData = {
    collegeCode: meta2.collegeCode,
    collegeName: meta2.collegeName,
    grade: meta2.grade,
    semester: meta2.semester,
    requestUrl: meta2.requestUrl,
    method: meta2.method || "GET",
    status: meta2.status || 200,
    contentType: meta2.contentType || (rawText.trim().startsWith("<") ? "text/html" : "application/json"),
    rawLength: rawText.length,
    parsedCount,
    emptyNameCount
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u5DF2\u4FDD\u5B58\u539F\u59CB\u54CD\u5E94\u6837\u672C\u53CA\u5143\u6570\u636E\u81F3: ${rawPath}`);
}
function parseMajorOptionsFromResponse(raw, meta) {
  if (!raw) return [];
  const { collegeCode = "", collegeName = "", grade = "", semester = "", requestUrl = "" } = meta || {};
  const rawStr = String(raw).trim();
  const items = [];
  const formatItem = (codeVal, nameVal) => {
    const code = typeof codeVal === "string" ? codeVal.trim() : codeVal ? String(codeVal).trim() : "";
    const name = typeof nameVal === "string" ? nameVal.trim() : nameVal ? String(nameVal).trim() : "";
    if (!code && !name) return null;
    return {
      code,
      name,
      majorCode: code,
      majorName: name,
      rawLabel: name,
      collegeCode,
      collegeName,
      grade,
      semester
    };
  };
  try {
    let parsed = null;
    if (rawStr.startsWith("[") || rawStr.startsWith("{")) {
      parsed = JSON.parse(rawStr);
    } else {
      const jsonRegex = /\[\s*\{[\s\S]*\}\s*\]/;
      const match = rawStr.match(jsonRegex);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          try {
            parsed = eval(`(${match[0]})`);
          } catch (evalErr) {
          }
        }
      }
    }
    if (parsed) {
      const list = Array.isArray(parsed) ? parsed : parsed.rows || parsed.data || parsed.list || parsed.majors || parsed.items || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item) continue;
          const codeVal = item.majorCode || item.code || item.value || item.id || item.dm || item.DM || item.zyh || item.ZYH || item.bh || item.BH;
          const nameVal = item.majorName || item.name || item.label || item.text || item.mc || item.MC || item.zymc || item.ZYMC || item.dmmc || item.DMMC || item.title;
          const formatted = formatItem(codeVal, nameVal);
          if (formatted) items.push(formatted);
        }
      }
    }
  } catch (jsonErr) {
  }
  if (items.length === 0) {
    try {
      const $ = cheerio.load(rawStr, { decodeEntities: false });
      $("option").each((_, el) => {
        const val = $(el).val() || $(el).attr("value") || "";
        const text = $(el).text().trim();
        if (val) {
          const formatted = formatItem(val, text);
          if (formatted) items.push(formatted);
        }
      });
    } catch (htmlErr) {
    }
  }
  if (items.length === 0) {
    const optionRegex = /<option\s+[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match2;
    while ((match2 = optionRegex.exec(rawStr)) !== null) {
      const val = match2[1];
      const text = match2[2].replace(/<[^>]+>/g, "").trim();
      if (val) {
        const formatted = formatItem(val, text);
        if (formatted) items.push(formatted);
      }
    }
  }
  return items;
}
function normalizeMajorItem(item) {
  const majorCodeRaw = item.majorCode || item.code || item.value;
  const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;
  const majorName = typeof majorNameRaw === "string" ? majorNameRaw.trim() : majorNameRaw ? String(majorNameRaw).trim() : "";
  let majorCode = typeof majorCodeRaw === "string" ? majorCodeRaw.trim() : majorCodeRaw ? String(majorCodeRaw).trim() : "";
  if (!majorCode && !majorName) {
    return { status: "drop_empty", item };
  }
  if (!majorName) {
    return { status: "drop_empty", item };
  }
  const placeholders = ["\u8BF7\u9009\u62E9", "\u5168\u90E8", "\u5168\u90E8\u4E13\u4E1A", "--\u8BF7\u9009\u62E9--", "\u8BF7\u9009\u62E9\u4E13\u4E1A"];
  if (placeholders.includes(majorName)) {
    return { status: "drop_placeholder", item };
  }
  let generated = false;
  if (!majorCode) {
    majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
    generated = true;
  }
  return {
    status: "keep",
    generated,
    normalized: {
      code: majorCode,
      name: majorName,
      majorCode,
      majorName,
      collegeCode: item.collegeCode,
      grade: item.grade
    }
  };
}
function cleanMajorsPayload(rawItems) {
  const cleaned = [];
  const droppedEmpty = [];
  const droppedPlaceholder = [];
  let generatedCount = 0;
  for (const item of rawItems) {
    const res = normalizeMajorItem(item);
    if (res.status === "keep") {
      cleaned.push(res.normalized);
      if (res.generated) {
        generatedCount++;
      }
    } else if (res.status === "drop_empty") {
      droppedEmpty.push(res.item);
    } else if (res.status === "drop_placeholder") {
      droppedPlaceholder.push(res.item);
    }
  }
  return {
    cleaned,
    droppedEmpty,
    droppedPlaceholder,
    generatedCount
  };
}
async function syncCatalog(page) {
  console.log("\n=== [\u6B65\u9AA4 1] \u5F00\u59CB\u6293\u53D6 Catalog ===");
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  html = await page.content();
  $ = cheerio.load(html);
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });
  const matchedOption = semesters.find((s) => s.value === semResult.value) || semResult;
  const reorderedSemesters = [
    matchedOption,
    ...semesters.filter((s) => s.value !== matchedOption.value)
  ];
  const collegeMap = /* @__PURE__ */ new Map();
  function addCollegesFromSelect(selectHtml) {
    const $select = cheerio.load(selectHtml);
    $select("select[name='skyx'] option").each((_, el) => {
      const val = $select(el).attr("value");
      const text = $select(el).text().trim();
      if (val && !text.includes("\u8BF7\u9009\u62E9") && !text.includes("\u5168\u90E8")) {
        const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
        if (!collegeMap.has(val)) {
          collegeMap.set(val, { code: val, name: cleanName, rawLabel: text });
        }
      }
    });
  }
  addCollegesFromSelect(html);
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("\u9009\u62E9")) {
      grades.push(val);
    }
  });
  const extraPages = [
    { name: "\u6559\u5E08\u8BFE\u8868", path: "/kbcx/kbxx_teacher" },
    { name: "\u6559\u5BA4\u8BFE\u8868", path: "/kbcx/kbxx_classroom" },
    { name: "\u8BFE\u7A0B\u8BFE\u8868", path: "/kbcx/kbxx_kc" }
  ];
  for (const item of extraPages) {
    try {
      console.log(`   \u6B63\u5728\u8BBF\u95EE ${item.name} (${item.path}) \u8865\u5145\u9662\u7CFB\u9009\u9879...`);
      await gotoPage(page, item.path, { waitUntil: "networkidle" });
      const pageHtml = await page.content();
      addCollegesFromSelect(pageHtml);
    } catch (e2) {
      console.warn(`   \u26A0\uFE0F \u8865\u5145\u8BBF\u95EE ${item.name} \u5931\u8D25: ${e2.message} (\u5C06\u5FFD\u7565\u5E76\u7EE7\u7EED)`);
    }
  }
  const colleges = Array.from(collegeMap.values());
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    value: String(i + 1),
    label: `\u7B2C${i + 1}\u5468`
  }));
  const catalogPayload = {
    colleges,
    semesters: reorderedSemesters,
    grades,
    weeks,
    sections: []
  };
  console.log(`\u{1F4CA} \u6293\u53D6\u5B8C\u6BD5: \u5B66\u9662 ${colleges.length} \u4E2A, \u5B66\u671F ${reorderedSemesters.length} \u4E2A, \u5E74\u7EA7 ${grades.length} \u4E2A`);
  await uploadToVps("/api/admin/sync/catalog", catalogPayload);
  fs.writeFileSync(path.join(__dirname, "last-catalog.json"), JSON.stringify(catalogPayload, null, 2), "utf-8");
  console.log("\u{1F4BE} Catalog \u4E34\u65F6\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3\u672C\u5730 last-catalog.json");
  return catalogPayload;
}
function getActiveGradesBySemester(semester2, options = {}) {
  const { originalGrades = [], activeGradeCount = 5 } = options;
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || "active";
  const syncGradesEnv = process.env.SYNC_GRADES;
  const confirmFullSync = process.env.CONFIRM_FULL_SYNC === "true";
  const match2 = semester2.match(/^(\d{4})/);
  if (!match2) {
    throw new Error(`\u65E0\u6CD5\u4ECE\u5B66\u671F\u6807\u8BC6 "${semester2}" \u4E2D\u63D0\u53D6\u5B66\u5E74\u8D77\u59CB\u5E74\u4EFD\uFF0C\u8BF7\u68C0\u67E5\u5B66\u671F\u683C\u5F0F\u3002`);
  }
  const startYear = parseInt(match2[1], 10);
  let targetGrades = [];
  if (gradeRangeEnv === "active") {
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === "recent4") {
    for (let i = 3; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === "custom") {
    if (!syncGradesEnv) {
      throw new Error("\u68C0\u6D4B\u5230 SYNC_GRADE_RANGE=custom\uFF0C\u4F46\u672A\u8BBE\u7F6E SYNC_GRADES \u73AF\u5883\u53D8\u91CF\u3002");
    }
    targetGrades = syncGradesEnv.split(",").map((g) => g.trim()).filter(Boolean);
  } else if (gradeRangeEnv === "all") {
    if (!confirmFullSync) {
      console.error("\u274C \u68C0\u6D4B\u5230 SYNC_GRADE_RANGE=all\uFF0C\u4F46\u672A\u8BBE\u7F6E CONFIRM_FULL_SYNC=true\u3002\u4E3A\u907F\u514D\u540C\u6B65\u8FC7\u591A\u5386\u53F2\u5E74\u7EA7\uFF0C\u5DF2\u4E2D\u6B62\u3002");
      process.exit(1);
    }
    return originalGrades;
  } else {
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  }
  return originalGrades.filter((g) => targetGrades.includes(g));
}
async function syncMajors(page, catalog) {
  console.log("\n=== [\u6B65\u9AA4 2] \u5F00\u59CB\u6293\u53D6 Majors \u4E13\u4E1A\u8054\u52A8 ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Catalog \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:catalog");
      return;
    }
  }
  const { colleges, grades } = catalog;
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  const activeSemester = preferredSemester;
  const startYear = parseInt(activeSemester.match(/^(\d{4})/)?.[1] || "2025", 10);
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || "active";
  let filteredGrades = [];
  try {
    filteredGrades = getActiveGradesBySemester(activeSemester, { originalGrades: grades });
  } catch (err) {
    console.error(`\u274C \u5E74\u7EA7\u8FC7\u6EE4\u5931\u8D25: ${err.message}`);
    process.exit(1);
  }
  console.log(`\u5F53\u524D\u5B66\u671F\uFF1A${activeSemester}`);
  console.log(`\u5B66\u5E74\u8D77\u59CB\u5E74\u4EFD\uFF1A${startYear}`);
  console.log(`\u5E74\u7EA7\u8FC7\u6EE4\u6A21\u5F0F\uFF1A${gradeRangeEnv}`);
  console.log(`\u672C\u6B21\u540C\u6B65\u5E74\u7EA7\uFF1A${filteredGrades.join(", ")}`);
  console.log(`\u539F\u59CB\u5E74\u7EA7\u6570\u91CF\uFF1A${grades.length}`);
  console.log(`\u8FC7\u6EE4\u540E\u5E74\u7EA7\u6570\u91CF\uFF1A${filteredGrades.length}`);
  console.log(`\u672C\u6B21\u8054\u52A8\u8BF7\u6C42\u6570\uFF1A${colleges.length} \xD7 ${filteredGrades.length} = ${colleges.length * filteredGrades.length}`);
  const allMajors = [];
  let count = 0;
  for (const college of colleges) {
    for (const grade2 of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] \u6293\u53D6\u4E2D: ${college.name} - ${grade2}\u7EA7 ...`);
      let responseText = "";
      let success = false;
      let dropdownHtml = "";
      try {
        responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade: grade2 });
        success = true;
      } catch (ajaxErr) {
        console.warn(`      \u26A0\uFE0F  Ajax \u6293\u53D6\u4E13\u4E1A\u5931\u8D25 (${ajaxErr.message})\uFF0C\u5C1D\u8BD5\u4F7F\u7528 DOM \u8054\u52A8 Fallback...`);
      }
      let majors = [];
      if (success && responseText) {
        try {
          majors = parseMajorOptionsFromResponse(responseText, {
            collegeCode: college.code,
            collegeName: college.name,
            grade: grade2,
            semester: activeSemester,
            requestUrl: `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade2}`
          });
        } catch (e2) {
          console.warn(`      \u26A0\uFE0F  Ajax \u54CD\u5E94\u89E3\u6790\u5931\u8D25: ${e2.message}\uFF0C\u5C06\u5C1D\u8BD5 DOM Fallback...`);
          success = false;
        }
      }
      if (!success || majors.length === 0) {
        try {
          await page.selectOption("select[name='skyx']", college.code);
          await page.selectOption("select[name='sknj']", grade2);
          await page.waitForTimeout(800);
          dropdownHtml = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            return sel ? sel.outerHTML : "";
          });
          if (dropdownHtml) {
            majors = parseMajorOptionsFromResponse(dropdownHtml, {
              collegeCode: college.code,
              collegeName: college.name,
              grade: grade2,
              semester: activeSemester,
              requestUrl: "DOM_SELECT_skzy"
            });
          }
        } catch (domErr) {
          console.error(`      \u274C DOM \u8054\u52A8 Fallback \u4E5F\u5F7B\u5E95\u5931\u8D25: ${domErr.message}`);
        }
      }
      if (majors.length > 0) {
        const rawCount = majors.length;
        const emptyNameCount = majors.filter((m) => !String(m.name || m.majorName || m.rawLabel || "").trim()).length;
        const validCount = rawCount - emptyNameCount;
        console.log(`      \u539F\u59CB\u9009\u9879\u6570\uFF1A${rawCount}`);
        console.log(`      \u6709\u6548\u4E13\u4E1A\u6570\uFF1A${validCount}`);
        console.log(`      \u7A7A\u540D\u79F0\u6570\uFF1A${emptyNameCount}`);
        if (emptyNameCount === rawCount) {
          console.warn(`      \u26A0\uFE0F \u4E25\u91CD\u8B66\u544A\uFF1A\u672C\u6B21\u8054\u52A8\u53EA\u89E3\u6790\u5230\u4E13\u4E1A code\uFF0C\u6CA1\u6709\u89E3\u6790\u5230\u4E13\u4E1A\u540D\u79F0\uFF0C\u8BF7\u68C0\u67E5 parser \u6216 raw response \u6837\u672C\u3002`);
        }
        if (savedSampleCount < 3) {
          saveMajorResponseSample(
            responseText || dropdownHtml,
            {
              collegeCode: college.code,
              collegeName: college.name,
              grade: grade2,
              semester: activeSemester,
              requestUrl: responseText ? `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade2}` : "DOM_SELECT_skzy",
              method: responseText ? "GET" : "DOM_INTERACTION",
              status: 200,
              contentType: responseText ? responseText.trim().startsWith("<") ? "text/html" : "application/json" : "text/html"
            },
            rawCount,
            emptyNameCount
          );
        }
        allMajors.push(...majors);
      } else {
        console.log(`      \u6CA1\u6709\u4E13\u4E1A\u6570\u636E\u3002`);
      }
      await sleep(300);
    }
  }
  console.log(`\u{1F4CA} \u4E13\u4E1A\u8054\u52A8\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5171\u6574\u7406\u51FA ${allMajors.length} \u4E2A\u539F\u59CB\u4E13\u4E1A\u6570\u636E\u3002`);
  const { cleaned, droppedEmpty, droppedPlaceholder, generatedCount } = cleanMajorsPayload(allMajors);
  const sampleDroppedItems = [...droppedEmpty, ...droppedPlaceholder].slice(0, 10);
  console.log("\n\u{1F9F9} === [\u4E13\u4E1A\u6E05\u6D17\u6570\u636E\u7EDF\u8BA1] ===");
  console.log(`- rawMajorsCount: ${allMajors.length}`);
  console.log(`- cleanedMajorsCount: ${cleaned.length}`);
  console.log(`- droppedEmptyNameCount: ${droppedEmpty.length}`);
  console.log(`- droppedPlaceholderCount: ${droppedPlaceholder.length}`);
  console.log(`- generatedMajorCodeCount: ${generatedCount}`);
  console.log(`- sampleDroppedItems (\u524D 10 \u6761):`, JSON.stringify(sampleDroppedItems, null, 2));
  console.log("=============================\n");
  if (cleaned.length === 0) {
    console.error(`\u274C \u6CA1\u6709\u6709\u6548\u4E13\u4E1A\u6570\u636E\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002`);
    console.error(`\u8BF7\u68C0\u67E5\uFF1A`);
    console.error(`1. \u5F53\u524D\u5B66\u671F\u662F\u5426\u6B63\u786E\u3002`);
    console.error(`2. major-response-samples \u4E2D\u7684 raw \u54CD\u5E94\u683C\u5F0F\u3002`);
    console.error(`3. parseMajorOptionsFromResponse \u662F\u5426\u6B63\u786E\u89E3\u6790 option text / JSON name \u5B57\u6BB5\u3002`);
    throw new Error("\u6CA1\u6709\u6709\u6548\u4E13\u4E1A\u6570\u636E\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002");
  }
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  fs.writeFileSync(path.join(debugDir, "last-majors-raw.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(cleaned, null, 2), "utf-8");
  const payloadStr = JSON.stringify(cleaned);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  const collegeCodes = new Set(cleaned.map((m) => m.collegeCode));
  const majorGrades = new Set(cleaned.map((m) => m.grade));
  const collegeMajorCounts = {};
  cleaned.forEach((m) => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  const hasEmptyCollegeCode = cleaned.some((m) => !m.collegeCode);
  const hasEmptyMajorCode = cleaned.some((m) => !m.code);
  const seenKeys = /* @__PURE__ */ new Set();
  let hasDuplicateKey = false;
  for (const m of cleaned) {
    const key = `${m.collegeCode}_${m.grade}_${m.code}`;
    if (seenKeys.has(key)) {
      hasDuplicateKey = true;
      break;
    }
    seenKeys.add(key);
  }
  console.log("\n\u{1F4E6} === [\u4E0A\u4F20\u6458\u8981] ===");
  console.log(`- collegesCount: ${collegeCodes.size}`);
  console.log(`- gradesCount: ${majorGrades.size}`);
  console.log(`- majorsCount: ${cleaned.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u7A7A collegeCode: ${hasEmptyCollegeCode ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u7A7A majorCode: ${hasEmptyMajorCode ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u91CD\u590D key: ${hasDuplicateKey ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log("=====================\n");
  try {
    await uploadToVps("/api/admin/sync/majors", cleaned);
  } catch (err) {
    console.error(`\u274C Majors \u6570\u636E\u540C\u6B65\u81F3 VPS \u5931\u8D25\uFF01`);
    if (err.response) {
      console.error(`- status: ${err.response.status}`);
      console.error(`- response body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`- error message: ${err.message}`);
    }
    console.error(`- request payload size: ${payloadSizeKB} KB`);
    console.error(`- \u672C\u5730\u8C03\u8BD5\u6587\u4EF6\u8DEF\u5F84: ${debugUploadPath}`);
    throw err;
  }
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(cleaned, null, 2), "utf-8");
  console.log("\u{1F4BE} Majors \u4E34\u65F6\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3\u672C\u5730 last-majors.json");
  return cleaned;
}
async function getCurrentStudentClass(page) {
  console.log("\u{1F50D} \u6B63\u5728\u5B9A\u4F4D\u5F53\u524D\u767B\u5F55\u5B66\u751F\u7684\u73ED\u7EA7\u4FE1\u606F...");
  try {
    await gotoPage(page, "/xskb/xskb_list.do", { waitUntil: "networkidle" });
    const htmlText = await page.content();
    const $ = cheerio.load(htmlText);
    const bodyText = $("body").text();
    let className = "";
    const match2 = bodyText.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
    if (match2) {
      className = match2[1].trim();
      console.log(`\u{1F389} \u6210\u529F\u8BC6\u522B\u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7: ${className}`);
      return className;
    }
    $("td, th, span, div").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("\u73ED\u7EA7\uFF1A") || text.includes("\u884C\u653F\u73ED\u7EA7\uFF1A") || text.includes("\u73ED\u7EA7:")) {
        const m = text.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
        if (m) {
          className = m[1].trim();
        }
      }
    });
    if (className) {
      console.log(`\u{1F389} \u4ECE\u9875\u9762 DOM \u5339\u914D\u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7: ${className}`);
      return className;
    }
    console.warn("\u26A0\uFE0F \u4E2A\u4EBA\u8BFE\u8868\u9875\u9762\u4E2D\u672A\u63D0\u53D6\u5230\u660E\u786E\u73ED\u7EA7\u6587\u672C\u3002");
    return "";
  } catch (error) {
    console.error(`\u26A0\uFE0F \u6293\u53D6\u5F53\u524D\u5B66\u751F\u73ED\u7EA7\u51FA\u9519: ${error.message}`);
    return "";
  }
}
async function syncClassSchedules(page, catalog, majors) {
  console.log("\n=== [\u6B65\u9AA4 3] \u5F00\u59CB\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868 Class Schedules ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Catalog \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:catalog");
      return;
    }
  }
  if (!majors) {
    if (fs.existsSync(path.join(__dirname, "last-majors.json"))) {
      majors = JSON.parse(fs.readFileSync(path.join(__dirname, "last-majors.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Majors \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:majors");
      return;
    }
  }
  const debugDir = path.join(__dirname, ".debug");
  const rawPagesDir = path.join(debugDir, "raw-pages");
  if (!fs.existsSync(rawPagesDir)) {
    fs.mkdirSync(rawPagesDir, { recursive: true });
  }
  const activeSemester = catalog.semesters[0]?.value || "2025-2026-2";
  console.log(`\u{1F4C5} \u6293\u53D6\u5B66\u671F: ${activeSemester}`);
  const cliParams = global.CLI_PARAMS || {};
  const forceRefresh = Boolean(cliParams.forceRefresh || cliParams["force-refresh"]);
  const ignoreProgress = forceRefresh || Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]);
  const ignoreNoScheduleCache = forceRefresh || Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]);
  const clearProgress = Boolean(cliParams.clearProgress || cliParams["clear-progress"]);
  const clearNoScheduleCache = Boolean(cliParams.clearNoScheduleCache || cliParams["clear-no-schedule-cache"]);
  const PROGRESS_PATH = path.join(debugDir, "sync-progress.json");
  if ((clearProgress || forceRefresh) && fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
    console.log(`\u{1F9F9} \u5DF2\u6E05\u7406\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\u6587\u4EF6: ${PROGRESS_PATH}`);
  }
  let progress = { completed: [] };
  if (!ignoreProgress && fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      console.log(`\u2139\uFE0F \u52A0\u8F7D\u5230\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\uFF0C\u5DF2\u5B8C\u6210 ${progress.completed.length} \u4E2A\u4E13\u4E1A\u3002`);
    } catch (e2) {
      console.warn("\u26A0\uFE0F \u8BFB\u53D6\u65AD\u70B9\u8FDB\u5EA6\u5931\u8D25\uFF0C\u5C06\u5168\u65B0\u6293\u53D6");
    }
  } else if (ignoreProgress) {
    console.log("\u2139\uFE0F \u5DF2\u5FFD\u7565\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\u7F13\u5B58\uFF0C\u672C\u8F6E\u4F1A\u91CD\u65B0\u5224\u65AD\u76EE\u6807\u4E13\u4E1A\u3002");
  }
  const currentStudentClass = await getCurrentStudentClass(page);
  if (currentStudentClass) {
    console.log(`\u2139\uFE0F \u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7\u4EC5\u7528\u4E8E\u8BCA\u65AD\u53C2\u8003: ${currentStudentClass}`);
  }
  const collegeNameByCode = new Map((catalog.colleges || []).map((college) => [String(college.code), college.name]));
  const noScheduleCachePath = path.join(debugDir, "no-schedule-majors.json");
  const classNameCandidatesPath = path.join(debugDir, "class-name-candidates.json");
  let noScheduleMajors = readJsonArray(noScheduleCachePath);
  if ((clearNoScheduleCache || forceRefresh) && noScheduleMajors.length > 0) {
    const before = noScheduleMajors.length;
    noScheduleMajors = noScheduleMajors.filter((item) => item && item.semester !== activeSemester);
    writeJsonFile(noScheduleCachePath, noScheduleMajors);
    console.log(`\u{1F9F9} \u5DF2\u6E05\u7406\u672C\u5B66\u671F\u65E0\u6392\u8BFE\u7F13\u5B58: ${before - noScheduleMajors.length} \u6761 (${activeSemester})\u3002`);
  }
  let classNameCandidateRecords = readJsonArray(classNameCandidatesPath);
  const skipNoScheduleCache = getEnvFlag("SYNC_SKIP_NO_SCHEDULE_CACHE", true) && !ignoreNoScheduleCache;
  const recheckNoSchedule = getEnvFlag("SYNC_RECHECK_NO_SCHEDULE", false);
  const cachedNoScheduleKeys = new Set(
    skipNoScheduleCache && !recheckNoSchedule ? noScheduleMajors.filter((item) => item && item.semester === activeSemester).map((item) => getMajorIdentityKey({
      collegeCode: item.collegeCode,
      grade: item.grade,
      code: item.majorCode
    }, item.semester)) : []
  );
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map((c) => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map((g) => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const syncClassScope = global.CLI_PARAMS?.classScope || process.env.SYNC_CLASS_SCOPE || "";
  if (includeScopes.includes("classSchedules")) {
    if (!isFiltered && syncClassScope !== "all") {
      const errMsg = `\u274C \u8FD0\u884C\u7EC8\u6B62\uFF1A\u5F53\u524D includeScopes \u5305\u542B\u884C\u653F\u73ED\u8BFE\u8868\uFF0C\u4F46\u672A\u8BBE\u7F6E SYNC_CLASS_SCOPE=all \u6216 --class-scope=all\uFF0C\u4E14\u6CA1\u6709\u7CBE\u51C6\u8FC7\u6EE4\u6761\u4EF6\u3002\u8BF7\u4F7F\u7528\u540E\u53F0\u540C\u6B65\u4E2D\u5FC3\u751F\u6210\u7684\u5B8C\u6574\u547D\u4EE4\u3002`;
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }
  if (isFiltered) {
    console.log("\u2139\uFE0F \u8BFE\u8868\u540C\u6B65\u5DF2\u542F\u7528\u73AF\u5883\u53D8\u91CF\u9650\u5236\u8FC7\u6EE4\uFF1A");
    if (syncCollegeCodes) console.log(`   - \u5B66\u9662\u9650\u5236: ${syncCollegeCodes.join(", ")}`);
    if (syncGrades) console.log(`   - \u5E74\u7EA7\u9650\u5236: ${syncGrades.join(", ")}`);
    if (syncMajorCodes) console.log(`   - \u4E13\u4E1A\u4EE3\u7801\u9650\u5236: ${syncMajorCodes.join(", ")}`);
  } else {
    console.log("\u2139\uFE0F \u8BFE\u8868\u540C\u6B65\u672A\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF\u9650\u5236\u3002\u9ED8\u8BA4\u4EC5\u540C\u6B65\u5F53\u524D\u5B66\u5E74\u8D77\u6700\u8FD1 5 \u4E2A\u5728\u6821\u6D3B\u8DC3\u5E74\u7EA7\uFF0C\u5E76\u542F\u7528\u9650\u901F\u3002");
  }
  if (skipNoScheduleCache && !recheckNoSchedule) {
    console.log(`\u2139\uFE0F \u5DF2\u542F\u7528\u65E0\u6392\u8BFE\u7F13\u5B58\u8DF3\u8FC7\u7B56\u7565\uFF0C\u672C\u5B66\u671F\u7F13\u5B58\u547D\u4E2D\u5019\u9009 ${cachedNoScheduleKeys.size} \u4E2A\u3002`);
  } else if (recheckNoSchedule) {
    console.log("\u2139\uFE0F SYNC_RECHECK_NO_SCHEDULE=true\uFF0C\u5C06\u91CD\u65B0\u68C0\u67E5\u6B64\u524D\u786E\u8BA4\u65E0\u6392\u8BFE\u7684\u4E13\u4E1A\u3002");
  }
  const isFiveYearMajor = (name) => {
    const n = name || "";
    return n.includes("\u52A8\u7269\u533B\u5B66") || n.includes("\u5EFA\u7B51\u5B66") || n.includes("\u4E34\u5E8A\u533B\u5B66") || n.includes("\u533B\u5B66");
  };
  const targetMajors = majors.filter((major) => {
    if (syncCollegeCodes && !syncCollegeCodes.includes(major.collegeCode)) {
      return false;
    }
    if (syncGrades && !syncGrades.includes(major.grade)) {
      const includeFiveYear = getEnvFlag("SYNC_INCLUDE_FIVE_YEAR", true);
      const isFiveYear = isFiveYearMajor(major.name || major.majorName);
      if (includeFiveYear && isFiveYear && major.grade === "2021") {
      } else {
        return false;
      }
    }
    if (syncMajorCodes && !syncMajorCodes.includes(major.code)) {
      return false;
    }
    if (!isFiltered) {
      if (syncClassScope !== "all") {
        return false;
      }
      let activeGrades = [];
      try {
        activeGrades = getActiveGradesBySemester(activeSemester, { originalGrades: catalog.grades, activeGradeCount: 5 });
      } catch (e2) {
        const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
        for (let i = 4; i >= 0; i--) {
          activeGrades.push(String(currentYear - i));
        }
      }
      if (!activeGrades.includes(major.grade)) {
        return false;
      }
    }
    return true;
  });
  if (!isFiltered && syncClassScope !== "all") {
    console.log("\u26A0\uFE0F \u672A\u68C0\u6D4B\u5230\u7CBE\u51C6\u540C\u6B65\u73AF\u5883\u53D8\u91CF\u9650\u5236 (SYNC_CLASS_COLLEGE_CODES \u7B49)\uFF0C\u4E14\u672A\u663E\u5F0F\u8BBE\u7F6E SYNC_CLASS_SCOPE=all\u3002\u8DF3\u8FC7\u5168\u6821\u540C\u6B65\u3002");
  }
  console.log(`\u{1F3AF} \u5339\u914D\u7684\u76EE\u6807\u4E13\u4E1A\u603B\u8BA1: ${targetMajors.length} \u4E2A\u3002`);
  const effectiveTargetMajors = targetMajors.filter((major) => {
    if (!skipNoScheduleCache || recheckNoSchedule) {
      return true;
    }
    const key = getMajorIdentityKey(major, activeSemester);
    if (cachedNoScheduleKeys.has(key)) {
      console.log(`   \u8DF3\u8FC7\u5DF2\u786E\u8BA4\u65E0\u6392\u8BFE\u4E13\u4E1A: ${major.grade}\u7EA7 - ${major.name} (${major.code})`);
      return false;
    }
    return true;
  });
  if (effectiveTargetMajors.length !== targetMajors.length) {
    console.log(`\u23ED\uFE0F \u5DF2\u6309\u65E0\u6392\u8BFE\u7F13\u5B58\u8DF3\u8FC7 ${targetMajors.length - effectiveTargetMajors.length} \u4E2A\u4E13\u4E1A\uFF0C\u672C\u8F6E\u5B9E\u9645\u5F85\u5224\u65AD ${effectiveTargetMajors.length} \u4E2A\u3002`);
  }
  const pendingMajors = effectiveTargetMajors.filter((major) => !hasCompletedMajor(progress, major, activeSemester));
  const completedProgressCount = effectiveTargetMajors.length - pendingMajors.length;
  const skipNoScheduleCount = targetMajors.length - effectiveTargetMajors.length;
  let cachedClassSchedules = [];
  global.CLASS_SCHEDULE_CACHE_USAGE = {
    usedClassScheduleCache: false,
    cacheSource: null,
    cacheWarning: null
  };
  if (completedProgressCount > 0 || pendingMajors.length === 0) {
    const cache = readClassScheduleCacheForSemester(activeSemester);
    if (cache.items && cache.items.length > 0) {
      cachedClassSchedules = cache.items;
      global.CLASS_SCHEDULE_CACHE_USAGE = {
        usedClassScheduleCache: true,
        cacheSource: cache.filePath,
        cacheWarning: `\u672C\u8F6E\u6709 ${completedProgressCount} \u4E2A\u4E13\u4E1A\u88AB progress \u8DF3\u8FC7\uFF0C\u5DF2\u4ECE\u5386\u53F2 classSchedules \u7F13\u5B58\u6062\u590D ${cachedClassSchedules.length} \u6761\u8BFE\u8868\u3002`
      };
      console.log(`\u267B\uFE0F \u5DF2\u4ECE\u5386\u53F2\u7F13\u5B58\u6062\u590D ${cachedClassSchedules.length} \u6761 classSchedules: ${cache.filePath}`);
    } else if (completedProgressCount > 0) {
      const detail = cache.error ? ` (${cache.error.message})` : "";
      throw new Error(`\u672C\u5730\u8FDB\u5EA6\u7F13\u5B58\u4E0E\u7ED3\u679C\u7F13\u5B58\u4E0D\u4E00\u81F4\uFF1A${completedProgressCount} \u4E2A\u4E13\u4E1A\u5C06\u88AB progress \u8DF3\u8FC7\uFF0C\u4F46\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules${detail}\u3002\u8BF7\u4F7F\u7528 --force-refresh \u6216 --clear-progress \u91CD\u65B0\u6293\u53D6\u3002`);
    }
  }
  console.log(`\u{1F504} \u672C\u8F6E\u5F85\u540C\u6B65\u4E13\u4E1A: ${pendingMajors.length} \u4E2A\u3002`);
  if (pendingMajors.length === 0) {
    if (cachedClassSchedules.length > 0) {
      console.log("\u2139\uFE0F \u672C\u8F6E\u6CA1\u6709\u5F85\u6293\u53D6\u4E13\u4E1A\uFF0C\u76F4\u63A5\u4F7F\u7528\u5386\u53F2 classSchedules \u7F13\u5B58\u6784\u5EFA Staging\u3002");
      return cachedClassSchedules;
    }
    if (completedProgressCount > 0 && skipNoScheduleCount > 0) {
      throw new Error("\u672C\u5730\u8FDB\u5EA6\u7F13\u5B58\u4E0E\u7ED3\u679C\u7F13\u5B58\u4E0D\u4E00\u81F4\uFF1A\u6240\u6709\u4E13\u4E1A\u90FD\u88AB progress/no-schedule cache \u8DF3\u8FC7\uFF0C\u4F46\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules\u3002\u8BF7\u4F7F\u7528 --force-refresh \u6216 --clear-progress \u91CD\u65B0\u6293\u53D6\u3002");
    }
    throw new Error("\u672C\u8F6E\u5F85\u540C\u6B65\u4E13\u4E1A\u4E3A 0\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules\u3002\u8BF7\u4F7F\u7528 --force-refresh \u91CD\u65B0\u6293\u53D6\uFF0C\u6216\u68C0\u67E5 --grades/--college-codes/--major-codes \u8FC7\u6EE4\u6761\u4EF6\u3002");
  }
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let totalCoursesFetched = 0;
  let totalDedupledCount = 0;
  let totalGroupedCount = 0;
  let newNoScheduleCount = 0;
  let allClassSchedules = cachedClassSchedules.slice();
  let count = 0;
  for (const major of pendingMajors) {
    count++;
    console.log(`   [${count}/${pendingMajors.length}] \u6B63\u5728\u6293\u53D6: ${major.grade}\u7EA7 - ${major.name} \u4E13\u4E1A\u8BFE\u8868 ...`);
    try {
      const htmlText = await page.evaluate(async (params) => {
        const formBody = new URLSearchParams({
          xnxqh: params.semester,
          skyx: params.collegeCode,
          sknj: params.grade,
          skzy: params.majorCode,
          zc1: "",
          zc2: "",
          jc1: "",
          jc2: ""
        }).toString();
        const res = await fetch("/kbcx/kbxx_xzb_ifr", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: formBody
        });
        return res.text();
      }, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code
      });
      const rawHtmlPath = path.join(rawPagesDir, `class_${major.grade}_${major.code}.html`);
      fs.writeFileSync(rawHtmlPath, htmlText, "utf-8");
      const candidateResult = parser.extractClassNameCandidates(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      classNameCandidateRecords = upsertClassNameCandidateRecord(classNameCandidateRecords, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
        rawHtmlPath,
        classNames: candidateResult.classNames || [],
        candidates: (candidateResult.candidates || []).slice(0, 80),
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      writeJsonFile(classNameCandidatesPath, classNameCandidateRecords);
      console.log(`      \u73ED\u7EA7\u6587\u672C\u5019\u9009: ${(candidateResult.classNames || []).join(", ") || "\u672A\u53D1\u73B0"}`);
      const parsed2 = parser.parseClassScheduleIfrHtml(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      const courses = normalizer.normalizeCourseList(parsed2.courses || [], {
        semester: activeSemester,
        sourceType: "class",
        audienceType: "student"
      });
      totalCoursesFetched += courses.length;
      if (courses.length > 0) {
        const seenKeys = /* @__PURE__ */ new Set();
        const uniqueCourses = courses.filter((c) => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || "",
            c.teacherName || "",
            c.classroom || ""
          ].join("_");
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        const dedupedDiff = courses.length - uniqueCourses.length;
        totalDedupledCount += dedupedDiff;
        const groupMap = {};
        uniqueCourses.forEach((c) => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || ""
          ].join("_");
          groupMap[key] = (groupMap[key] || 0) + 1;
        });
        let groupedCoursesNum = 0;
        Object.keys(groupMap).forEach((key) => {
          if (groupMap[key] > 1) {
            groupedCoursesNum++;
          }
        });
        totalGroupedCount += groupedCoursesNum;
      }
      if (courses.length === 0) {
        newNoScheduleCount++;
        const noScheduleRecord = {
          semester: activeSemester,
          collegeCode: major.collegeCode,
          collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
          grade: major.grade,
          majorCode: major.code,
          majorName: major.name,
          checkedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        noScheduleMajors = upsertNoScheduleMajor(noScheduleMajors, noScheduleRecord);
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log(`      \u6CA1\u6709\u6392\u8BFE\u6570\u636E\uFF0C\u5DF2\u8BB0\u5F55\u5230 ${noScheduleCachePath}`);
        markCompletedMajor(progress, major, activeSemester);
        writeJsonFile(PROGRESS_PATH, progress);
        await waitBetweenClassSyncRequests(isFiltered);
        continue;
      }
      const beforeNoScheduleCount = noScheduleMajors.length;
      noScheduleMajors = removeNoScheduleMajor(noScheduleMajors, major, activeSemester);
      if (noScheduleMajors.length !== beforeNoScheduleCount) {
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log("      \u6B64\u524D\u65E0\u6392\u8BFE\u7F13\u5B58\u5DF2\u5931\u6548\uFF0C\u672C\u6B21\u6293\u5230\u8BFE\u7A0B\u5E76\u5DF2\u79FB\u9664\u7F13\u5B58\u8BB0\u5F55\u3002");
      }
      const classes = normalizer.buildClassScheduleEntries(courses, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      if (classes.length > 0) {
        const aggregateCount = classes.filter((item) => item.isAggregated).length;
        const classCount = classes.length - aggregateCount;
        console.log(`      \u6574\u7406\u8BFE\u8868\u6761\u76EE: \u884C\u653F\u73ED ${classCount} \u4E2A\uFF0C\u4E13\u4E1A\u805A\u5408 ${aggregateCount} \u4E2A (${classes.map((c) => c.className).join(", ")})`);
        allClassSchedules = mergeClassSchedules(allClassSchedules, classes);
      }
      markCompletedMajor(progress, major, activeSemester);
      writeJsonFile(PROGRESS_PATH, progress);
    } catch (err) {
      console.error(`      \u26A0\uFE0F  \u6293\u53D6\u5931\u8D25: ${err.message}`);
    }
    await waitBetweenClassSyncRequests(isFiltered);
  }
  console.log(`\u{1F4CA} \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5171\u6574\u7406\u51FA ${allClassSchedules.length} \u4E2A\u884C\u653F\u73ED\u7EA7\u7684\u8BFE\u8868\u3002`);
  if (allClassSchedules.length > 0) {
    const { latestPath } = saveFullClassSchedules(allClassSchedules, activeSemester);
    const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
    let checksum = "";
    try {
      const fileContent = fs.readFileSync(latestPath, "utf-8");
      checksum = crypto.createHash("md5").update(fileContent).digest("hex");
    } catch (e2) {
      console.warn(`\u26A0\uFE0F \u8BA1\u7B97 class-schedules-latest.json \u7684 checksum \u5931\u8D25: ${e2.message}`);
    }
    let syncClientVersion = "1.0.0";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
      syncClientVersion = pkg.version || "1.0.0";
    } catch (e2) {
    }
    const adminClassCount = allClassSchedules.filter(
      (item) => item.displayType === "class-schedule" && !item.isAggregated
    ).length;
    const majorAggregateCount = allClassSchedules.length - adminClassCount;
    const manifestData = {
      semester: activeSemester,
      grades: syncGrades || (catalog.grades || []),
      crawledAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: "100.fosu.edu.cn",
      classScheduleCount: allClassSchedules.length,
      adminClassCount,
      majorAggregateCount,
      checksum,
      syncClientVersion
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
    console.log(`\u{1F4BE} \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u5DF2\u4FDD\u5B58\u81F3: ${manifestPath}`);
    if (getEnvFlag("SYNC_CLASS_CRAWL_ONLY", false)) {
      console.log(`
\u{1F389} [Crawl Only] \u6293\u53D6\u5B8C\u6210\uFF01`);
      console.log(`\u{1F4C1} \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3: ${latestPath}`);
      console.log(`\u{1F4CA} \u5171\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF (itemCount): ${allClassSchedules.length} \u6761`);
      printPowerShellCommands();
      return allClassSchedules;
    }
    try {
      await uploadClassSchedulesInChunks(allClassSchedules, debugDir, latestPath, activeSemester);
      console.log(`\u2705 \u672C\u8F6E\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6570\u636E\u540C\u6B65\u5B8C\u6210\uFF01`);
    } catch (uploadError) {
      console.error(`\u274C \u540C\u6B65\u81F3 VPS \u5931\u8D25\uFF1A${uploadError.message}`);
      console.error(`\u26A0\uFE0F \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3 .debug/class-schedules-latest.json\uFF0C\u53EF\u7A0D\u540E\u6267\u884C upload-only \u7EE7\u7EED\u4E0A\u4F20\u3002`);
      printPowerShellCommands();
      throw uploadError;
    }
  } else {
    console.log("\u2139\uFE0F \u672C\u8F6E\u6CA1\u6709\u65B0\u6293\u53D6\u5230\u4EFB\u4F55\u73ED\u7EA7\u8BFE\u8868\uFF0C\u65E0\u9700\u4E0A\u4F20\u3002");
  }
  const finalAggregateCount = allClassSchedules.filter((item) => item.isAggregated).length;
  const finalClassCount = allClassSchedules.length - finalAggregateCount;
  const finalTotalSkipCount = skipNoScheduleCount + newNoScheduleCount;
  console.log("\n================ [\u540C\u6B65\u4EFB\u52A1\u603B\u7ED3\u62A5\u544A] ================");
  console.log(`- \u884C\u653F\u73ED\u6570\u91CF: ${finalClassCount} \u4E2A`);
  console.log(`- \u4E13\u4E1A\u5171\u4EAB\u8BFE\u8868\u6570\u91CF: ${finalAggregateCount} \u4E2A`);
  console.log(`- \u8BFE\u7A0B\u603B\u6570: ${totalCoursesFetched} \u95E8`);
  console.log(`- \u91CD\u590D\u8BFE\u7A0B\u53BB\u91CD\u6570\u91CF: ${totalDedupledCount} \u95E8`);
  console.log(`- \u5206\u7EC4\u8BFE\u7A0B\u6570\u91CF: ${totalGroupedCount} \u7EC4`);
  console.log(`- \u8DF3\u8FC7\u65E0\u8BFE\u8868\u4E13\u4E1A\u6570\u91CF: ${finalTotalSkipCount} \u4E2A (\u5176\u4E2D\u7F13\u5B58\u8DF3\u8FC7 ${skipNoScheduleCount}\uFF0C\u672C\u6B21\u65B0\u786E\u8BA4 ${newNoScheduleCount})`);
  console.log("==================================================\n");
  const allEffectiveTargetsDone = effectiveTargetMajors.every((major) => hasCompletedMajor(progress, major, activeSemester));
  if (allEffectiveTargetsDone) {
    try {
      fs.unlinkSync(PROGRESS_PATH);
      console.log("\u{1F389} \u6240\u6709\u76EE\u6807\u4E13\u4E1A\u5DF2\u540C\u6B65\u5B8C\u6210\uFF0C\u8FDB\u5EA6\u5DF2\u91CD\u7F6E\u3002");
    } catch (e2) {
    }
  }
  return allClassSchedules;
}
function runPreflight() {
  console.log("\n================ [Preflight \u9884\u68C0\u73AF\u5883\u914D\u7F6E] ================");
  console.log(`- .env path: ${envPath}`);
  console.log(`- FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
  console.log(`- PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "\u672A\u914D\u7F6E"}`);
  const syncClassGrades = process.env.SYNC_CLASS_GRADES || "\u672A\u914D\u7F6E";
  const syncGrades = process.env.SYNC_GRADES || "\u672A\u914D\u7F6E";
  console.log(`- SYNC_CLASS_GRADES (\u73ED\u7EA7\u8BFE\u8868\u540C\u6B65\u4F7F\u7528): ${syncClassGrades}`);
  console.log(`- SYNC_GRADES (\u4E13\u4E1A\u540C\u6B65\u4F7F\u7528): ${syncGrades}`);
  const tokenExists = Boolean(process.env.ADMIN_API_TOKEN);
  console.log(`- ADMIN_API_TOKEN: ${tokenExists ? "\u5DF2\u914D\u7F6E" : "\u274C \u672A\u914D\u7F6E\uFF01(\u53EF\u80FD\u4F1A\u5BFC\u81F4 VPS \u6821\u9A8C\u5931\u8D25)"}`);
  if (INITIAL_DETECTED_PROXIES.length > 0) {
    console.warn(`\u26A0\uFE0F \u68C0\u6D4B\u5230\u4EE3\u7406\u73AF\u5883\u53D8\u91CF:`);
    INITIAL_DETECTED_PROXIES.forEach(([name, value]) => {
      console.warn(`   - ${name}=${value}`);
      if (value.includes("127.0.0.1:10808") || value.includes("localhost:10808")) {
        console.warn("   \u26A0\uFE0F \u3010\u8B66\u544A\u3011\u68C0\u6D4B\u5230\u4EE3\u7406\u6307\u5411 127.0.0.1:10808\uFF0C\u53EF\u80FD\u662F v2rayN \u7CFB\u7EDF\u4EE3\u7406\u6B8B\u7559\uFF0C\u4F1A\u5BFC\u81F4\u4E0A\u4F20 VPS \u5931\u8D25\uFF01");
      }
    });
  } else {
    console.log("- \u4EE3\u7406\u73AF\u5883\u53D8\u91CF: \u672A\u68C0\u6D4B\u5230");
  }
  const disableProxy2 = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
  console.log(`- SYNC_DISABLE_PROXY: ${disableProxy2}`);
  if (disableProxy2) {
    console.log("\u2139\uFE0F \u5DF2\u542F\u7528\u5F3A\u5236\u7981\u7528\u4EE3\u7406\u914D\u7F6E\u3002\u6240\u6709\u4E0A\u4F20\u9636\u6BB5\u5C06\u5F3A\u5236\u4E0D\u4F7F\u7528\u4EE3\u7406\u3002");
  }
  console.log("========================================================\n");
}
function printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes) {
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const classScheduleCount = allClassSchedules ? allClassSchedules.length : 0;
  const adminClassCount = allClassSchedules ? allClassSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length : 0;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const teacherScheduleCount = resources && resources.teacherSchedules ? resources.teacherSchedules.length : 0;
  const classroomScheduleCount = resources && resources.classroomSchedules ? resources.classroomSchedules.length : 0;
  const courseScheduleCount = resources && resources.courseSchedules ? resources.courseSchedules.length : 0;
  const snapshotVersion = verifyRes?.status?.snapshotVersion || verifyRes?.releaseStatus?.activeReleaseVersion || "\u672A\u77E5";
  const bootstrapDataSource = verifyRes?.bootstrap?.dataSource || "\u672A\u77E5";
  const isActivated = verifyRes?.bootstrap?.success ? "\u5DF2\u6210\u529F\u53D1\u5E03\u5E76\u6FC0\u6D3B" : "\u274C \u672A\u786E\u8BA4\u6FC0\u6D3B\u6210\u529F";
  const clientDataVersion = verifyRes?.bootstrap?.version || verifyRes?.status?.snapshotVersion || "\u672A\u77E5";
  console.log("\n=================== [\u4E00\u952E\u540C\u6B65\u4EFB\u52A1\u603B\u7ED3\u62A5\u544A] ===================");
  console.log(`- \u5F53\u524D\u5B66\u671F (preferredSemester): ${preferredSemester}`);
  console.log(`- catalog \u5B66\u9662\u6570\u91CF: ${catalog && catalog.colleges ? catalog.colleges.length : 0} \u4E2A`);
  console.log(`- majors \u4E13\u4E1A\u6570\u91CF: ${majors ? majors.length : 0} \u4E2A`);
  console.log(`- classScheduleCount (\u73ED\u7EA7\u8BFE\u8868\u6570): ${classScheduleCount} \u6761`);
  console.log(`- adminClassCount (\u884C\u653F\u73ED\u6570\u91CF): ${adminClassCount} \u4E2A`);
  console.log(`- majorAggregateCount (\u4E13\u4E1A\u5171\u4EAB\u6570\u91CF): ${majorAggregateCount} \u4E2A`);
  console.log(`- teacherScheduleCount (\u6559\u5E08\u8BFE\u8868\u6570): ${teacherScheduleCount} \u6761`);
  console.log(`- classroomScheduleCount (\u6559\u5BA4\u8BFE\u8868\u6570): ${classroomScheduleCount} \u6761`);
  console.log(`- courseScheduleCount (\u8BFE\u7A0B\u8BFE\u8868\u6570): ${courseScheduleCount} \u6761`);
  console.log(`- snapshotVersion (\u7EBF\u4E0A\u5FEB\u7167\u7248\u672C): ${snapshotVersion}`);
  console.log(`- bootstrap dataSource (\u6700\u7EC8\u6570\u636E\u6E90): ${bootstrapDataSource}`);
  console.log(`- \u53D1\u5E03\u72B6\u6001: ${isActivated}`);
  console.log(`- \u5C0F\u7A0B\u5E8F\u5E94\u770B\u5230\u7684\u6570\u636E\u7248\u672C (clientDataVersion): ${clientDataVersion}`);
  console.log("============================================================\n");
}
async function handleFreshSync(page) {
  console.log("\n================ [\u5F00\u59CB\u6267\u884C\u4E00\u952E\u5B8C\u6574\u540C\u6B65 (sync:fresh)] ================");
  const catalog = await syncCatalog(page);
  const majors = await syncMajors(page, catalog);
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u4E00\u952E\u5B8C\u6574\u540C\u6B65\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u540C\u6B65\u4E2D\u65AD\uFF01");
  }
  console.log("\n[sync:fresh] \u6B63\u5728\u57FA\u4E8E\u65B0\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6D3E\u751F\u8D44\u6E90\u7EF4\u5EA6...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"]);
  console.log("\n[sync:fresh] \u6B63\u5728\u4EE5\u79BB\u7EBF\u53D1\u5E03\u6A21\u5F0F (SYNC_RELEASE_OFFLINE=true) \u751F\u6210\u53D1\u5E03\u5E76\u6FC0\u6D3B\u7EBF\u4E0A\u5FEB\u7167...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();
  console.log("\n[sync:fresh] \u540C\u6B65\u52A8\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u5F00\u59CB\u6821\u9A8C\u7EBF\u4E0A\u7AEF\u70B9...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`\u26A0\uFE0F \u6821\u9A8C\u7EBF\u4E0A\u63A5\u53E3\u51FA\u73B0\u5F02\u5E38: ${err.message}`);
  }
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}
async function handleQuickSync(page) {
  console.log("\n================ [\u5F00\u59CB\u6267\u884C\u4E00\u952E\u5FEB\u901F\u540C\u6B65 (sync:quick)] ================");
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath)) {
    throw new Error("\u6CA1\u6709\u627E\u5230\u672C\u5730 catalog \u6216 majors \u5386\u53F2\u7F13\u5B58\uFF01\u8BF7\u5148\u8FD0\u884C\u4E00\u6B21 npm run sync:fresh\u3002");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u5FEB\u901F\u540C\u6B65\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u540C\u6B65\u4E2D\u65AD\uFF01");
  }
  console.log("\n[sync:quick] \u6B63\u5728\u57FA\u4E8E\u65B0\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6D3E\u751F\u8D44\u6E90\u7EF4\u5EA6...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"]);
  console.log("\n[sync:quick] \u6B63\u5728\u4EE5\u79BB\u7EBF\u53D1\u5E03\u6A21\u5F0F (SYNC_RELEASE_OFFLINE=true) \u751F\u6210\u53D1\u5E03\u5E76\u6FC0\u6D3B\u7EBF\u4E0A\u5FEB\u7167...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();
  console.log("\n[sync:quick] \u540C\u6B65\u52A8\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u5F00\u59CB\u6821\u9A8C\u7EBF\u4E0A\u7AEF\u70B9...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`\u26A0\uFE0F \u6821\u9A8C\u7EBF\u4E0A\u63A5\u53E3\u51FA\u73B0\u5F02\u5E38: ${err.message}`);
  }
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}
async function main() {
  const args = process.argv.slice(2);
  let action = "all";
  const params = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const match2 = arg.match(/^--([^=]+)=(.*)$/);
      if (match2) {
        params[match2[1]] = match2[2];
      } else {
        const flagMatch = arg.match(/^--([^=]+)$/);
        if (flagMatch) {
          params[flagMatch[1]] = true;
        }
      }
    } else if (!arg.startsWith("-")) {
      action = arg;
    }
  }
  global.GENERATED_COMMAND = `node sync.js ${action} ${args.join(" ")}`;
  params.forceRefresh = Boolean(params["force-refresh"] || params.forceRefresh);
  params.ignoreProgress = Boolean(params["ignore-progress"] || params.ignoreProgress || params.forceRefresh);
  params.ignoreNoScheduleCache = Boolean(params["ignore-no-schedule-cache"] || params.ignoreNoScheduleCache || params.forceRefresh);
  params.clearProgress = Boolean(params["clear-progress"] || params.clearProgress);
  params.clearNoScheduleCache = Boolean(params["clear-no-schedule-cache"] || params.clearNoScheduleCache);
  params.classScope = params["class-scope"] || params.classScope || "";
  if (params.term) {
    process.env.PREFERRED_SEMESTER = params.term;
  }
  if (params.start) {
    process.env.SYNC_TERM_START_DATE = params.start;
  }
  if (params.include) {
    process.env.SYNC_INCLUDE_SCOPES = params.include;
  }
  if (params["class-scope"]) {
    process.env.SYNC_CLASS_SCOPE = params["class-scope"];
  }
  if (params.grades) {
    process.env.SYNC_CLASS_GRADES = params.grades;
    process.env.SYNC_GRADES = params.grades;
  }
  if (params["college-codes"]) {
    process.env.SYNC_CLASS_COLLEGE_CODES = params["college-codes"];
  }
  if (params["major-codes"]) {
    process.env.SYNC_CLASS_MAJOR_CODES = params["major-codes"];
  }
  if (params.concurrency) {
    process.env.SYNC_RESOURCE_MAX_CONCURRENCY = params.concurrency;
    process.env.SYNC_CLASS_MAX_CONCURRENCY = params.concurrency;
  }
  if (params["delay-ms"]) {
    process.env.SYNC_RESOURCE_REQUEST_DELAY_MS = params["delay-ms"];
    process.env.SYNC_CLASS_REQUEST_DELAY_MS = params["delay-ms"];
  }
  if (params.forceRefresh || params.ignoreNoScheduleCache) {
    process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "false";
  }
  if (params["crawl-only"]) {
    process.env.SYNC_CLASS_CRAWL_ONLY = "true";
  }
  if (params["upload-only"]) {
    process.env.SYNC_CLASS_UPLOAD_ONLY = "true";
  }
  if (params.verbose) {
    process.env.SYNC_VERBOSE = "true";
  }
  const includeStr = params.include || process.env.SYNC_INCLUDE_SCOPES || "";
  const includeScopes = includeStr ? includeStr.split(",").map((x) => x.trim()).filter(Boolean) : ALL_SCOPES;
  params.includeScopes = includeScopes;
  global.CLI_PARAMS = params;
  if (params["dry-run"] || params["dry_run"]) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }
  if (params.publish === "false" || params.publish === false) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }
  if (action === "fresh" || action === "quick" || action === "local-campus") {
    runPreflight();
  }
  const uploadOnlyMode = getEnvFlag("SYNC_CLASS_UPLOAD_ONLY", false);
  if (uploadOnlyMode || action === "upload-cache") {
    console.log("\u2139\uFE0F \u5C06\u76F4\u63A5\u6267\u884C\u672C\u5730\u8BFE\u8868\u7F13\u5B58\u4E0A\u4F20\uFF0C\u4E0D\u91CD\u65B0\u6253\u5F00\u6D4F\u89C8\u5668\u6293\u53D6\u3002");
    await handleUploadOnly();
    return;
  }
  if (action === "local-upload") {
    await handleLocalStagingUpload(params);
    return;
  }
  const offlineMode = getEnvFlag("SYNC_RELEASE_OFFLINE", false);
  if (action === "release" && offlineMode) {
    await handleOfflineRelease();
    return;
  }
  if (action === "resources") {
    await handleResourcesSync(["teacher", "classroom", "course"]);
    return;
  }
  if (action === "teachers" || action === "classrooms" || action === "courses") {
    const typeMap = {
      teachers: "teacher",
      classrooms: "classroom",
      courses: "course"
    };
    await handleResourcesSync([typeMap[action]]);
    return;
  }
  const isNetOk = await diagnose();
  if (!isNetOk) {
    if (action === "release") {
      console.warn("\u26A0\uFE0F \u672C\u5730\u7F51\u7EDC\u672A\u901A\u8FC7\u6821\u56ED\u7F51/VPN\u8BCA\u65AD\uFF01\u65E0\u6CD5\u5728\u7EBF\u6293\u53D6\u6570\u636E\u3002");
      console.log("\u{1F4A1} \u63D0\u793A: \u68C0\u6D4B\u5230\u5F53\u524D\u975E\u6821\u56ED\u7F51\u73AF\u5883\uFF0C\u4F60\u53EF\u4EE5\u4F7F\u7528\u79BB\u7EBF\u6A21\u5F0F\u76F4\u63A5\u6253\u5305\u672C\u5730\u5DF2\u6293\u53D6\u7684\u7F13\u5B58\u53D1\u5E03\u5FEB\u7167\uFF1A");
      console.log('   PowerShell \u547D\u4EE4: $env:SYNC_RELEASE_OFFLINE="true"; npm run sync:release');
    } else {
      console.error("\u274C \u672C\u5730\u7F51\u7EDC\u672A\u901A\u8FC7\u6821\u56ED\u7F51/VPN\u8BCA\u65AD\uFF0C\u4E2D\u6B62\u540C\u6B65\u4EFB\u52A1\uFF01");
      printPowerShellCommands();
    }
    process.exit(1);
  }
  const { browser, context } = await initBrowserContext();
  const page = await context.newPage();
  try {
    const isSessionOk = await checkSession(page);
    if (!isSessionOk) {
      process.exit(1);
    }
    let catalog, majors;
    if (action === "catalog") {
      await syncCatalog(page);
    } else if (action === "majors") {
      await syncMajors(page);
    } else if (action === "class") {
      await syncClassSchedules(page);
    } else if (action === "fresh") {
      await handleFreshSync(page);
    } else if (action === "quick") {
      await handleQuickSync(page);
    } else if (action === "local-campus") {
      await handleLocalCampusStaging(page, params);
    } else if (action === "release") {
      if (!process.env.SYNC_CLASS_GRADES) {
        process.env.SYNC_CLASS_GRADES = "2025,2024,2023,2022";
      }
      if (process.env.SYNC_INCLUDE_FIVE_YEAR === void 0) {
        process.env.SYNC_INCLUDE_FIVE_YEAR = "true";
      }
      if (process.env.SYNC_SKIP_NO_SCHEDULE_CACHE === void 0) {
        process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "true";
      }
      if (process.env.SYNC_RECHECK_NO_SCHEDULE === void 0) {
        process.env.SYNC_RECHECK_NO_SCHEDULE = "false";
      }
      if (process.env.SYNC_CLASS_SCOPE === void 0) {
        process.env.SYNC_CLASS_SCOPE = "all";
      }
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      process.env.SYNC_CLASS_CRAWL_ONLY = "true";
      const allClassSchedules = await syncClassSchedules(page, catalog, majors);
      if (!allClassSchedules || allClassSchedules.length === 0) {
        throw new Error("\u6CA1\u6709\u6293\u53D6\u5230\u4EFB\u4F55\u73ED\u7EA7\u8BFE\u8868\uFF0C\u5FEB\u7167\u53D1\u5E03\u4E2D\u65AD");
      }
      const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
      const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
        resources: {
          includeTeachers: includeReleaseResources,
          includeClassrooms: includeReleaseResources,
          includeCourses: includeReleaseResources
        }
      });
      const zlib = require("zlib");
      const snapshotJson = JSON.stringify(snapshot, null, 2);
      const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
      const compressedBuffer = zlib.gzipSync(snapshotBuffer);
      const debugDir = path.join(__dirname, ".debug");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
      console.log(`
\u{1F4BE} \u672C\u5730\u5FEB\u7167\u5DF2\u751F\u6210\u5E76\u538B\u7F29\uFF1A.debug/snapshot-latest.json \u548C .debug/snapshot-latest.json.gz (\u4F53\u79EF: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
      validateLocalReleaseSnapshot(snapshot);
      if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
        printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
        const report2 = {
          success: true,
          dryRun: true,
          version: snapshot.version,
          semester: snapshot.semester,
          updatedAt: snapshot.updatedAt,
          coverage: snapshot.coverage,
          normalizeReport,
          uploadSize: compressedBuffer.length
        };
        fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report2, null, 2), "utf-8");
        console.log("\u2139\uFE0F SYNC_RELEASE_DRY_RUN=true\uFF0C\u5DF2\u5B8C\u6210\u672C\u5730 release \u6784\u5EFA\u4E0E\u6821\u9A8C\uFF0C\u672A\u4E0A\u4F20\u6216\u6FC0\u6D3B VPS\u3002");
        return;
      }
      const uploadRes = await uploadSnapshot(compressedBuffer);
      const activateRes = await activateSnapshot(snapshot.version);
      console.log(`\u2705 \u5FEB\u7167\u6FC0\u6D3B\u6210\u529F! \u54CD\u5E94: ${JSON.stringify(activateRes)}`);
      const verifyRes = await verifyEndpoints();
      printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
      const report = {
        success: true,
        version: snapshot.version,
        semester: snapshot.semester,
        updatedAt: snapshot.updatedAt,
        coverage: snapshot.coverage,
        normalizeReport,
        uploadSize: compressedBuffer.length,
        serverStatus: verifyRes
      };
      fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
      console.log(`\u{1F4BE} \u603B\u7ED3\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/sync-report-latest.json`);
      console.log("\n\u{1F389} [Release] \u5168\u6821\u8BFE\u8868\u66B4\u529B\u5FEB\u7167\u53D1\u5E03\u6210\u529F\uFF01");
    } else if (action === "all") {
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      await syncClassSchedules(page, catalog, majors);
      console.log("\n\u{1F389} [\u540C\u6B65\u5927\u6210\u529F] \u672C\u5730\u6240\u6709\u6570\u636E\u5DF2\u5168\u91CF\u540C\u6B65\u81F3 VPS\uFF01");
    } else {
      console.error(`\u274C \u672A\u77E5\u7684\u540C\u6B65\u53C2\u6570: ${action}`);
      console.log("\u652F\u6301\u7684\u53C2\u6570: catalog | majors | class | resources | local-campus | local-upload | release | fresh | quick | all");
    }
  } catch (error) {
    console.error(`\u274C \u6267\u884C\u540C\u6B65\u65F6\u53D1\u751F\u81F4\u547D\u5F02\u5E38: ${error.message}`);
    console.error(error.stack);
    printPowerShellCommands();
  } finally {
    await browser.close();
    console.log("\u6D4F\u89C8\u5668\u5DF2\u5B89\u5168\u5173\u95ED\u3002\u540C\u6B65\u4EFB\u52A1\u7ED3\u675F\u3002");
  }
}
if (require.main === module) {
  main();
} else {
  module.exports = {
    selectSemester,
    getCollegeSlug,
    saveMajorResponseSample,
    parseMajorOptionsFromResponse,
    cleanMajorsPayload,
    normalizeMajorItem
  };
}
