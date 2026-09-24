import React from 'react';
import { DATE_MIN, todayStr, validateDateInput } from '../lib/dateInput.js';

/**
 * 统一日期输入框（2026-09-24）
 * ------------------------------------------------------------------
 * 直接用 `<input type="date">` 的坑：原生**年份段允许超过 4 位**（Chrome 上限 275760），
 * 用户能输「111111-11-11」，而各处下游要么静默丢值、要么字符串比较出错（见 dateInput.js 注释）。
 *
 * 这里做三件事，保证以后没有人会再漏：
 *   1. 强制带 `min` / `max`（浏览器会直接把年份卡在 4 位，日历也禁用越界日期）；
 *   2. 值不合法时**立刻在下方给出中文原因**（而不是等提交失败）；
 *   3. 统一 `onChange(value)` 签名（不是原生事件），调用点更简洁。
 *
 * 用法：
 *   <DateInput label="通联日期" required value={form.date} onChange={(v) => setForm({ ...form, date: v })} className="..." />
 *
 * ⚠️ `max` 默认是**今天**：实物材料 / QSO / LoTW 日志都是已经发生的事。
 *    允许"计划到未来"的场景（奖状规则有效期）必须显式传 `max={DATE_FAR_MAX}`。
 */
export default function DateInput({
  value,
  onChange,
  label = '日期',
  min = DATE_MIN,
  max = todayStr(),
  required = false,
  showError = true,
  className = '',
  ...rest
}) {
  const error = validateDateInput(value, label, { min, max, required });
  return (
    <>
      <input
        type="date"
        value={value || ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        {...rest}
      />
      {showError && error ? (
        <span className="mt-1 block text-[11px] font-bold text-red-500">{error}</span>
      ) : null}
    </>
  );
}
