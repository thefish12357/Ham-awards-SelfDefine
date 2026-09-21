/**
 * ADIF 解析
 * ------------------------------------------------------------------
 * 原来只在 server.js 里有一个一次性整串解析的 `parseAdif`。LoTW 直连方案需要
 * **边下载边解析**，否则一份几十万条的日志会整份驻留内存。因此这里提供：
 *   - `parseAdifRecord(part)`  解析单条记录（原逻辑，逐字符对齐）
 *   - `parseAdif(text)`        整串解析（保持向后兼容，给 /api/logbook/upload 用）
 *   - `createAdifStreamParser()` 流式解析器：按 <EOR> 切块，**解析完即丢弃原文**
 */

/** 字段匹配：<TAG:len[:type]>value */
const FIELD_RE = /<([a-zA-Z0-9_]+):(\d+)(?::[a-zA-Z])?>([^<]*)/g;

/**
 * 解析单条 ADIF 记录（不含 <EOR>）。
 * 没有 CALL 或 QSO_DATE 的片段视为无效，返回 null。
 */
export function parseAdifRecord(part) {
  const record = {};
  FIELD_RE.lastIndex = 0;
  let match;
  while ((match = FIELD_RE.exec(part)) !== null) {
    const field = match[1].toLowerCase();
    const length = parseInt(match[2], 10);
    record[field] = match[3].substring(0, length).trim();
  }
  if (record.call && record.qso_date) return record;
  return null;
}

/** 整串解析（与上游行为一致） */
export function parseAdif(adifString) {
  const records = [];
  for (const part of String(adifString).split(/<eor>/i)) {
    if (!part.trim()) continue;
    const record = parseAdifRecord(part);
    if (record) records.push(record);
  }
  return records;
}

/**
 * 流式解析器。
 *
 * 用法：
 *   const parser = createAdifStreamParser({ onRecord: (rec) => collector.push(rec) });
 *   parser.push(textChunk);   // 反复调用
 *   parser.finish();          // 收尾，处理最后一段（无 <EOR> 的残块也会尝试解析）
 *
 * 注意：内部只保留「尚未遇到 <EOR> 的尾巴」，因此内存占用与单条记录同量级，
 * 与整份日志大小无关。
 */
export function createAdifStreamParser({ onRecord, maxRecords = 0 } = {}) {
  let buffer = '';
  let count = 0;
  let stopped = false;

  const emit = (part) => {
    if (!part.trim()) return;
    const record = parseAdifRecord(part);
    if (!record) return;
    count += 1;
    if (typeof onRecord === 'function') onRecord(record);
    if (maxRecords > 0 && count >= maxRecords) stopped = true;
  };

  return {
    push(text) {
      if (stopped || !text) return;
      buffer += text;
      // 最后一段可能是被切断的记录，留到下一次 push
      const parts = buffer.split(/<eor>/i);
      buffer = parts.pop();
      for (const part of parts) {
        emit(part);
        if (stopped) break;
      }
      if (stopped) buffer = '';
    },
    finish() {
      if (!stopped && buffer.trim()) emit(buffer);
      stopped = true;
      buffer = '';
      return count;
    },
    get recordCount() {
      return count;
    },
    get stopped() {
      return stopped;
    },
  };
}

/** 是否包含 ADIF 头结束标记（LoTW 失败时会返回 HTML 页面，用这个判定） */
export const hasAdifHeaderEnd = (text) => /<eoh>/i.test(text);

/** 是否是 HTML（LoTW 出错时返回的说明页） */
export const looksLikeHtml = (text) => /^\s*(<!doctype\s+html|<html[\s>])/i.test(text);
