import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * 带「显示 / 隐藏」切换的密码输入框
 * ------------------------------------------------------------------
 * 用途：登录、注册、以及用户中心的改密码表单，让用户能确认自己输入的内容。
 *
 * 同时把 autoComplete 显式声明出来——浏览器靠它判断这是「当前密码」还是「新密码」，
 * 不写会触发控制台警告，Chrome 的自动填充下拉也可能挡住按钮。
 *
 * 注意：`pr-11` 是给右侧按钮预留空间，传入的 className 里不要再覆盖 padding-right。
 */
export default function PasswordInput({
  name,
  required = false,
  className = '',
  placeholder,
  autoComplete = 'current-password',
  autoFocus = false,
  value,
  onChange,
  ...rest
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        name={name}
        type={visible ? 'text' : 'password'}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`${className} pr-11`}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        title={visible ? '隐藏密码' : '显示密码'}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
