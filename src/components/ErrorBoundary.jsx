import React from 'react';

/**
 * 全局错误边界（2026-09-30）
 * ------------------------------------------------------------------
 * 背景：React 18 里**渲染期抛出的异常会卸载整棵树** —— 页面直接变成纯白，
 * 用户既看不到原因、也没有任何恢复入口（2026-09-30 反馈「远端打开主站白屏」时，
 * 我们无法从页面上得到任何线索，只能本地复现排查）。
 *
 * 这里兜住渲染异常：显示可读摘要 + 「重新加载」+ 「复制错误详情」（方便反馈给我们）。
 * 于是偶发崩溃从「白屏」降级为「一次可自愈的小事故」。
 *
 * ⚠️ 只兜**渲染期**异常；事件回调 / 异步里的错误不会触发错误边界（那些不会让整树卸载，
 *    本来就不会白屏）。样式刻意用内联，避免 CSS/主题本身出问题时连错误页都渲染不出来。
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null, stack: '' };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // 控制台留全量信息，便于用 Playwright / DevTools 排查
        console.error('[ErrorBoundary] 渲染异常:', error, info?.componentStack);
        this.setState({ stack: String(info?.componentStack || '') });
    }

    copyDetail = () => {
        const { error, stack } = this.state;
        const text = [
            `URL: ${window.location.href}`,
            `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            `错误: ${error?.message || error}`,
            stack ? `组件栈:${stack}` : '',
            error?.stack ? `调用栈:\n${error.stack}` : '',
        ].filter(Boolean).join('\n');
        try {
            navigator.clipboard.writeText(text);
            alert('错误详情已复制，可直接粘贴反馈给我们');
        } catch {
            alert(text);
        }
    };

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div
                style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0A0A0B',
                    color: '#e2e8f0',
                    padding: 24,
                    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
                }}
            >
                <div
                    style={{
                        maxWidth: 560,
                        width: '100%',
                        border: '1px solid rgba(255,255,255,0.10)',
                        background: '#141416',
                        borderRadius: 16,
                        padding: 24,
                    }}
                >
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#fca5a5' }}>页面出错了</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7, color: '#94a3b8' }}>
                        页面渲染时发生异常，已停止渲染以免继续出错。多数情况刷新一次即可恢复；
                        若反复出现，请把下面的错误详情反馈给管理员。
                    </div>
                    <pre
                        style={{
                            marginTop: 12,
                            maxHeight: 160,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            background: '#0A0A0B',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 10,
                            padding: 12,
                            fontSize: 12,
                            color: '#fca5a5',
                        }}
                    >
                        {String(error?.message || error)}
                    </pre>
                    <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            style={{
                                background: '#e2e8f0',
                                color: '#0A0A0B',
                                border: 'none',
                                borderRadius: 10,
                                padding: '10px 18px',
                                fontWeight: 800,
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            重新加载
                        </button>
                        <button
                            type="button"
                            onClick={this.copyDetail}
                            style={{
                                background: 'transparent',
                                color: '#cbd5e1',
                                border: '1px solid rgba(255,255,255,0.18)',
                                borderRadius: 10,
                                padding: '10px 18px',
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            复制错误详情
                        </button>
                        <button
                            type="button"
                            onClick={() => { window.location.href = '/#/dashboard'; window.location.reload(); }}
                            style={{
                                background: 'transparent',
                                color: '#cbd5e1',
                                border: '1px solid rgba(255,255,255,0.18)',
                                borderRadius: 10,
                                padding: '10px 18px',
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            回到概览页
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
