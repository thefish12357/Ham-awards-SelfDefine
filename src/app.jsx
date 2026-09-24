import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Award, Database, LogOut, CheckCircle, 
  Shield, Download, Settings, Server, Lock, QrCode, 
  User, Trash2, RotateCcw, Save, Menu, Globe, Key,
  FilePlus, Move, Check, X, AlertCircle, Edit, List,
  Layout, Eye, Play, CornerDownRight, BarChart, Plus,
  Search, ShieldCheck, UserPlus, Info, ExternalLink, Image as ImageIcon,
  Users, Activity, Radio, FileText, HardDrive, Clock, FileWarning,
  Target, Calculator, Filter, Layers, Trophy, Crop, ZoomIn, ZoomOut, Grid, ChevronDown, ChevronRight, Bell,
  Loader2, Monitor, Sun, Moon, AlertTriangle, FolderOpen
} from 'lucide-react';

// ================= 公共模块 =================
// 统一请求封装（原 apiFetch 定义就在这里）与 Hash 路由已抽到独立模块，
// 行为与原先保持一致，新功能请直接从这里 import，不要再写一份。
import { apiFetch } from './lib/apiFetch.js';
// 统一确认弹层（替代原生 confirm/prompt，防手滑删除/提交）
import { confirmDialog, promptDialog, infoDialog } from './lib/confirm.jsx';
import { DEFAULT_ROUTE, isPublicHashRoute, isRouteAllowed, parseVerifyHash, readPublicPage, readRoute, writeRoute } from './lib/routes.js';
import LotwImportView from './pages/LotwImportView.jsx';
import VerifyView from './pages/VerifyView.jsx';
import EvidenceAuditView from './pages/EvidenceAuditView.jsx';
import AuditLogsView from './pages/AuditLogsView.jsx';
import LandingView from './pages/LandingView.jsx';
import AboutView from './pages/AboutView.jsx';
import PrivacyView from './pages/PrivacyView.jsx';
import TermsView from './pages/TermsView.jsx';
import ProtocolView from './pages/ProtocolView.jsx';
import { normalizeLayout, presetAwardLayout } from './lib/awardLayout.js';
// 实物材料的收集要素类型（QSL 卡 / Eyeball 卡 / SWL 收听报告）
import { EVIDENCE_TYPES, evidenceType, evidenceTypeLabel, TZ_OPTIONS, tzOffsetOf, toUtcDateTime } from './lib/evidenceTypes.js';
import { collectExternalImages, toSameOriginMediaUrl } from './lib/media.js';
import VisualDesigner from './components/VisualDesigner.jsx';
import InviteCodePanel from './components/InviteCodePanel.jsx';
import { AwardThumbnail, ResponsiveAwardRenderer } from './components/AwardRenderer.jsx';
import PasswordInput from './components/PasswordInput.jsx';
// 注意：PDF 导出（jsPDF + html-to-image，约 440 KB）改为**点击时动态 import**，
// 否则首屏包会从 ~266 KB 涨到 ~705 KB。见 handleExportPdf。

// ================= Helper Utils =================
// Determine text color (black/white) based on hex background
const getContrastColor = (hexColor) => {
    if (!hexColor) return '#000000';
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
};

/**
 * 导出 PDF 后提示"有哪些图片没加载出来"。
 * 必须提示：否则用户以为导出成功，实际拿到的是一张缺图的奖状。
 * 常见原因：设计时贴了外部链接（图床 / 网盘），跨域或已失效。
 */
const warnBrokenImages = (failedImages) => {
    if (!failedImages || !failedImages.length) return;
    const shown = failedImages.slice(0, 3).join('\n');
    const more = failedImages.length > 3 ? `\n…另有 ${failedImages.length - 3} 张` : '';
    alert(
        `PDF 已生成，但有 ${failedImages.length} 张图片没能加载，因此不会出现在奖状上：\n\n${shown}${more}\n\n` +
        '外部链接的图片（图床、网盘等）无法保证长期可用，建议在设计器里重新上传到本站。',
    );
};

// ================= Components =================

// --- Merged InstallView Component ---
function InstallView({ onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    dbHost: 'localhost',
    dbPort: '5432',
    dbUser: '',
    dbPass: '',
    dbName: 'ham_awards',
    adminCall: '',
    adminPass: '',
    adminPath: 'admin',
    minioEndpoint: '',
    minioPort: '9000',
    minioAccessKey: '',
    minioSecretKey: '',
    minioBucket: 'ham-awards', // 默认 Bucket 名称
    useHttps: false
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          minio: config.minioEndpoint ? {
            endPoint: config.minioEndpoint,
            port: parseInt(config.minioPort),
            useSSL: config.useHttps,
            accessKey: config.minioAccessKey,
            secretKey: config.minioSecretKey
          } : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '安装失败');
      alert('安装成功！Bucket ' + config.minioBucket + ' 已初始化。页面将刷新。');
      onComplete();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden">
        <div className="bg-slate-900 p-8 text-white">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Server className="text-blue-500" /> 系统初始化
          </h1>
          <p className="text-slate-400 text-sm mt-2">HAM AWARDS SYSTEM Setup Wizard</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8">
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="font-bold text-lg flex items-center gap-2"><Database className="text-blue-600"/> 数据库配置 (PostgreSQL)</h3>
              <div className="grid grid-cols-2 gap-4">
                <input name="dbHost" value={config.dbHost} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="Host" />
                <input name="dbPort" value={config.dbPort} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="Port" />
                <input name="dbUser" value={config.dbUser} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="User" />
                <input name="dbPass" type="password" value={config.dbPass} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="Password" />
                <input name="dbName" value={config.dbName} onChange={handleChange} required className="col-span-2 w-full border rounded-lg p-3" placeholder="Database Name" />
              </div>
              <button type="button" onClick={() => setStep(2)} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold">下一步</button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h3 className="font-bold text-lg flex items-center gap-2"><HardDrive className="text-orange-600"/> 存储配置 (MinIO)</h3>
              <div className="p-4 bg-orange-50 text-orange-800 rounded-lg text-sm mb-4">
                MinIO 用于存储奖状背景图。系统将自动尝试创建指定的 Bucket。
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input name="minioEndpoint" value={config.minioEndpoint} onChange={handleChange} className="col-span-2 w-full border rounded-lg p-3" placeholder="Endpoint (e.g. localhost)" />
                <input name="minioAccessKey" value={config.minioAccessKey} onChange={handleChange} className="w-full border rounded-lg p-3" placeholder="Access Key" />
                <input name="minioSecretKey" type="password" value={config.minioSecretKey} onChange={handleChange} className="w-full border rounded-lg p-3" placeholder="Secret Key" />
                <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Bucket Name (将自动创建)</label>
                    <input name="minioBucket" value={config.minioBucket} onChange={handleChange} className="w-full border rounded-lg p-3" placeholder="e.g. ham-awards" />
                </div>
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(1)} className="flex-1 bg-slate-100 font-bold rounded-xl">上一步</button>
                <button type="button" onClick={() => setStep(3)} className="flex-1 bg-slate-900 text-white py-4 rounded-xl font-bold">下一步</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h3 className="font-bold text-lg flex items-center gap-2"><Shield className="text-red-600"/> 管理员与安全</h3>
              <div className="space-y-4">
                <input name="adminCall" value={config.adminCall} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="管理员呼号" />
                <input name="adminPass" type="password" value={config.adminPass} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="管理员密码" />
                <input name="adminPath" value={config.adminPath} onChange={handleChange} required className="w-full border rounded-lg p-3" placeholder="自定义管理路径 (默认: admin)" />
                
                <label className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl cursor-pointer">
                  <input type="checkbox" name="useHttps" checked={config.useHttps} onChange={handleChange} className="w-5 h-5 accent-blue-600" />
                  <span className="font-bold text-blue-800">启用 HTTPS (影响生成链接)</span>
                </label>
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(2)} className="flex-1 bg-slate-100 font-bold rounded-xl">上一步</button>
                <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-bold">
                  {loading ? '安装中...' : '完成配置'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// 0. Dashboard View (Updated)
const DashboardView = ({ user }) => {
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [ctyStats, setCtyStats] = useState(null);
    const [ctyLoading, setCtyLoading] = useState(false);
    const [ctyMsg, setCtyMsg] = useState('');

    useEffect(() => {
        apiFetch('/stats/dashboard')
            .then(setStats)
            .catch(err => {
                console.error(err);
                if (err.status !== 401) {
                   setError(err.message || "无法加载统计数据");
                }
            });
    }, []);

    // 管理员：拉取 DXCC 前缀库（cty.dat）当前解析统计
    useEffect(() => {
        if (user.role !== 'admin') return;
        apiFetch('/admin/cty/stats')
            .then(setCtyStats)
            .catch(err => console.error('cty stats', err));
    }, []);

    // 管理员：从 country-files.com 拉取最新 cty.dat 并热加载（无需重启）
    const refreshCty = async () => {
        if (ctyLoading) return;
        setCtyLoading(true);
        setCtyMsg('');
        try {
            const r = await apiFetch('/admin/cty/refresh', { method: 'POST' });
            setCtyStats(r.stats);
            setCtyMsg(r.updated ? '✅ 已更新到最新版' : 'ℹ️ 已是最新，无需更新');
        } catch (e) {
            setCtyMsg('❌ 更新失败：' + (e.message || '网络错误'));
        } finally {
            setCtyLoading(false);
        }
    };

    if (error) return <div className="p-8 text-center text-red-500 bg-red-50 rounded-lg border border-red-200 m-8">❌ 统计数据加载失败: {error}</div>;

    if (!stats) return (
        <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            加载统计数据中...
        </div>
    );

    // Helper Card Component
    const StatCard = ({ title, value, icon: Icon, color, sub }) => (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
                <div className="text-slate-500 text-xs font-bold uppercase mb-2 whitespace-nowrap">{title}</div>
                <div className="text-3xl font-black text-slate-800">{value}</div>
                {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
            </div>
            {Icon && <div className={`shrink-0 p-3.5 rounded-full ${color || 'bg-blue-50 text-blue-600'}`}><Icon size={22} /></div>}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-slate-900 text-white rounded-lg"><Activity size={20}/></div>
                <h2 className="text-2xl font-bold">概览仪表盘</h2>
            </div>

            {/* 普通用户视图 */}
            {user.role === 'user' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="日志总数 (QSO)" value={stats.qsos} icon={Database} color="bg-blue-100 text-blue-700" />
                    <StatCard title="通联波段" value={stats.bands} icon={Radio} color="bg-indigo-100 text-indigo-700" />
                    <StatCard title="通联模式" value={stats.modes} icon={Activity} color="bg-purple-100 text-purple-700" />
                    <StatCard title="DXCC 实体 (Unique)" value={stats.dxccs} icon={Globe} color="bg-green-100 text-green-700" />
                    <div className="col-span-full md:col-span-2">
                        <StatCard title="已获奖状" value={stats.my_awards} icon={Award} color="bg-yellow-100 text-yellow-700" />
                    </div>
                </div>
            )}

            {/* 奖状制作视图 - 显示自己的数据（admin 同样可以建奖状发起审核） */}
            {(user.role === 'award_admin' || user.role === 'admin') && (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard title="我的发布" value={stats.my_approved} icon={CheckCircle} color="bg-green-100 text-green-700" sub="已通过审核" />
                    <StatCard title="审核中" value={stats.my_pending} icon={Clock} color="bg-blue-100 text-blue-700" sub="等待管理员操作" />
                    <StatCard title="我的草稿" value={stats.my_drafts} icon={FileText} color="bg-slate-100 text-slate-700" sub="未提交" />
                    <StatCard title="被打回" value={stats.my_returned} icon={FileWarning} color="bg-red-100 text-red-700" sub="需修改后重交" />
                </div>
            )}

            {/* 系统管理员视图 - 显示全局数据 */}
            {user.role === 'admin' && (
                <div className="space-y-8">
                    {/* 第一排：系统状态与人员 */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                         {/* ⚠️ 不要用 `bg-slate-900 text-white` 做「大块卡片」：深色主题会把它映射成
                             实色青底（那是给**按钮**用的强调色），整块高饱和青底在近黑面板群里很突兀。
                             大卡片统一用「面板 + 细边框」（与 StatCard 同款），强调色只留给小图标与状态点。 */}
                         <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                             <div className="text-slate-500 text-xs font-bold uppercase mb-2 whitespace-nowrap">系统状态</div>
                             <div className="text-2xl font-black text-slate-800 flex items-center gap-2">
                                 <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span> 运行正常
                             </div>
                         </div>
                         <StatCard title="在线用户" value={stats.online_users?.reduce((a,b)=>a+parseInt(b.count),0) || 0} icon={Activity} color="bg-green-100 text-green-700" sub={stats.online_users?.map(u => `${u.role}: ${u.count}`).join(', ')} />
                         <StatCard title="注册用户总数" value={stats.total_users?.find(u=>u.role==='user')?.count || 0} icon={Users} color="bg-blue-100 text-blue-700" />
                         <StatCard title="奖状管理员" value={stats.total_users?.find(u=>u.role==='award_admin')?.count || 0} icon={Shield} color="bg-purple-100 text-purple-700" />
                    </div>

                    {/* 第二排：奖状数据 */}
                    <div>
                        <h3 className="font-bold text-lg mb-4 text-slate-600">奖状系统数据</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <StatCard title="已发布奖状" value={stats.awards_approved} icon={Award} color="bg-green-100 text-green-700" />
                            <StatCard title="待审核奖状" value={stats.awards_pending} icon={AlertCircle} color="bg-orange-100 text-orange-700" sub="需立即处理" />
                            <StatCard title="已颁发奖状总次" value={stats.awards_issued || 0} icon={Trophy} color="bg-yellow-100 text-yellow-700" />
                        </div>
                    </div>

                    {/* 第三排：数据维护 */}
                    <div>
                        <h3 className="font-bold text-lg mb-4 text-slate-600">数据维护</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div className="text-slate-500 text-xs font-bold uppercase whitespace-nowrap">DXCC 前缀库 (cty.dat)</div>
                                    <button
                                        onClick={refreshCty}
                                        disabled={ctyLoading}
                                        className="shrink-0 px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                                    >
                                        {ctyLoading ? '更新中…' : '更新 DXCC 库'}
                                    </button>
                                </div>
                                <div className="text-sm text-slate-600 space-y-1">
                                    {ctyStats ? (
                                        <div>实体 {ctyStats.entities} · 前缀 {ctyStats.prefixes} · 已映射 DXCC {ctyStats.dxccMapped}</div>
                                    ) : (
                                        <div className="text-slate-400">加载中…</div>
                                    )}
                                    <div className="text-xs text-slate-400">来源：country-files.com（FLDigi/WSJT-X/JTDX 共用）</div>
                                    {ctyMsg && <div className="text-xs text-slate-500">{ctyMsg}</div>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Log Matrix Component (Updated for dynamic columns based on deduplication)
const LogMatchMatrix = ({ qsos, award, checkResult }) => {
    // 2. 包含特定判定项收集的奖项，日志比对详情显示参考附件中图片所示
    const rules = award.rules || {};
    const hasSpecificTargets = rules.targets?.type && ['callsign', 'dxcc', 'grid', 'iota', 'state'].includes(rules.targets.type) && rules.targets.list;

    // View 1: Specific Target List View (The new requirement)
    if (hasSpecificTargets && checkResult?.breakdown) {
        const { breakdown } = checkResult;
        
        // We need to know the LABEL of the target type
        const targetLabel = rules.targets.type.toUpperCase();
        
        const missingItems = breakdown.missing.map(m => ({ target: m, qso: null }));
        
        // Merge
        const allItems = [...breakdown.achieved, ...missingItems];
        // Sort by target name
        allItems.sort((a,b) => a.target.localeCompare(b.target));

        return (
            <div className="overflow-auto border rounded-xl shadow-sm max-h-[60vh] relative">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-20 shadow-sm">
                        <tr className="bg-slate-100 text-slate-600 font-bold border-b-2 border-slate-200">
                            <th className="p-3 text-left w-1/3 border-r bg-slate-100">{targetLabel}</th>
                            <th className="p-3 text-left bg-slate-100">Confirmed QSO</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allItems.map((item, idx) => {
                            const isAchieved = !!item.qso;
                            return (
                                <tr key={idx} className={`border-b ${isAchieved ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <td className={`p-3 font-mono font-bold border-r ${isAchieved ? 'text-green-800' : 'text-red-800'}`}>
                                        {item.target}
                                    </td>
                                    <td className="p-3">
                                        {isAchieved ? (
                                            <div className="text-blue-600 font-bold underline cursor-pointer hover:text-blue-800">
                                                {item.qso.call} <span className="text-xs text-slate-500 no-underline font-normal ml-2">({item.qso.band} / {item.qso.mode})</span>
                                            </div>
                                        ) : (
                                            <span className="text-red-400 italic">Not Confirmed</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    // View 2: Standard Band/Mode Matrix (Fallback for general awards)
    // 6. 用户的奖项日志匹配详情的波段模式表头按照波长顺序排列，从左到右从长到短
    if (!qsos || qsos.length === 0) return <div className="p-4 text-center text-slate-400">暂无匹配日志</div>;

    // Define Wavelength Sort Order
    const bandOrder = ['160M', '80M', '60M', '40M', '30M', '20M', '17M', '15M', '12M', '10M', '6M', '4M', '2M', '70CM', '23CM'];
    const getBandIndex = (b) => {
        const idx = bandOrder.indexOf(b?.toUpperCase());
        return idx === -1 ? 999 : idx;
    };

    const bands = Array.from(new Set(qsos.map(q => q.band))).sort((a,b) => getBandIndex(a) - getBandIndex(b));
    
    // Row Logic
    let getRowKey = (q) => q.call; // Default
    let rowLabel = "Callsign";
    
    // Even if not "Specific Targets List", we might group by Entity if logic implies
    if (rules.targets?.type === 'dxcc') { getRowKey = (q) => q.dxcc || q.country; rowLabel = "DXCC"; }
    else if (rules.targets?.type === 'grid') { getRowKey = (q) => (q.grid || '').substring(0,4); rowLabel = "Grid"; }
    else if (rules.targets?.type === 'state') { getRowKey = (q) => q.state; rowLabel = "State"; }
    
    const rowKeys = Array.from(new Set(qsos.map(q => getRowKey(q)))).sort();
    const modes = ['CW', 'PHONE', 'DIGI'];

    const getModeCat = (m) => {
        if (!m) return 'DIGI';
        m = m.toUpperCase();
        if (['CW'].includes(m)) return 'CW';
        if (['SSB', 'AM', 'FM', 'USB', 'LSB'].includes(m)) return 'PHONE';
        return 'DIGI';
    };

    // Build Map: RowKey -> Band -> Mode -> Count
    const dataMap = {};
    qsos.forEach(q => {
        const rKey = getRowKey(q);
        if (!rKey) return;
        if (!dataMap[rKey]) dataMap[rKey] = {};
        if (!dataMap[rKey][q.band]) dataMap[rKey][q.band] = { CW:0, PHONE:0, DIGI:0 };
        dataMap[rKey][q.band][getModeCat(q.mode)]++;
    });

    return (
        <div className="overflow-auto border rounded-xl shadow-sm max-h-[60vh] relative">
            <table className="w-full text-xs text-center border-collapse">
                <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                    <tr className="bg-slate-100 text-slate-600">
                        <th rowSpan="2" className="p-2 border sticky left-0 top-0 z-30 bg-slate-100 w-24 text-left shadow-r">{rowLabel}</th>
                        {bands.map(b => (
                            <th key={b} colSpan="3" className="p-2 border font-bold bg-slate-50">{b}</th>
                        ))}
                    </tr>
                    <tr className="bg-slate-50 text-slate-500 text-[10px]">
                        {bands.map(b => (
                            <React.Fragment key={b}>
                                <th className="border p-1 w-8">CW</th>
                                <th className="border p-1 w-8">SSB</th>
                                <th className="border p-1 w-8">DIGI</th>
                            </React.Fragment>
                        ))}
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {rowKeys.map(rKey => (
                        <tr key={rKey} className="hover:bg-blue-50">
                            <td className="p-2 border font-mono font-bold sticky left-0 bg-white hover:bg-blue-50 z-10 text-left border-r shadow-sm">{rKey}</td>
                            {bands.map(b => (
                                <React.Fragment key={b}>
                                    {modes.map(m => {
                                        const count = dataMap[rKey]?.[b]?.[m] || 0;
                                        return (
                                            <td key={m} className={`border p-1 ${count > 0 ? 'bg-green-100 text-green-700 font-bold' : 'text-slate-200'}`}>
                                                {count > 0 ? count : '-'}
                                            </td>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

/** 组装奖状渲染/导出所需的动态字段（卡片展示与 PDF 导出共用，避免两处不一致） */
const buildAwardRenderData = (ua, callsign) => ({
    callsign: callsign || '',
    awardName: ua.name || '',
    level: ua.level || '',
    serial: ua.serial_number || '',
    issueDate: ua.issued_at ? new Date(ua.issued_at).toLocaleDateString('zh-CN') : '',
    score: ua.score_snapshot ?? '',
    issuer: ua.tracking_id || '',
    verifyUrl: `${window.location.origin}/#/verify/${ua.serial_number || ''}`,
    description: ua.description || '',
});

// New: My Awards View (Visual Gallery with Colored Badges)
const MyAwardsView = ({ user }) => {
    const [awards, setAwards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAward, setSelectedAward] = useState(null); // For detail view
    const [exportingId, setExportingId] = useState(null);

    // 用奖状的可视化布局导出 300 DPI 的 PDF（M3）
    const handleExportPdf = async (ua) => {
        // 已下架记录：award 与 layout 都已随奖状删除，导出必然是缺图的空证书
        if (ua?.detached) return;
        setExportingId(ua.id);
        try {
            // 动态加载：PDF 相关依赖较大，不让它进首屏包
            const { downloadAwardPdf } = await import('./lib/exportAwardPdf.js');
            const { failedImages } = await downloadAwardPdf({
                layout: normalizeLayout(ua.layout, ua.bg_url),
                data: buildAwardRenderData(ua, user.callsign),
                filename: `${ua.name || 'award'}-${ua.serial_number || 'noserial'}.pdf`,
            });
            warnBrokenImages(failedImages);
        } catch (e) {
            alert(e.message || '导出失败');
        } finally {
            setExportingId(null);
        }
    };

    useEffect(() => {
        apiFetch('/user/my-awards')
            .then(setAwards)
            .catch(console.error)
            .finally(()=>setLoading(false));
    }, []);

    if (loading) return <div className="text-center p-8 text-slate-400">加载中...</div>;

    if (awards.length === 0) return (
        <div className="text-center p-16 bg-white rounded-2xl border border-dashed">
            <Trophy size={48} className="mx-auto text-slate-300 mb-4"/>
            <h3 className="text-lg font-bold text-slate-600">您还没有获得任何奖状</h3>
            <p className="text-slate-400 text-sm mt-2">快去上传日志并前往奖状大厅申领吧！</p>
        </div>
    );

    const getLevelColor = (ua) => {
        // Try to find the color definition in rules
        if (ua.rules && ua.rules.thresholds) {
            const t = ua.rules.thresholds.find(th => th.name === ua.level);
            if (t && t.color) return t.color;
        }
        return '#eab308'; // Default yellow-500
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold flex items-center gap-2"><Award className="text-orange-500"/> 我的荣誉墙 (My Awards)</h3>
                {awards.some(a => a.detached) && (
                    <p className="mt-1 text-xs text-slate-400">
                        其中 {awards.filter(a => a.detached).length} 张已由主办方下架（仅作历史留存，不能再导出 PDF）。
                    </p>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                {awards.map(ua => {
                    const badgeColor = getLevelColor(ua);
                    const textColor = getContrastColor(badgeColor);
                    const renderData = buildAwardRenderData(ua, user.callsign);
                    const layout = normalizeLayout(ua.layout, ua.bg_url);
                    const hasLayout = layout.elements.length > 0;
                    return (
                        <div
                            key={ua.id}
                            className="relative group perspective cursor-pointer"
                            onClick={() => {
                                // 已下架记录的 award_id 为空，直接进详情弹层会去请求 /awards/null/check，
                                // 所以这里只弹一句说明，不做进度/预览。
                                if (ua.detached) {
                                    infoDialog({
                                        title: '奖状已下架',
                                        message: `「${ua.name || '该奖状'}」已由主办方删除，此证书不再有效。`,
                                        detail: `等级：${ua.level || '—'}\n序列号：${ua.serial_number || '—'}\n颁发时间：${ua.issued_at ? new Date(ua.issued_at).toLocaleString() : '—'}\n\n记录会作为历史留存显示在荣誉墙里，但不能再导出 PDF。`,
                                    });
                                    return;
                                }
                                setSelectedAward(ua);
                            }}
                        >
                            {/* 证书本体：有可视化布局就按布局渲染（与导出的 PDF 一致），否则退回旧的叠字卡片 */}
                            <div className={`bg-white rounded-xl shadow-xl overflow-hidden aspect-[1.414/1] relative ${ua.detached ? 'border-4 border-slate-300' : 'border-4 border-slate-900'}`}>
                                {ua.detached ? (
                                    /* 已下架：奖状设计已随奖状一起删除，渲染不出证书 —— 给一个明确的历史记录占位，
                                       而不是留一张空白/缺图的卡片让人以为加载失败 */
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-slate-100 px-4 text-center text-slate-500">
                                        <AlertTriangle size={26} className="text-amber-600" />
                                        <div className="text-sm font-bold text-slate-700">此奖状已被下架</div>
                                        <div className="text-xs leading-relaxed">原奖状已由主办方删除，证书不再有效</div>
                                        <div className="mt-1 break-all font-mono text-[11px] text-slate-400">NO. {ua.serial_number}</div>
                                    </div>
                                ) : hasLayout ? (
                                    <ResponsiveAwardRenderer layout={layout} data={renderData} className="absolute inset-0" />
                                ) : (
                                    <>
                                        {/* 底图可空（允许无底图保存）：没有底图时给个深色底，
                                            否则下面那层 white 文字会落在白底上看不见 */}
                                        {ua.bg_url ? (
                                            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${toSameOriginMediaUrl(ua.bg_url)})` }}></div>
                                        ) : (
                                            <div className="absolute inset-0 bg-slate-800"></div>
                                        )}
                                        <div className="absolute inset-0 bg-black/10"></div>
                                        <div className="absolute inset-0 p-8 flex flex-col justify-between text-white drop-shadow-md">
                                            <div className="flex justify-between items-start">
                                                <div className="bg-black/40 backdrop-blur px-3 py-1 rounded text-xs font-mono tracking-widest border border-white/20">
                                                    NO. {ua.serial_number}
                                                </div>
                                                {ua.level && (
                                                    <div
                                                       className="px-4 py-1 rounded-full font-black uppercase text-sm shadow-lg"
                                                       style={{ backgroundColor: badgeColor, color: textColor }}
                                                    >
                                                        {ua.level} LEVEL
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-center">
                                                <h2 className="text-3xl font-black uppercase tracking-wider mb-2" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{ua.name}</h2>
                                                <div className="text-lg font-serif italic">Presented to {user.callsign}</div>
                                            </div>
                                            <div className="flex justify-between items-end text-xs opacity-80">
                                                <div>{new Date(ua.issued_at).toLocaleDateString()}</div>
                                                <div className="font-mono">{ua.tracking_id}</div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            
                            {/* Action Bar */}
                            <div className="mt-4 flex justify-between items-center gap-2 px-2">
                                 <div className="text-sm font-bold text-slate-600 flex items-center gap-2 truncate">
                                     <Eye size={14}/> {ua.name}
                                     {ua.detached && (
                                         <span className="shrink-0 rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">已下架</span>
                                     )}
                                 </div>
                                 <div className="flex items-center gap-2 shrink-0">
                                     <a
                                        href={`#/verify/${ua.serial_number || ''}`}
                                        onClick={(e)=>e.stopPropagation()}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                                     >
                                        校验页
                                     </a>
                                     <button
                                        onClick={(e)=>{ e.stopPropagation(); handleExportPdf(ua); }}
                                        disabled={exportingId === ua.id || ua.detached}
                                        title={ua.detached ? '原奖状已被删除，无法导出' : '按可视化布局导出 300 DPI PDF'}
                                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                                     >
                                        {exportingId === ua.id ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
                                        {exportingId === ua.id ? '导出中…' : '下载 PDF'}
                                     </button>
                                 </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {/* Pass userRole as admin to hide 'apply' button but allow matrix viewing */}
            {selectedAward && (
                <AwardDetailModal 
                    award={{...selectedAward, id: selectedAward.award_id}} 
                    onClose={() => setSelectedAward(null)} 
                    userRole="user" 
                    mode="view_only" // Signal to just show progress/matrix
                />
            )}
        </div>
    );
};

// 实物卡片（M4 判定打通）：波段/模式选取框的常用选项（ADIF 标准值）
const QSL_BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '1.25m', '70cm', '23cm'];
const QSL_MODES = ['CW', 'SSB', 'AM', 'FM', 'RTTY', 'PSK31', 'FT8', 'FT4', 'JT65', 'JT9', 'MFSK', 'SSTV', 'MSK144', 'DIGITALVOICE'];

// Common Award Detail Modal (UPDATED: Multi-level)
const AwardDetailModal = ({ award, onClose, onApply, userRole, mode, canApply }) => {
    const [checkResult, setCheckResult] = useState(null);
    const [checking, setChecking] = useState(false);
    const [applying, setApplying] = useState(false);
    const [showMatrix, setShowMatrix] = useState(false);
    // 「实际效果」预览：按可视化布局 + 示例数据渲染，和用户申领后 / 导出 PDF 的样子一致
    const [previewMode, setPreviewMode] = useState('actual');
    const [exportingPdf, setExportingPdf] = useState(false);
    const hasLayout = Array.isArray(award.layout?.elements) && award.layout.elements.length > 0;
    const canPreviewPdf = hasLayout && (userRole === 'admin' || userRole === 'award_admin');

    // 实物材料（M4）：用户上传 QSL 卡片照片供管理员审核
    const [evUploading, setEvUploading] = useState(false);
    const [myEvidence, setMyEvidence] = useState([]);
    const evidenceFileRef = useRef(null);
    // type = 收集要素类型：qsl_card（QSO 卡）/ eyeball（当面交换卡）/ swl（收听报告）
    // date/time 按 tz 所选时区填写，提交前统一换算成 **UTC**（校验与日志匹配一律 UTC）
    const [evForm, setEvForm] = useState({ type: 'qsl_card', callsign: '', band: '', mode: '', date: '', time: '', tz: '0' });
    const evType = evidenceType(evForm.type);
    const evIsEyeball = evForm.type === 'eyeball'; // 当面交换：没有波段/模式
    const evIsSwl = evForm.type === 'swl';
    const evHasTime = /^\d{2}:\d{2}$/.test(evForm.time || '');
    const evTzOffset = tzOffsetOf(evForm.tz);
    const evTzLabel = (TZ_OPTIONS.find((t) => t.value === evForm.tz) || TZ_OPTIONS[0]).label;
    const evUtc = toUtcDateTime(evForm.date, evForm.time, evTzOffset);
    const fmtHhmm = (v) => (v && v.length === 4 ? `${v.slice(0, 2)}:${v.slice(2)}` : '');

    /**
     * 是否显示"申领 / 我的材料"这类申请人界面。
     * ★ 2026-09-24：**不再限定 user 角色** —— admin / award_admin 同样可以申领奖状、提交实物材料。
     * 判据改成"是不是从奖状大厅进来的"：
     *   · 奖状大厅传 `canApply` → 所有角色都能看到进度、材料与申领按钮；
     *   · 「已颁发奖状查看」传 `mode="view_only"`、「审核预览」两个都不传 → 保持只读，不会出现申领入口。
     */
    const showApplicantUI = !!canApply && mode !== 'view_only';

    const previewData = {
        callsign: (() => {
            try {
                return JSON.parse(localStorage.getItem('ham_user') || '{}').callsign || 'BG1ABC';
            } catch {
                return 'BH2VSQ';
            }
        })(),
        awardName: award.name || '',
        level: award.rules?.thresholds?.[0]?.name || 'Award',
        serial: '1234567890123456',
        issueDate: new Date().toLocaleDateString('zh-CN'),
        score: '42',
        issuer: award.tracking_id || '',
        verifyUrl: `${window.location.origin}/#/verify/1234567890123456`,
        description: award.description || '',
    };

    const handlePreviewPdf = async () => {
        setExportingPdf(true);
        try {
            const { downloadAwardPdf } = await import('./lib/exportAwardPdf.js');
            const { failedImages } = await downloadAwardPdf({
                layout: normalizeLayout(award.layout, award.bg_url),
                data: previewData,
                filename: `${award.name || 'award'}-效果预览.pdf`,
            });
            warnBrokenImages(failedImages);
        } catch (e) {
            alert(e.message || '生成效果预览失败');
        } finally {
            setExportingPdf(false);
        }
    };

    useEffect(() => {
        if (showApplicantUI) {
            checkEligibility();
        }
    }, []);

    useEffect(() => {
        if (showApplicantUI && award.id) {
            apiFetch('/evidence/mine')
                .then((list) => setMyEvidence((list || []).filter((e) => e.award_id === award.id)))
                .catch(() => {});
        }
    }, [userRole, award.id]);

    const checkEligibility = async (includeQsos = false) => {
        setChecking(true);
        try {
            // mode='view_only' implies we might want to see the matrix immediately or just load progress
            // Check requires ?include_qsos=true for matrix
            const url = `/awards/${award.id}/check` + (includeQsos || showMatrix ? '?include_qsos=true' : '');
            const res = await apiFetch(url);
            setCheckResult(res);
        } catch (err) {
            console.error(err);
            setCheckResult({ error: err.message });
        } finally {
            setChecking(false);
        }
    };

    const handleApplyClick = async () => {
        if (!checkResult?.eligible) return;
        const ok = await confirmDialog({
            title: '申领奖状',
            message: `确认申领「${award.name}」？`,
            detail: `判定等级：${checkResult?.achieved_level?.name || '—'}　当前成绩：${checkResult?.current_score ?? '—'}\n同一等级只能领取一次；领取后会生成公开可校验的序列号，且无法自行撤销。`,
            confirmText: '确认申领',
        });
        if (!ok) return;
        setApplying(true);
        try {
            await apiFetch(`/awards/${award.id}/apply`, { method: 'POST' });
            alert('🎉 恭喜！奖状申领成功！');
            onClose();
        } catch (err) {
            alert('申领失败: ' + err.message);
        } finally {
            setApplying(false);
        }
    };

    const handleLoadMatrix = () => {
        setShowMatrix(true);
        checkEligibility(true); // reload with qsos
    };

    const handleEvidenceUpload = async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
        if (file.size > 5 * 1024 * 1024) { alert('图片不能超过 5 MB'); return; }
        if (!evForm.callsign.trim()) {
            alert(evIsEyeball ? '请先填写对方（学校台）呼号' : evIsSwl ? '请先填写被收听电台呼号' : '请先填写对方呼号');
            return;
        }
        // ★ 日期必填（2026-09-24）：它是**新建日志**的主键组成部分 —— 没日期既无法去重、
        //   也无法参与任何按时间判定规则的奖状，所以审核通过时不会补建日志（用户曾因此
        //   「看不到新建的日志」却没有任何提示）。这里直接从源头拦掉。
        if (!evForm.date) {
            alert(`请先填写${evIsEyeball ? '交换日期' : evIsSwl ? '收听日期' : '通联日期'}：审核通过后要靠它把这条记录补进你的日志。`);
            return;
        }
        const ok = await confirmDialog({
            title: `提交${evType.label}`,
            message: `确认上传这张${evType.short}照片？`,
            detail: [
                `奖状：${award.name}`,
                `${evIsSwl ? '被收听电台' : '对方呼号'}：${evForm.callsign.trim()}`,
                evIsEyeball
                    ? `交换时间：${evForm.date || '—'}${evHasTime ? ' ' + evForm.time : ''}${evTzOffset !== 0 ? `（${evTzLabel}）` : ''}`
                    : `波段/模式：${evForm.band || '—'} / ${evForm.mode || '—'}`,
                !evIsEyeball
                    ? `通联时间：${evForm.date || '—'}${evHasTime ? ' ' + evForm.time : ''}${evTzOffset !== 0 ? `（${evTzLabel}）` : ''}`
                    : '',
                evUtc.ok
                    ? `换算后按 UTC 提交：${evUtc.date}${evHasTime ? ' ' + fmtHhmm(evUtc.time) : ''} UTC（日志匹配与校验一律用 UTC）`
                    : '',
                '',
                evType.hint,
                // 让申请人提前知道"通过后会得到什么"，避免以为日志凭空出现/消失
                evForm.type === 'qsl_card'
                    ? '审核通过后：先把你日志里对应的通联标记为「已确认」；若日志里没有这条，会按上面填的信息**自动补建一条**（也能用于其它奖状申请）。'
                    : '',
                '上传后管理员会收到待审提醒；审核通过或驳回后照片会立即从服务器删除，只保留审核结论。',
            ].filter((x) => x !== '').join('\n'),
            confirmText: '上传并提交',
        });
        if (!ok) return;
        setEvUploading(true);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('award_id', award.id);
            fd.append('type', evForm.type);
            fd.append('match_callsign', evForm.callsign.trim());
            if (evForm.band) fd.append('match_band', evForm.band);
            if (evForm.mode) fd.append('match_mode', evForm.mode);
            // ★ 日期/时间统一换算成 UTC 再提交（校验与日志匹配一律 UTC）
            if (evUtc.ok && evUtc.date) {
                fd.append('match_date', evUtc.date);
                if (evHasTime) fd.append('match_time', evUtc.time);
                fd.append('match_tz_offset', String(evTzOffset));
            }
            await apiFetch('/evidence', { method: 'POST', body: fd });
            const list = await apiFetch('/evidence/mine');
            setMyEvidence((list || []).filter((x) => x.award_id === award.id));
            alert(`${evType.label}已上传，等待管理员审核`);
        } catch (err) {
            alert('上传失败: ' + (err.message || err.error || '未知错误'));
        } finally {
            setEvUploading(false);
        }
    };

    const rules = award.rules || {};
    const hasComplexRules = !!rules.v2;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-6xl rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[90vh]">
                <div className="w-full md:w-5/12 bg-slate-100 h-48 md:h-auto min-h-[200px] flex flex-col gap-3 p-4 overflow-y-auto">
                    {hasLayout && (
                        <div className="flex gap-1 bg-white p-1 rounded-lg border self-start shrink-0">
                            <button
                                type="button"
                                onClick={() => setPreviewMode('actual')}
                                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 ${previewMode === 'actual' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                <Monitor size={13} /> 实际效果
                            </button>
                            <button
                                type="button"
                                onClick={() => setPreviewMode('bg')}
                                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 ${previewMode === 'bg' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                <ImageIcon size={13} /> 设计底图
                            </button>
                        </div>
                    )}

                    <div className="relative w-full aspect-[297/210] rounded-xl overflow-hidden border border-slate-300 shadow-lg bg-white shrink-0">
                        {previewMode === 'actual' && hasLayout ? (
                            <ResponsiveAwardRenderer layout={normalizeLayout(award.layout, award.bg_url)} data={previewData} />
                        ) : award.bg_url ? (
                            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${toSameOriginMediaUrl(award.bg_url)})` }} />
                        ) : (
                            /* 底图可空：明确告知，别给一片空白让人以为加载失败 */
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">未设置底图</div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/55 backdrop-blur-sm p-3 text-white">
                            <div className="text-xs font-bold opacity-70 uppercase tracking-wider mb-0.5">奖状详情</div>
                            <h2 className="text-lg font-black leading-tight">{award.name}</h2>
                        </div>
                    </div>

                    {canPreviewPdf && (
                        <button
                            type="button"
                            onClick={handlePreviewPdf}
                            disabled={exportingPdf}
                            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60 shrink-0"
                        >
                            {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            {exportingPdf ? '生成中…' : '下载效果 PDF（用户最终拿到的样子）'}
                        </button>
                    )}
                    {hasLayout && (
                        <p className="text-[11px] text-slate-400 shrink-0">
                            实际效果用示例数据渲染，与用户申领后看到的、以及导出 PDF 的样式一致。
                        </p>
                    )}
                </div>
                
                <div className="flex-1 p-8 flex flex-col overflow-y-auto">
                    <div className="flex justify-between items-start mb-6">
                         <div className="space-y-1">
                            <h3 className="font-bold text-slate-800 text-lg">规则说明</h3>
                            <div className="text-xs font-mono text-slate-400">ID: {award.tracking_id || award.id}</div>
                         </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X/></button>
                    </div>
                    
                    {showMatrix ? (
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="flex items-center gap-2 mb-4">
                                <button onClick={()=>setShowMatrix(false)} className="text-sm text-slate-500 hover:text-black">← 返回详情</button>
                                <h4 className="font-bold">日志匹配分析 (Log Matrix)</h4>
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                {checkResult?.matching_qsos ? (
                                    <LogMatchMatrix qsos={checkResult.matching_qsos} award={award} checkResult={checkResult} />
                                ) : (
                                    <div className="text-center p-8 text-slate-400">加载中...</div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 flex-1 overflow-y-auto">
                            <div>
                                <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2"><Info size={14}/> 简介</h4>
                                <p className="text-slate-700 leading-relaxed text-sm bg-slate-50 p-4 rounded-xl border">{award.description || '暂无描述'}</p>
                            </div>

                            {/* Conditions Display */}
                            <div>
                                <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2"><Filter size={14}/> 判定条件</h4>
                                <div className="bg-slate-50 rounded-xl p-4 border text-sm space-y-2">
                                    {hasComplexRules ? (
                                        <>
                                            {rules.basic?.startDate && <div>📅 时间范围: {rules.basic.startDate} 至 {rules.basic.endDate || '至今'}</div>}
                                            {rules.basic?.qslRequired && <div className="text-green-600 font-bold">✅ 需要 QSL 确认</div>}
                                            {rules.filters?.length > 0 ? (
                                                rules.filters.map((f, i) => (
                                                    <div key={i} className="flex gap-2"><span className="font-mono bg-white px-1 border rounded text-xs">{f.field}</span> {f.operator} <b>{f.value}</b></div>
                                                ))
                                            ) : <div className="text-slate-400 text-xs">无特殊筛选条件</div>}
                                        </>
                                    ) : (
                                        (Array.isArray(award.rules) ? award.rules : []).map((rule, i) => (
                                            <div key={i} className="flex items-center gap-2">
                                                <CheckCircle size={14} className="text-green-500"/>
                                                <span><span className="font-mono bg-white px-1 border rounded">{rule.field}</span> {rule.operator} <span className="font-bold">{rule.value}</span></span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Logic & Targets */}
                            {hasComplexRules && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2"><Calculator size={14}/> 计分模式</h4>
                                        <div className="bg-slate-50 p-3 rounded-lg border text-sm">
                                            <div className="font-bold text-slate-700 mb-1">{rules.logic === 'collection' ? '📦 收集型 (计数)' : '🔢 计分型 (累计)'}</div>
                                            <div className="text-xs text-slate-500">目标: {rules.targets?.type?.toUpperCase() || '任意 QSO'}</div>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2"><Trophy size={14}/> 等级要求</h4>
                                        <div className="bg-slate-50 p-3 rounded-lg border text-sm space-y-1">
                                            {(rules.thresholds || [{value:0, name:'Basic'}]).map((t,i) => (
                                                <div key={i} className="flex justify-between text-xs">
                                                    <span>{t.name}</span>
                                                    <span className="font-bold">
                                                        {t.value} {t.fullCollection ? '+ Full' : ''}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Real-time Check Result Area */}
                            {showApplicantUI && (
                                <div className="mt-4 pt-4 border-t">
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="font-bold text-sm text-slate-500 uppercase flex items-center gap-2">
                                            <Activity size={14}/> 您的进度
                                            {checking && <span className="text-xs font-normal text-blue-600 animate-pulse ml-2">正在分析日志...</span>}
                                        </h4>
                                        <button onClick={handleLoadMatrix} className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold hover:bg-blue-100 flex items-center gap-1">
                                            <Grid size={12}/> 查看日志匹配详情
                                        </button>
                                    </div>
                                    
                                    {checkResult ? (
                                        <div className={`rounded-xl p-5 border-2 space-y-4 ${checkResult.eligible ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-bold text-slate-500">当前累计</span>
                                                    <span className="text-2xl font-black">{checkResult.current_score} <span className="text-sm text-slate-400 font-normal">/ {checkResult.target_score}</span></span>
                                                </div>
                                                {/* Progress Bar */}
                                                <div className="w-full bg-slate-200 rounded-full h-3 mb-3 overflow-hidden">
                                                    <div 
                                                        className={`h-full transition-all duration-1000 ${checkResult.eligible ? 'bg-green-500' : 'bg-blue-500'}`} 
                                                        style={{width: `${Math.min(100, (checkResult.current_score / checkResult.target_score) * 100)}%`}}
                                                    ></div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <div className="text-xs text-slate-500 font-bold">
                                                        {checkResult.details?.msg}
                                                    </div>
                                                    {checkResult.eligible && <div className="px-2 py-1 bg-green-200 text-green-800 text-xs font-bold rounded flex items-center gap-1"><Check size={12}/> 已达成: {checkResult.achieved_level?.name}</div>}
                                                </div>
                                            </div>

                                            {/* Detailed Target Breakdown */}
                                            {checkResult.breakdown && (
                                                <div className="bg-white rounded-lg p-3 border text-xs">
                                                    <div className="font-bold mb-2 flex justify-between">
                                                        <span>特定目标完成度 ({checkResult.breakdown.achieved.length}/{checkResult.breakdown.total_required})</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                                        <div>
                                                            <div className="text-green-600 font-bold mb-1">已完成</div>
                                                            <div className="flex flex-wrap gap-1">
                                                                {checkResult.breakdown.achieved.map(t => (
                                                                    <span key={t.target} className="bg-green-100 text-green-700 px-1 rounded">{t.target}</span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-red-400 font-bold mb-1">未完成</div>
                                                            <div className="flex flex-wrap gap-1">
                                                                {checkResult.breakdown.missing.map(t => (
                                                                    <span key={t} className="bg-slate-100 text-slate-400 px-1 rounded">{t}</span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Multi-level Claim Info */}
                                            {checkResult.claimed_levels?.length > 0 && (
                                                <div className="mt-2 text-xs text-slate-400 border-t pt-2">
                                                    已领取: {checkResult.claimed_levels.join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed">
                                            日志分析未就绪或出现错误
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 实物材料（M4）：收集要素 = QSL 卡片 / Eyeball 卡 / SWL 收听报告 */}
                    {showApplicantUI && (
                        <div className="mt-6 pt-4 border-t">
                            <h4 className="font-bold text-sm text-slate-500 uppercase flex items-center gap-2 mb-2">
                                <ImageIcon size={14}/> 实物材料 / 收集要素
                            </h4>
                            <p className="text-xs text-slate-400 mb-3">
                                按类型上传照片：<b>QSL 卡片</b>审核通过后会自动把匹配的日志标记为「已确认」；
                                <b>Eyeball 卡</b>（当面交换）与 <b>SWL 收听报告</b>属于收集凭证，只留审核结论、不参与日志判定。照片审核后立即从服务器删除。
                            </p>
                            <div className="flex flex-wrap gap-2 mb-2">
                                {EVIDENCE_TYPES.map((t) => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => setEvForm({ ...evForm, type: t.value })}
                                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${evForm.type === t.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-500">{evType.hint}</p>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <label className="block col-span-2">
                                    <span className="text-xs text-slate-500">
                                        {evIsEyeball ? '对方（学校台）呼号（必填）' : evIsSwl ? '被收听电台呼号（必填）' : '对方呼号（必填）'}
                                    </span>
                                    <input value={evForm.callsign} onChange={(e) => setEvForm({ ...evForm, callsign: e.target.value.toUpperCase() })} placeholder="例如: JA1ABC" className="w-full mt-1 p-2 border rounded-lg uppercase text-sm" />
                                </label>
                                {/* Eyeball 是当面交换，没有波段/模式可言，直接隐藏 */}
                                {!evIsEyeball && (
                                    <>
                                        <label className="block">
                                            <span className="text-xs text-slate-500">波段</span>
                                            <select value={evForm.band} onChange={(e) => setEvForm({ ...evForm, band: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm">
                                                <option value="">不限</option>
                                                {QSL_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-xs text-slate-500">{evIsSwl ? '收听模式' : '操作模式'}</span>
                                            <select value={evForm.mode} onChange={(e) => setEvForm({ ...evForm, mode: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm">
                                                <option value="">不限</option>
                                                {QSL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                                            </select>
                                        </label>
                                    </>
                                )}
                                <label className="block">
                                    {/* ★ 日期必填：它是补建日志的主键组成部分（user_id + 呼号 + 波段 + 模式 + 日期） */}
                                    <span className="text-xs text-slate-500">
                                        {evIsEyeball ? '交换日期' : evIsSwl ? '收听日期' : '通联日期'} <b className="text-red-500">*</b>
                                        <span className="ml-1 text-slate-400">（必填，审核通过后据此入账）</span>
                                    </span>
                                    <input type="date" value={evForm.date} onChange={(e) => setEvForm({ ...evForm, date: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm" />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-slate-500">{evIsEyeball ? '交换时间' : evIsSwl ? '收听时间' : '通联时间'}</span>
                                    <input type="time" value={evForm.time} onChange={(e) => setEvForm({ ...evForm, time: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm" />
                                </label>
                                <label className="block col-span-2">
                                    <span className="text-xs text-slate-500">上面时间用的是哪个时区（校验与匹配一律按 UTC）</span>
                                    <select value={evForm.tz} onChange={(e) => setEvForm({ ...evForm, tz: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm">
                                        {TZ_OPTIONS.map((t) => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                </label>
                                {/* 换算结果实时可见：填 BJT 也能一眼看到最终提交的 UTC 值 */}
                                {evUtc.ok && (
                                    <p className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-500">
                                        将按 UTC 提交：
                                        <b className="text-slate-700">
                                            {evUtc.date}{evHasTime ? ` ${fmtHhmm(evUtc.time)}` : ''} UTC
                                        </b>
                                        {evHasTime ? '' : '（未填时间 → 只按日期匹配日志）'}
                                        {evTzOffset !== 0 ? `　你填的是 ${evTzLabel}` : ''}
                                    </p>
                                )}
                            </div>
                            <input ref={evidenceFileRef} type="file" accept="image/*" className="hidden" onChange={handleEvidenceUpload} />
                            <button
                                type="button"
                                onClick={() => evidenceFileRef.current && evidenceFileRef.current.click()}
                                disabled={evUploading}
                                className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-60"
                            >
                                {evUploading ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}
                                {evUploading ? '上传中…' : `上传${evType.short}照片`}
                            </button>
                            {myEvidence.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs">
                                    {myEvidence.map((ev) => (
                                        <li key={ev.id} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded border">
                                            <span className="text-slate-600">
                                                <b className="text-slate-700">{evidenceTypeLabel(ev.type)}</b>
                                                {ev.match_callsign ? ` · ${ev.match_callsign}` : ''}
                                                {ev.match_band ? ` · ${ev.match_band}` : ''}
                                                {ev.match_mode ? ` · ${ev.match_mode}` : ''}
                                                {ev.match_date ? ` · ${ev.match_date}${ev.match_time ? ' ' + fmtHhmm(ev.match_time) : ''} UTC` : ''}
                                                {ev.note ? ` · ${ev.note}` : ''}
                                            </span>
                                            {ev.status === 'pending' && <span className="text-amber-600 font-bold">待审核</span>}
                                            {ev.status === 'approved' && <span className="text-green-600 font-bold">已通过</span>}
                                            {ev.status === 'rejected' && <span className="text-red-500 font-bold">已驳回{ev.reject_reason ? '：' + ev.reject_reason : ''}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* 申领须知：与后端规则一致（条件判定、同等级仅一次、实物材料审核后即删） */}
                    {showApplicantUI && (
                        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-700">
                                <Info size={15} /> 申领须知
                            </div>
                            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                                <li>资格由本奖状的规则自动判定，可查看下方进度与明细；条件未满足时无法申领。</li>
                                <li>同一奖状的<b>同一等级只能领取一次</b>，请在条件达成后再申领。</li>
                                <li>可用 <b>QSL 实物卡片</b>补充确认：审核通过后计入成绩（自动匹配日志并标记「已确认」），照片在审核结束后立即删除。</li>
                                <li>
                                    其它<b>收集要素</b>（<b>Eyeball 卡</b>＝当面交换、<b>SWL 收听报告</b>＝收听台凭证）也可提交留档，
                                    它们属于收集凭证、<b>不参与</b>日志判定，是否计入由奖状规则说明为准。
                                </li>
                                <li>申领成功后生成唯一序列号与二维码，可通过公开校验页查验。</li>
                                <li>请勿上传虚假或违反法律法规的材料，详见站内《内容规范》。</li>
                            </ul>
                        </div>
                    )}

                    <div className="mt-6">
                        {mode === 'view_only' ? (
                            <div className="text-center text-slate-400 text-sm bg-slate-50 p-3 rounded-lg border">
                                已颁发奖状查看模式
                            </div>
                        ) : (
                            canApply ? (
                                <button 
                                    onClick={handleApplyClick} 
                                    disabled={!checkResult?.eligible || applying || checkResult?.claimed_levels?.includes(checkResult?.achieved_level?.name)}
                                    className={`w-full py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                                        checkResult?.eligible && !checkResult?.claimed_levels?.includes(checkResult?.achieved_level?.name)
                                        ? 'bg-green-600 hover:bg-green-700 text-white shadow-green-200 active:scale-95' 
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                    }`}
                                >
                                    {applying ? '正在提交...' 
                                        : checkResult?.claimed_levels?.includes(checkResult?.achieved_level?.name) 
                                            ? `已领取当前等级 (${checkResult.achieved_level.name})`
                                            : checkResult?.eligible 
                                                ? `申领 ${checkResult.achieved_level.name} 奖状` 
                                                : '条件未满足，无法申领'}
                                </button>
                            ) : (
                                <div className="text-center text-slate-400 text-sm bg-slate-50 p-3 rounded-lg border">
                                    {userRole === 'admin' ? '管理员模式 - 仅供预览' : '仅普通用户可申领'}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// 1. Award Center View (All Approved Awards)
const AwardCenterView = ({ user }) => {
    const [awards, setAwards] = useState([]);
    const [selectedAward, setSelectedAward] = useState(null);

    useEffect(() => {
        apiFetch('/awards/all_approved').then(setAwards).catch(console.error);
    }, []);

    const handleApply = (award) => {
        // Only called if passed to Modal, but logic moved inside Modal now
        setSelectedAward(null);
    };

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2"><Award className="text-orange-500"/> 奖状大厅 (Award Center)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {awards.map(aw => (
                    <div 
                        key={aw.id} 
                        onClick={() => setSelectedAward(aw)}
                        className={`bg-white rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow group cursor-pointer`}
                    >
                        <div className="h-48 relative overflow-hidden bg-slate-100">
                            {/* 缩略图按布局渲染（底图可空，只渲染 bg_url 会是一片空白） */}
                            <AwardThumbnail award={aw} className="absolute inset-0" placeholderText="（未设置底图）" />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-white font-bold border-2 border-white px-4 py-2 rounded-full">查看详情与进度</span>
                            </div>
                        </div>
                        <div className="p-6">
                            <h4 className="font-bold text-lg mb-2 group-hover:text-blue-600 transition-colors">{aw.name}</h4>
                            <p className="text-slate-500 text-sm line-clamp-2">{aw.description}</p>
                            <div className="mt-4 pt-4 border-t flex justify-between items-center text-xs text-slate-400">
                                <span>ID: {aw.tracking_id}</span>
                                <span className="text-green-600 font-bold bg-green-50 px-2 py-1 rounded">详情</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {selectedAward && <AwardDetailModal award={selectedAward} onClose={() => setSelectedAward(null)} onApply={handleApply} userRole={user.role} canApply />}
        </div>
    );
};

// 2. Award Admin Manager (Refactored: Accepts viewMode prop to handle specific section)
const AwardAdminManager = ({ viewMode }) => {
    // viewMode: 'create', 'drafts', 'returned', 'audit_list'
    
    // Internal state mapping for drafts logic
    const isReturnedMode = viewMode === 'returned';
    
    const [drafts, setDrafts] = useState([]);
    const [auditList, setAuditList] = useState([]);
    const [editingAward, setEditingAward] = useState(null); 
    const [timelineModal, setTimelineModal] = useState(null); 
    
    // Initial check for create mode
    useEffect(() => {
        if (viewMode === 'create') {
            setEditingAward({});
        } else {
            setEditingAward(null);
        }
    }, [viewMode]);

    const loadData = async () => {
        // Load content based on viewMode
        if (viewMode === 'drafts' || viewMode === 'returned') {
            const status = isReturnedMode ? 'returned' : 'drafts';
            apiFetch(`/awards/my?status=${status}`).then(setDrafts);
        }
        if (viewMode === 'audit_list') apiFetch('/awards/my?status=audit_list').then(setAuditList);
    };

    useEffect(() => { loadData(); }, [viewMode]);

    const handleDelete = async (award) => {
        const ok = await confirmDialog({
            title: '删除奖状',
            message: `确认删除「${award?.name || '未命名奖状'}」？`,
            detail: '删除后不可恢复。只有草稿与被退回的奖状能删除；已发布的奖状请改用「撤回/打回」。',
            confirmText: '删除',
            danger: true,
        });
        if (!ok) return;
        try {
            await apiFetch(`/awards/${award.id}`, { method: 'DELETE' });
            loadData();
        } catch(e) { alert(e.message); }
    };

    const renderTimeline = () => {
        if (!timelineModal) return null;
        const logs = timelineModal.audit_log || [];
        return (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg">审核进度详情 - {timelineModal.tracking_id}</h3>
                        <button onClick={()=>setTimelineModal(null)}><X/></button>
                    </div>
                    <div className="relative border-l-2 border-slate-200 ml-3 space-y-8">
                        {logs.map((log, idx) => (
                            <div key={idx} className="relative pl-8">
                                <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${
                                    log.action === 'approved' ? 'bg-green-500' :
                                    log.action === 'returned' || log.action.includes('reject') ? 'bg-red-500' :
                                    'bg-blue-500'
                                }`}></div>
                                <div className="text-sm text-slate-400 mb-1">{new Date(log.time).toLocaleString()}</div>
                                <div className="font-bold text-slate-800">{
                                    log.action === 'submitted' ? '提交审核' : 
                                    log.action === 'approved' ? '审核通过' : 
                                    log.action === 'returned' ? '被退回' : 
                                    log.action === 'saved_draft' ? '保存草稿' : log.action
                                }</div>
                                <div className="text-sm text-slate-600">操作人: {log.actor}</div>
                                {log.reason && <div className="mt-2 p-2 bg-red-50 text-red-700 text-sm rounded border border-red-100">原因: {log.reason}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header Title based on View Mode */}
            <h3 className="text-xl font-bold flex items-center gap-2">
                {viewMode === 'create' && <><Plus className="text-blue-500"/> 新建奖状 (New Award)</>}
                {viewMode === 'drafts' && <><FileText className="text-orange-500"/> 我的草稿 (My Drafts)</>}
                {viewMode === 'returned' && <><FileWarning className="text-red-500"/> 打回草稿 (Returned)</>}
                {viewMode === 'audit_list' && <><List className="text-purple-500"/> 审核列表 (Audit List)</>}
            </h3>

            <div className="bg-white rounded-2xl shadow-sm border p-6 min-h-[400px]">
                {viewMode === 'create' && (
                    <div className="text-center py-10">
                        {editingAward ? (
                            <div className="text-slate-500">正在打开编辑器...</div>
                        ) : (
                            <>
                                <div className="mb-4 text-slate-400">点击下方按钮开始设计新奖状</div>
                                <button onClick={()=>setEditingAward({})} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 mx-auto hover:bg-blue-700 transition-colors">
                                    <Plus size={20}/> 创建新奖状
                                </button>
                            </>
                        )}
                    </div>
                )}

                {(viewMode === 'drafts' || viewMode === 'returned') && (
                    <div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {drafts.length === 0 && <div className="col-span-full text-center text-slate-400 py-10">空空如也</div>}
                            {drafts.map(d => (
                                <div key={d.id} className="border rounded-xl overflow-hidden hover:border-blue-300 transition-colors group">
                                    <div className="h-32 relative overflow-hidden bg-slate-50">
                                        {/* 缩略图按布局渲染（底图可空，只渲染 bg_url 会是一片空白） */}
                                        <AwardThumbnail award={d} className="absolute inset-0" placeholderText="未设置底图（白底 + 元素排版）" />
                                        {isReturnedMode && <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded font-bold">已退回</div>}
                                    </div>
                                    <div className="p-4">
                                        <h4 className="font-bold mb-1">{d.name || '未命名奖状'}</h4>
                                        {isReturnedMode && d.reject_reason && (
                                            <div className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">原因: {d.reject_reason}</div>
                                        )}
                                        <div className="flex gap-2 mt-4">
                                            <button onClick={()=>setEditingAward(d)} className="flex-1 bg-slate-900 text-white py-2 rounded-lg text-sm font-bold">编辑/重交</button>
                                            <button onClick={()=>handleDelete(d)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {viewMode === 'audit_list' && (
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold">
                            <tr><th className="p-4">追踪码</th><th className="p-4">奖状名称</th><th className="p-4">提交时间</th><th className="p-4">当前状态</th><th className="p-4">操作</th></tr>
                        </thead>
                        <tbody className="divide-y">
                            {auditList.map(item => (
                                <tr key={item.id}>
                                    <td className="p-4 font-mono text-xs">{item.tracking_id}</td>
                                    <td className="p-4 font-bold">{item.name}</td>
                                    <td className="p-4 text-sm text-slate-500">{new Date(item.created_at).toLocaleDateString()}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            item.status === 'approved' ? 'bg-green-100 text-green-700' :
                                            item.status === 'returned' ? 'bg-red-100 text-red-700' :
                                            'bg-blue-100 text-blue-700'
                                        }`}>
                                            {item.status === 'approved' ? '已通过' : item.status === 'returned' ? '已退回' : '审核中'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <button onClick={()=>setTimelineModal(item)} className="text-blue-600 hover:underline text-sm font-bold">查看详情</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {editingAward && <AwardDesigner initData={editingAward} onClose={()=>{setEditingAward(null); loadData();}} />}
            {timelineModal && renderTimeline()}
        </div>
    );
};

// 3. System Admin Award Manager (Refactored: Accepts viewMode prop)
const SystemAdminAwardManager = ({ viewMode }) => {
    // viewMode: 'audit' or 'overview'
    
    const [list, setList] = useState([]);
    const [actionModal, setActionModal] = useState(null); 
    const [reason, setReason] = useState('');
    const [detailModal, setDetailModal] = useState(null); 
    
    const load = () => {
        const url = viewMode === 'audit' ? '/admin/awards/pending' : '/admin/awards/approved';
        apiFetch(url).then(setList).catch(console.error);
    };

    useEffect(() => { load(); }, [viewMode]);

    const handleAction = async () => {
        try {
            await apiFetch('/admin/awards/audit', {
                method: 'POST',
                body: JSON.stringify({ id: actionModal.id, action: actionModal.action, reason })
            });
            alert('操作成功');
            setActionModal(null); setReason(''); load();
        } catch(e) { alert(e.message); }
    };

    return (
        <div className="space-y-6">
            {/* Title */}
            <h3 className="text-xl font-bold flex items-center gap-2">
                {viewMode === 'audit' ? <><CheckCircle className="text-blue-500"/> 奖状审核 (Award Audit)</> : <><Layout className="text-purple-500"/> 奖状总览 (Award Overview)</>}
            </h3>

            {/* Content Table */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="p-4">ID</th><th className="p-4">名称</th><th className="p-4">提交人</th><th className="p-4">提交时间</th><th className="p-4 w-48">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {list.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-400">暂无数据</td></tr>}
                        {list.map(item => (
                            <tr key={item.id}>
                                <td className="p-4 text-xs font-mono">{item.tracking_id || item.id}</td>
                                <td className="p-4 font-bold">{item.name}</td>
                                <td className="p-4 text-sm">{item.creator_call}</td>
                                <td className="p-4 text-sm text-slate-500">{new Date(item.created_at).toLocaleDateString()}</td>
                                <td className="p-4 flex gap-2">
                                    <button onClick={()=>setDetailModal(item)} className="p-2 bg-slate-100 text-slate-600 rounded hover:bg-slate-200" title="查看详情"><Eye size={16}/></button>
                                    {viewMode === 'audit' ? (
                                        <>
                                            <button onClick={async ()=>{
                                                const ok = await confirmDialog({
                                                    title: '通过并发布奖状',
                                                    message: `确认通过「${item.name}」？`,
                                                    detail: `创建者：${item.creator_call || '—'}\n通过后该奖状会立即出现在奖状大厅，用户即可申领。`,
                                                    confirmText: '通过并发布',
                                                });
                                                if (!ok) return;
                                                await apiFetch('/admin/awards/audit', {method:'POST', body:JSON.stringify({id:item.id, action:'approve'})})
                                                    .then(()=>{alert('已通过');load()})
                                                    .catch(e=>alert(e.message));
                                            }} className="px-3 py-1 bg-green-100 text-green-700 rounded font-bold text-sm">通过</button>
                                            <button onClick={()=>setActionModal({id:item.id, action:'reject', title:'打回申请'})} className="px-3 py-1 bg-red-100 text-red-700 rounded font-bold text-sm">打回</button>
                                        </>
                                    ) : (
                                        <button onClick={()=>setActionModal({id:item.id, action:'recall', title:'撤回奖状'})} className="px-3 py-1 bg-orange-100 text-orange-700 rounded font-bold text-sm flex items-center gap-1"><RotateCcw size={14}/> 撤回/打回</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {actionModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
                        <h3 className="font-bold text-lg">{actionModal.title}</h3>
                        <textarea className="w-full border rounded-lg p-3 h-32" placeholder="请输入原因 (必填)" value={reason} onChange={e=>setReason(e.target.value)}></textarea>
                        <div className="flex gap-2">
                            <button onClick={()=>setActionModal(null)} className="flex-1 bg-slate-100 py-2 rounded-lg font-bold">取消</button>
                            <button onClick={handleAction} className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold">确认执行</button>
                        </div>
                    </div>
                </div>
            )}
            
            {detailModal && (
                <AwardDetailModal 
                    award={detailModal} 
                    onClose={()=>setDetailModal(null)} 
                    userRole="admin" 
                />
            )}
        </div>
    );
};

// New Standalone Component for Issuance Management (3. Requirement)
/**
 * 颁发管理
 * ------------------------------------------------------------------
 * ★ 归类（2026-09-24）：颁发记录**不再随奖状删除**。奖状被删除时记录会保留下来并打上
 *   `detached` 标记（后端 LEFT JOIN awards，`award_id` 已被置 NULL），本页把它们单独归到
 *   「已失效」分组，并提供**一键清理**，避免和有效记录混在一起干扰核对。
 *   —— 反过来，有效记录只能逐条「撤销并删除」，因为那是真正发给用户的凭证。
 */
const IssuanceManager = () => {
    const [issuanceList, setIssuanceList] = useState([]);
    const [purging, setPurging] = useState(false);

    const load = () => {
        apiFetch('/admin/issued-awards').then(setIssuanceList).catch(console.error);
    };

    useEffect(() => { load(); }, []);

    const activeList = issuanceList.filter(i => !i.detached);
    const detachedList = issuanceList.filter(i => i.detached);

    const handleDeleteIssuance = async (item) => {
        const ok = await confirmDialog({
            title: item.detached ? '删除已失效记录' : '撤销已颁发的奖状',
            message: item.detached
                ? `确认删除 ${item?.applicant_call || '该用户'} 的这条已失效记录？`
                : `确认撤销 ${item?.applicant_call || '该用户'} 的「${item?.award_name || '奖状'}」颁发记录？`,
            detail: `序列号：${item?.serial_number || '—'}　等级：${item?.level || '—'}\n${item.detached ? '原奖状已删除，此记录仅用于留痕。' : '撤销后该奖状的公开校验链接（#/verify/序列号）会立即失效，记录不可恢复。'}`,
            confirmText: item.detached ? '删除记录' : '撤销并删除',
            danger: true,
        });
        if (!ok) return;
        try {
            await apiFetch(`/admin/issued-awards/${item.id}`, { method: 'DELETE' });
            alert(item.detached ? '已删除' : '已撤销');
            load();
        } catch(e) { alert(e.message); }
    };

    /** 一键清理全部「原奖状已删除」的记录 */
    const handlePurgeDetached = async () => {
        const ok = await confirmDialog({
            title: '一键清理已失效记录',
            message: `确认删除全部 ${detachedList.length} 条「原奖状已删除」的颁发记录？`,
            detail: '这些记录对应的奖状已不存在，证书也无法再下载。\n清理后记录不可恢复，且相关序列号的公开校验会变成「未找到」。',
            confirmText: `清理 ${detachedList.length} 条`,
            danger: true,
        });
        if (!ok) return;
        setPurging(true);
        try {
            const r = await apiFetch('/admin/issued-awards/orphans', { method: 'DELETE' });
            alert(`已清理 ${r.purged ?? 0} 条`);
            load();
        } catch(e) { alert(e.message || '清理失败'); }
        finally { setPurging(false); }
    };

    /** 表格行（有效 / 已失效 共用一套渲染，只差归属标签与按钮文案） */
    const renderRow = (item) => (
        <tr key={item.id} className={item.detached ? 'bg-amber-50' : undefined}>
            <td className="p-4 text-xs font-mono">{item.id}</td>
            <td className="p-4 font-bold">
                {item.award_name || '（名称缺失）'}{' '}
                {item.detached ? (
                    <span className="ml-1 text-[11px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">原奖状已删除</span>
                ) : (
                    <span className="text-xs text-slate-400">({item.tracking_id})</span>
                )}
            </td>
            <td className="p-4 font-mono text-sm">{item.serial_number}</td>
            <td className="p-4 text-sm text-slate-500">{item.issued_at ? new Date(item.issued_at).toLocaleString() : '—'}</td>
            <td className="p-4 font-bold text-blue-600">{item.applicant_call}</td>
            <td className="p-4"><span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold">{item.level}</span></td>
            <td className="p-4">
                <button onClick={()=>handleDeleteIssuance(item)} className="p-2 bg-red-50 text-red-600 rounded hover:bg-red-100 text-xs font-bold flex items-center gap-1">
                    <Trash2 size={14}/> {item.detached ? '删除记录' : '删除颁发'}
                </button>
            </td>
        </tr>
    );

    const tableHead = (
        <thead className="bg-slate-50 border-b">
            <tr>
                <th className="p-4">颁发ID</th><th className="p-4">奖状名称</th><th className="p-4">序列号</th><th className="p-4">颁发时间</th><th className="p-4">申请人</th><th className="p-4">等级</th><th className="p-4">操作</th>
            </tr>
        </thead>
    );

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2"><Trophy className="text-orange-500"/> 颁发管理 (Issuance Management)</h3>

            {detachedList.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
                    {/* 文字色只用 amber-700：深色主题的映射只覆盖 amber-600/700（见 index.css），
                        amber-800 在深色下是暗琥珀落在深底上，会看不见 */}
                    <div className="flex items-start gap-3 text-amber-700">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                        <div className="text-sm">
                            <div className="font-bold">有 {detachedList.length} 条已失效的颁发记录</div>
                            <div className="text-xs text-amber-700 mt-0.5">
                                这些记录对应的奖状已被删除，因此不再随奖状展示，但记录本身保留了下来（凭据留痕）。
                                确认不再需要时可一键清理。
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handlePurgeDetached}
                        disabled={purging}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-60 shrink-0"
                    >
                        <Trash2 size={14}/> {purging ? '清理中…' : `一键清理 ${detachedList.length} 条`}
                    </button>
                </div>
            )}

            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-700">有效颁发</h4>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{activeList.length}</span>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                    <table className="w-full text-left">
                        {tableHead}
                        <tbody className="divide-y">
                            {activeList.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-slate-400">暂无颁发记录</td></tr>}
                            {activeList.map(renderRow)}
                        </tbody>
                    </table>
                </div>
            </div>

            {detachedList.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <h4 className="font-bold text-amber-700">已失效（原奖状已删除）</h4>
                        <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{detachedList.length}</span>
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
                        <table className="w-full text-left">
                            {tableHead}
                            <tbody className="divide-y">
                                {detachedList.map(renderRow)}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// 4. Award Designer (Updated for Full Collection Checkbox)
const AwardDesigner = ({ initData, onClose }) => {
    // Basic UI States
    const [step, setStep] = useState(1);
    const [bgUrl, setBgUrl] = useState(initData?.bg_url || '');
    // 可视化布局（v2 schema，单位 mm）。旧数据（[] 或旧结构）会被归一化成空布局。
    // ★ 新建（或历史数据里布局为空）时直接载入**预设模板**：标题 / 呼号 / 等级 /
    //   证书编号 / 签发日期 / 颁发机构 / 校验二维码 / 双线边框，打开即可用。
    //   已有元素的奖状照旧读自己的布局，不会被模板覆盖。
    const [layout, setLayout] = useState(() => {
        const saved = normalizeLayout(initData?.layout, initData?.bg_url);
        return saved.elements.length > 0 ? saved : presetAwardLayout(initData?.bg_url || '');
    });
    
    // Initial Rule Structure (Complex V2)
    const defaultRules = {
        v2: true, // Marker for new rule system
        basic: { startDate: '', endDate: '', qslRequired: true }, // 2. Default QSL Required to true
        filters: [], // [{ field, operator, value }]
        logic: 'collection', // 'collection' or 'points'
        targets: { type: 'any', list: '' }, // type: any, callsign, dxcc, grid, etc.
        scoring: { cw: 1, phone: 1, data: 1, multis: [] },
        deduplication: 'none', // none, call, call_band, qso, state, custom
        deduplicationCustomField: '',
        thresholds: [{ name: 'Award', value: 1, color: '#eab308', fullCollection: false }]
    };

    // Migrate old rules or use init
    const [rules, setRules] = useState(() => {
        if (!initData?.rules) return defaultRules;
        if (Array.isArray(initData.rules)) return { ...defaultRules, filters: initData.rules }; // Migrate V1
        return { ...defaultRules, ...initData.rules };
    });

    const [meta, setMeta] = useState({ name: initData?.name || '', description: initData?.description || '' });

    const saveAward = async (status) => {
        try {
            if (!meta.name) throw new Error("请输入奖状名称");

            // ★ 底图**不再必填**（2026-09-24 用户要求）：没有底图时就是「白底 + 元素排版」，
            //   默认模板本身已含双线边框与全部字段，完全可用，不该拦着不让存草稿。
            const finalBgUrl = layout.canvas?.bgUrl || bgUrl || '';
            const elementCount = (layout.elements || []).length;

            // ★ 保存前检测外站图片：跨域会污染 canvas 导致导出失败 + 随时可能失效
            const external = collectExternalImages({
                ...layout,
                canvas: { ...layout.canvas, bgUrl: finalBgUrl },
            });
            if (external.length) {
                const shown = external.slice(0, 3).join('\n');
                const more = external.length > 3 ? `\n…另有 ${external.length - 3} 张` : '';
                const ok = await confirmDialog({
                    title: '检测到外站图片',
                    message: `共 ${external.length} 张图片来自外部网站：\n${shown}${more}`,
                    detail: '这些图片可能导致：\n· 导出 PDF 时因跨域而失败或缺图\n· 图片随时失效（对方删除 / 更换防盗链）\n\n强烈建议改为上传到本站。',
                    confirmText: '仍要保存',
                });
                if (!ok) return; // 用户选择返回修改，不保存
            }

            // ★ 提交审核是"离开自己手里"的不可逆动作：最后再确认一次
            if (status === 'pending') {
                const go = await confirmDialog({
                    title: '提交审核',
                    message: `确认提交「${meta.name}」进入审核？`,
                    detail: finalBgUrl
                        ? '提交后管理员会收到待审提醒，审核期间这份奖状不能再编辑；若被退回，可在「草稿箱 → 打回草稿」修改后重新提交。'
                        : `⚠️ 这份奖状还没有底图，将以「白色背景 + ${elementCount} 个元素」呈现（默认模板的边框与文字都还在）。\n提交后管理员会收到待审提醒，审核期间不能再编辑；若被退回，可在「草稿箱 → 打回草稿」修改后重新提交。`,
                    confirmText: '提交审核',
                });
                if (!go) return;
            }

            await apiFetch('/awards', {
                method: 'POST',
                body: JSON.stringify({
                    id: initData?.id,
                    name: meta.name,
                    description: meta.description,
                    bg_url: finalBgUrl || null,
                    rules,
                    layout: { ...layout, canvas: { ...layout.canvas, bgUrl: finalBgUrl } },
                    status
                })
            });
            alert(status === 'draft' ? '草稿已保存' : '已提交审核');
            onClose();
        } catch(err) { alert(err.message || err.error || '保存失败'); }
    };

    // Steps Configuration
    const steps = [
        { id: 1, label: '基本信息', icon: Info },
        { id: 2, label: '规则配置', icon: Settings },
        { id: 3, label: '视觉设计', icon: Crop } 
    ];

    const hasSpecificTargets = rules.targets.type !== 'any';

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-slate-100">
                    <div className="flex items-center gap-4">
                        <h2 className="font-bold text-lg">{initData?.id ? '编辑奖状' : '新建奖状'}</h2>
                        <div className="flex bg-white rounded-lg p-1 border">
                            {steps.map(s => (
                                <button key={s.id} onClick={()=>setStep(s.id)} className={`flex items-center gap-2 px-3 py-1 rounded text-sm transition-all ${step===s.id ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>
                                    <s.icon size={14}/> {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={onClose}><X /></button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Step 1: Basic Info */}
                    {step === 1 && (
                        <div className="flex-1 p-8 overflow-y-auto max-w-3xl mx-auto w-full space-y-6">
                            <h3 className="text-xl font-bold border-b pb-4 mb-6">基本信息</h3>

                            {/* 创建指引：与前端必填校验（名称/底图）及后端审核流转保持一致 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                                    <Info size={15} /> 创建指引
                                </div>
                                <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                                    <li>共三步：基本信息 → 规则配置 → 视觉设计，可随时点顶部标签切换。</li>
                                    <li><b>奖状名称</b>为必填项；<b>底图是可选的</b> —— 不上传就是「白色背景 + 元素排版」，
                                        默认模板的双线边框与全部字段都还在，可以直接保存草稿；也可以在视觉设计里一键套用「内置底图」。</li>
                                    <li>提交后进入管理员审核；若被打回，可在「草稿箱 → 打回草稿」查看原因，修改后重新提交。</li>
                                    <li>底图与素材须为你有权使用的图片与字体（勿用未授权商业字体）。</li>
                                </ul>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">奖状名称</label>
                                    <input className="w-full p-3 border rounded-xl" value={meta.name} onChange={e=>setMeta({...meta, name:e.target.value})} placeholder="例如: 2024 年度 DX 大师奖"/>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">描述说明</label>
                                    <textarea className="w-full p-3 border rounded-xl h-32" value={meta.description} onChange={e=>setMeta({...meta, description:e.target.value})} placeholder="奖状的简介、颁发机构等..."/>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">开始日期 (可选)</label>
                                        <input type="date" className="w-full p-3 border rounded-xl" value={rules.basic.startDate} onChange={e=>setRules({...rules, basic: {...rules.basic, startDate: e.target.value}})} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">结束日期 (可选)</label>
                                        <input type="date" className="w-full p-3 border rounded-xl" value={rules.basic.endDate} onChange={e=>setRules({...rules, basic: {...rules.basic, endDate: e.target.value}})} />
                                    </div>
                                </div>
                                <label className="flex items-center gap-3 p-4 border rounded-xl bg-slate-50 cursor-pointer">
                                    <input type="checkbox" checked={rules.basic.qslRequired} onChange={e=>setRules({...rules, basic: {...rules.basic, qslRequired: e.target.checked}})} className="w-5 h-5"/>
                                    <div>
                                        <div className="font-bold">仅限已确认 QSO (QSL Required)</div>
                                        <div className="text-xs text-slate-500">勾选后，只有 LotW 或实物卡片确认的记录才参与计算</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Advanced Rules Engine */}
                    {step === 2 && (
                        <div className="flex-1 flex h-full">
                            <div className="w-64 bg-slate-50 border-r p-4 space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2">配置模块</div>
                                {['filters', 'logic', 'scoring', 'threshold'].map(m => (
                                    <button key={m} onClick={()=>document.getElementById(`mod-${m}`).scrollIntoView({behavior:'smooth'})} className="block w-full text-left px-4 py-2 rounded hover:bg-white text-sm font-medium text-slate-600">
                                        {m==='filters'?'1. 筛选条件':m==='logic'?'2. 逻辑与目标':m==='scoring'?'3. 计分规则':'4. 达标阈值'}
                                    </button>
                                ))}
                            </div>
                            <div className="flex-1 p-8 overflow-y-auto space-y-10">
                                {/* Filters */}
                                <section id="mod-filters" className="space-y-4">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Filter className="text-blue-500"/> 1. 有效 QSO 筛选条件</h4>
                                    <div className="bg-slate-50 p-4 rounded-xl border space-y-2">
                                        <div className="text-xs text-slate-400 mb-2">💡 提示：如需匹配任意值（如任意波段），请留空或输入 ANY。</div>
                                        {rules.filters.map((f, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                {/* Updated to Select */}
                                                <select className="w-1/3 p-2 border rounded text-sm" value={f.field} onChange={e=>{const n=[...rules.filters];n[idx].field=e.target.value;setRules({...rules, filters:n})}}>
                                                    <option value="" disabled>选择字段</option>
                                                    <option value="band">波段 (BAND)</option>
                                                    <option value="mode">模式 (MODE)</option>
                                                    <option value="call">对方呼号 (CALL)</option>
                                                    <option value="dxcc">DXCC ID</option>
                                                    <option value="state">州/省 (STATE)</option>
                                                    <option value="gridsquare">网格 (GRIDSQUARE)</option>
                                                    <option value="iota">IOTA</option>
                                                    <option value="freq">频率 (FREQ)</option>
                                                    <option value="station_callsign">己方呼号 (STATION_CALLSIGN)</option>
                                                </select>
                                                <select className="p-2 border rounded text-sm" value={f.operator} onChange={e=>{const n=[...rules.filters];n[idx].operator=e.target.value;setRules({...rules, filters:n})}}>
                                                    <option value="eq">等于 (=)</option><option value="neq">不等于 (!=)</option><option value="gt">大于 (&gt;)</option><option value="contains">包含</option>
                                                </select>
                                                <input className="flex-1 p-2 border rounded text-sm" placeholder="值 (如 20M)" value={f.value} onChange={e=>{const n=[...rules.filters];n[idx].value=e.target.value;setRules({...rules, filters:n})}}/>
                                                <button onClick={()=>setRules({...rules, filters: rules.filters.filter((_,i)=>i!==idx)})} className="text-red-500"><Trash2 size={16}/></button>
                                            </div>
                                        ))}
                                        <button onClick={()=>setRules({...rules, filters: [...rules.filters, {field:'band', operator:'eq', value:''}]})} className="text-sm font-bold text-blue-600">+ 添加筛选条件</button>
                                    </div>
                                </section>

                                {/* Logic & Targets */}
                                <section id="mod-logic" className="space-y-4">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Target className="text-purple-500"/> 2. 核心逻辑与目标对象</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 border rounded-xl hover:border-blue-500 cursor-pointer transition-all" onClick={()=>setRules({...rules, logic: 'collection'})} style={{borderColor: rules.logic==='collection'?'#3b82f6':''}}>
                                            <div className="font-bold mb-1">📦 收集型 (Collection)</div>
                                            <div className="text-xs text-slate-500">统计唯一目标的数量 (如: 100个 DXCC，50个网格)</div>
                                        </div>
                                        <div className="p-4 border rounded-xl hover:border-blue-500 cursor-pointer transition-all" onClick={()=>setRules({...rules, logic: 'points'})} style={{borderColor: rules.logic==='points'?'#3b82f6':''}}>
                                            <div className="font-bold mb-1">🔢 计分型 (Points)</div>
                                            <div className="text-xs text-slate-500">基于分值的累加 (如: CW 10分，总分 500分)</div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 p-4 rounded-xl border">
                                        <label className="block text-sm font-bold mb-2">目标对象类型</label>
                                        <select className="w-full p-2 border rounded mb-2" value={rules.targets.type} onChange={e=>setRules({...rules, targets: {...rules.targets, type: e.target.value}})}>
                                            <option value="any">任意 QSO (仅依靠筛选)</option>
                                            <option value="callsign">特定呼号列表</option>
                                            <option value="dxcc">特定 DXCC 实体</option>
                                            <option value="grid">特定网格 (Grid)</option>
                                            <option value="iota">特定 IOTA</option>
                                            <option value="state">特定州/省 (State)</option>
                                        </select>
                                        {['callsign', 'dxcc', 'grid', 'iota', 'state'].includes(rules.targets.type) && (
                                            <textarea 
                                                className="w-full p-2 border rounded h-24 text-sm font-mono" 
                                                placeholder="输入目标列表，用逗号分隔 (例如: BA1AA, BA4AA, BY1CRA...)"
                                                value={rules.targets.list}
                                                onChange={e=>setRules({...rules, targets: {...rules.targets, list: e.target.value}})}
                                            />
                                        )}
                                    </div>
                                </section>

                                {/* Scoring & Deduplication */}
                                <section id="mod-scoring" className="space-y-4">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Calculator className="text-green-500"/> 3. 计分与去重</h4>
                                    {rules.logic === 'points' && (
                                        <div className="grid grid-cols-3 gap-4 mb-4">
                                            {['cw', 'phone', 'data'].map(m => (
                                                <div key={m} className="bg-slate-50 p-3 rounded-lg border text-center">
                                                    <div className="text-xs text-slate-500 uppercase font-bold mb-1">{m} 分值</div>
                                                    <input type="number" className="w-full text-center p-1 border rounded" value={rules.scoring[m]} onChange={e=>setRules({...rules, scoring: {...rules.scoring, [m]: parseFloat(e.target.value)}})} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                                        <label className="block text-sm font-bold mb-2">去重规则 (Deduplication)</label>
                                        <select className="w-full p-2 border rounded" value={rules.deduplication} onChange={e=>setRules({...rules, deduplication: e.target.value})}>
                                            <option value="none">不去重 (所有有效 QSO 均计算)</option>
                                            <option value="call">按呼号去重 (每个呼号只计一次)</option>
                                            <option value="call_band">按呼号+波段去重 (每个呼号每个波段计一次)</option>
                                            <option value="slot">按 Slot 去重 (呼号+波段+模式)</option>
                                            <option value="state">按州/省去重 (State)</option>
                                            <option value="custom">按自定义字段去重</option>
                                        </select>
                                        {rules.deduplication === 'custom' && (
                                            <input 
                                                className="w-full p-2 border rounded bg-white" 
                                                placeholder="输入 ADIF 字段名 (例如: cnty)" 
                                                value={rules.deduplicationCustomField}
                                                onChange={e=>setRules({...rules, deduplicationCustomField: e.target.value})}
                                            />
                                        )}
                                    </div>
                                </section>

                                {/* Threshold */}
                                <section id="mod-threshold" className="space-y-4">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Trophy className="text-yellow-500"/> 4. 达标等级 (Thresholds)</h4>
                                    <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 space-y-3">
                                        <p className="text-xs text-yellow-800 mb-2">设置不同的奖项等级（如金、银、铜），系统将自动判定最高达成等级。</p>
                                        {(rules.thresholds || [{name: 'Award', value: 1}]).map((t, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <input 
                                                    className="flex-1 p-2 border rounded text-sm" 
                                                    placeholder="等级名称 (如: Gold)" 
                                                    value={t.name}
                                                    onChange={e=>{const n=[...rules.thresholds];n[idx].name=e.target.value;setRules({...rules, thresholds:n})}}
                                                />
                                                
                                                <div className="flex items-center gap-1">
                                                    <span className="font-bold text-yellow-800 text-sm">分数:</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-16 p-2 border rounded text-center font-bold" 
                                                        value={t.value}
                                                        onChange={e=>{const n=[...rules.thresholds];n[idx].value=parseFloat(e.target.value);setRules({...rules, thresholds:n})}}
                                                    />
                                                </div>

                                                {/* 3. 全收集独立选项 */}
                                                {hasSpecificTargets && (
                                                    <label className="flex items-center gap-1 bg-white px-2 py-1 rounded border cursor-pointer select-none">
                                                        <input 
                                                            type="checkbox"
                                                            checked={!!t.fullCollection}
                                                            onChange={e=>{const n=[...rules.thresholds];n[idx].fullCollection=e.target.checked;setRules({...rules, thresholds:n})}}
                                                            className="w-4 h-4 text-blue-600 rounded"
                                                        />
                                                        <span className="text-xs font-bold text-slate-600">必须全收集</span>
                                                    </label>
                                                )}
                                                
                                                {/* Color Picker for Badge */}
                                                <div className="flex items-center gap-1 border p-1 rounded bg-white">
                                                    <input 
                                                        type="color" 
                                                        className="w-6 h-6 p-0 border-0 rounded cursor-pointer" 
                                                        value={t.color || '#eab308'}
                                                        onChange={e=>{const n=[...rules.thresholds];n[idx].color=e.target.value;setRules({...rules, thresholds:n})}}
                                                        title="设置奖状角标底色"
                                                    />
                                                </div>

                                                <button onClick={()=>{
                                                    if (rules.thresholds.length > 1) {
                                                        setRules({...rules, thresholds: rules.thresholds.filter((_,i)=>i!==idx)});
                                                    }
                                                }} className="text-red-500 p-2"><Trash2 size={16}/></button>
                                            </div>
                                        ))}
                                        <button onClick={()=>setRules({...rules, thresholds: [...(rules.thresholds || []), {name: 'Level ' + ((rules.thresholds?.length||0)+1), value: 0, color: '#3b82f6'}]})} className="text-sm font-bold text-yellow-700 flex items-center gap-1">
                                            <Plus size={14}/> 添加等级
                                        </button>
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Visual Design（可视化拖拽布局） */}
                    {step === 3 && (
                        <VisualDesigner
                            layout={layout}
                            awardName={meta.name}
                            levels={(rules.thresholds || []).map(t => t.name).filter(Boolean)}
                            onChange={(next) => {
                                setLayout(next);
                                setBgUrl(next.canvas?.bgUrl || bgUrl);
                            }}
                        />
                    )}

                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-slate-50 flex justify-between items-center gap-6">
                    <div className="flex-1 text-xs text-slate-400 space-y-1">
                        <div className="flex items-start gap-1.5 text-amber-600">
                            <Info size={13} className="mt-0.5 shrink-0" />
                            <span>
                                保存或提交即表示你确认：奖状名称、描述、底图等内容<b>不含违反法律法规或侵犯他人权益的信息</b>，
                                否则奖状可被下架、撤回或删除账号。
                                <a href="#/protocol" target="_blank" rel="noreferrer" className="ml-1 underline hover:text-amber-500">查看《内容规范》</a>
                            </span>
                        </div>
                        {step === 3 && (
                            <div>提示: 拖动元素调整位置，右侧面板编辑属性；保存时会把当前布局一并写入奖状。</div>
                        )}
                    </div>
                    <div className="flex gap-4">
                        <button onClick={()=>saveAward('draft')} className="px-6 py-2 border rounded-lg font-bold text-slate-600">保存草稿</button>
                        <button onClick={()=>saveAward('pending')} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold">提交审核</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 5. User Center (Same as provided, kept intact)
const UserCenterView = ({ user, refreshUser, onLogout }) => {
    const [modal, setModal] = useState(null); 
    const [qr, setQr] = useState('');
    const [secret, setSecret] = useState('');
    const [code, setCode] = useState('');
    const [passForm, setPassForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [confirmActionPass, setConfirmActionPass] = useState('');
    const [qsoCount, setQsoCount] = useState(null);
    const [roleReq, setRoleReq] = useState(null);
    const [roleReqSubmitting, setRoleReqSubmitting] = useState(false);
    const [showRoleReqForm, setShowRoleReqForm] = useState(false);
    const [roleReqForm, setRoleReqForm] = useState({ award_name: '', reason: '', experience: '', contact: '' });

    const loadStats = () => {
        apiFetch('/stats/dashboard').then((s) => setQsoCount(Number(s.qsos) || 0)).catch(() => {});
    };
    useEffect(loadStats, []);

    const loadRoleReq = () => {
        apiFetch('/user/role-request').then(setRoleReq).catch(() => {});
    };
    useEffect(() => { if (user.role === 'user') loadRoleReq(); }, [user.role]);

    const handleRoleRequest = async (e) => {
        e.preventDefault();
        const ok = await confirmDialog({
            title: '提交角色升级申请',
            message: '确认提交成为「奖状管理员」的申请？',
            detail: `拟创建奖状：${roleReqForm.award_name || '—'}\n申请理由：${String(roleReqForm.reason || '').slice(0, 150)}\n\n提交后管理员会收到提醒；同一时间只能有一份待审申请。`,
            confirmText: '提交申请',
        });
        if (!ok) return;
        setRoleReqSubmitting(true);
        try {
            await apiFetch('/user/role-request', { method: 'POST', body: JSON.stringify(roleReqForm) });
            setRoleReq({ status: 'pending' });
            setShowRoleReqForm(false);
            setRoleReqForm({ award_name: '', reason: '', experience: '', contact: '' });
            alert('申请已提交，请等待管理员审核');
        } catch (err) {
            alert(err.message || '提交失败');
        } finally {
            setRoleReqSubmitting(false);
        }
    };

    const start2FASetup = async () => {
        try {
            const res = await apiFetch('/user/2fa/setup', { method: 'POST' });
            setSecret(res.secret); setQr(res.qr); setModal('2fa_setup');
        } catch(err) { alert(err.message); }
    };

    const confirm2FA = async () => {
        try {
            await apiFetch('/user/2fa/enable', { method: 'POST', body: JSON.stringify({ secret, token: code }) });
            alert('2FA 已成功开启！'); setModal(null); refreshUser();
        } catch(err) { alert(err.message); }
    };

    const disable2FA = async () => {
        try {
            await apiFetch('/user/2fa/disable', { method: 'POST', body: JSON.stringify({ password: confirmActionPass }) });
            alert('2FA 已关闭'); setModal(null); refreshUser();
        } catch(err) { alert(err.message); }
    };

    const changePassword = async () => {
        if(passForm.newPassword !== passForm.confirmPassword) return alert('两次输入的新密码不一致');
        try {
            if (user.has2fa) {
                const c = prompt('请输入 2FA 验证码以确认修改密码:');
                if(!c) return;
                sessionStorage.setItem('temp_2fa_code', c);
            }
            await apiFetch('/user/password', { method: 'POST', body: JSON.stringify(passForm) });
            alert('密码修改成功'); setModal(null);
        } catch(err) { alert(err.message); }
    };

    const handleDangerousAction = async (action) => {
        const isDeleteAccount = action === 'delete_account';
        const ok = await confirmDialog({
            title: isDeleteAccount ? '注销账号' : '清空通联日志',
            message: isDeleteAccount ? '确认注销你的账号？' : '确认清空你上传的全部通联日志（QSO）？',
            detail: isDeleteAccount
                ? '账号、通联日志、申领记录与实物材料记录会被永久删除且无法恢复；你创建的奖状会变成「无主」状态。'
                : '清空后需要重新上传 ADIF 或重新连 LoTW 才能继续判定奖状，此操作不可恢复。',
            confirmText: isDeleteAccount ? '继续注销' : '确认清空',
            danger: true,
        });
        if (!ok) return;
        try {
            if (user.has2fa) {
                const c = prompt('请输入 2FA 验证码以确认:');
                if(!c) return;
                sessionStorage.setItem('temp_2fa_code', c);
            }
            const url = action === 'clear_logs' ? '/user/logs' : '/user/account';
            await apiFetch(url, { 
                method: 'DELETE', 
                body: JSON.stringify({ password: confirmActionPass }) 
            });
            
            if (action === 'delete_account') {
                alert('账号已注销');
                onLogout();
            } else {
                alert('操作成功');
                setModal(null);
                if (action === 'clear_logs') loadStats();
            }
        } catch (err) { alert(err.message); }
    };

    return (
        <div className="max-w-3xl space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2"><User className="text-blue-600"/> 用户中心</h3>
            <div className="bg-white p-6 rounded-2xl shadow-sm border">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-2xl font-black text-slate-400">{user.callsign.substring(0,2)}</div>
                    <div>
                        <div className="text-2xl font-bold">{user.callsign}</div>
                        <div className="text-slate-500 text-sm">角色: {user.role}</div>
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border">
                <h4 className="font-bold text-lg mb-4 flex items-center gap-2"><ShieldCheck className="text-green-600"/> 安全设置</h4>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3"><Key className="text-slate-400" /><div><div className="font-bold">登录密码</div></div></div>
                        <button onClick={() => setModal('password')} className="bg-white border px-4 py-2 rounded-lg text-sm font-bold">修改密码</button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3"><Lock className={user.has2fa ? "text-green-500" : "text-slate-400"} /><div><div className="font-bold">两步验证 (2FA)</div><div className="text-xs text-slate-400">{user.has2fa ? '已开启' : '未开启'}</div></div></div>
                        {user.has2fa ? (
                            <button onClick={() => setModal('2fa_disable')} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-bold">关闭</button>
                        ) : (
                            <button onClick={start2FASetup} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">开启</button>
                        )}
                    </div>
                </div>
            </div>
            {user.role === 'user' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                    <h4 className="font-bold text-lg mb-2 flex items-center gap-2"><Trophy className="text-purple-600"/> 角色权限</h4>
                    <p className="text-xs text-slate-400 mb-4">当前为「普通用户」。申请成为「奖状管理员」后可创建与管理奖状，需系统管理员审核。</p>
                    {!roleReq || roleReq.status === 'rejected' ? (
                        <button onClick={() => setShowRoleReqForm(true)} className="bg-purple-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-purple-700">
                            申请成为奖状管理员
                        </button>
                    ) : roleReq.status === 'pending' ? (
                        <div className="text-sm text-amber-600 bg-amber-50 px-4 py-2.5 rounded-lg">申请已提交，等待管理员审核…</div>
                    ) : (
                        <div className="text-sm text-green-600 bg-green-50 px-4 py-2.5 rounded-lg">申请已通过，重新登录后生效。</div>
                    )}
                </div>
            )}
            {showRoleReqForm && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <form onSubmit={handleRoleRequest} className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                        <h4 className="font-bold text-lg text-slate-800">申请成为奖状管理员</h4>
                        <p className="text-xs text-slate-400">请填写以下信息，系统管理员会据此审核你的申请。</p>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">拟创建的奖状名称 *</label>
                            <input value={roleReqForm.award_name} onChange={(e) => setRoleReqForm({ ...roleReqForm, award_name: e.target.value })} required placeholder="例如: 中国通联成就奖" className="w-full border rounded-lg p-3" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">申请理由 *</label>
                            <textarea value={roleReqForm.reason} onChange={(e) => setRoleReqForm({ ...roleReqForm, reason: e.target.value })} required rows={3} placeholder="说明你为什么想创建这个奖状、规则设想等" className="w-full border rounded-lg p-3" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">经验 / 背景说明</label>
                            <textarea value={roleReqForm.experience} onChange={(e) => setRoleReqForm({ ...roleReqForm, experience: e.target.value })} rows={2} placeholder="例如: 业余无线电操作年限、参与过的活动、组织经验等" className="w-full border rounded-lg p-3" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">联系方式</label>
                            <input value={roleReqForm.contact} onChange={(e) => setRoleReqForm({ ...roleReqForm, contact: e.target.value })} placeholder="邮箱 / 微信 / 电话，便于必要时沟通" className="w-full border rounded-lg p-3" />
                        </div>
                        <button type="submit" disabled={roleReqSubmitting} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-60">
                            {roleReqSubmitting ? '提交中…' : '提交申请'}
                        </button>
                        <button type="button" onClick={() => setShowRoleReqForm(false)} className="w-full text-slate-400 text-sm text-center">取消</button>
                    </form>
                </div>
            )}
            {user.role === 'user' && (
                 <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100">
                    <h4 className="font-bold text-lg mb-4 flex items-center gap-2 text-red-600"><AlertCircle/> 危险区域</h4>
                    <div className="space-y-4">
                        <div className={`flex items-center justify-between p-4 rounded-xl ${qsoCount > 0 ? 'bg-red-50/50' : 'bg-slate-50'}`}>
                            <div>
                                <div className={`font-bold ${qsoCount > 0 ? 'text-red-800' : 'text-slate-500'}`}>清空所有日志</div>
                                <div className={`text-xs ${qsoCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                    {qsoCount == null ? '加载中…' : (qsoCount > 0 ? `将永久删除您上传的 ${qsoCount} 条 QSO 记录` : '当前没有日志记录')}
                                </div>
                            </div>
                            <button
                                onClick={() => setModal('clear_logs')}
                                disabled={!qsoCount}
                                className={`px-4 py-2 rounded-lg text-sm font-bold ${qsoCount > 0 ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                            >清空日志</button>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-red-50/50 rounded-xl">
                            <div><div className="font-bold text-red-800">注销账号</div><div className="text-xs text-red-600">将永久删除您的账号及所有数据，无法恢复</div></div>
                            <button onClick={() => setModal('delete_account')} className="bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold">注销账号</button>
                        </div>
                    </div>
                 </div>
            )}
            {modal && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 relative z-[101]">
                        <div className="flex justify-between items-center border-b pb-4">
                            <h3 className="font-bold text-lg">{modal === 'password' ? '修改密码' : modal === '2fa_setup' ? '配置 2FA' : '安全确认'}</h3>
                            <button onClick={()=>{setModal(null); setQr('');}}><X size={20}/></button>
                        </div>
                        {modal === 'password' && (
                            <div className="space-y-4">
                                <PasswordInput placeholder="当前密码" autoComplete="current-password" className="w-full border p-3 rounded-lg" onChange={e=>setPassForm({...passForm, oldPassword: e.target.value})} />
                                <PasswordInput placeholder="新密码" autoComplete="new-password" className="w-full border p-3 rounded-lg" onChange={e=>setPassForm({...passForm, newPassword: e.target.value})} />
                                <PasswordInput placeholder="确认新密码" autoComplete="new-password" className="w-full border p-3 rounded-lg" onChange={e=>setPassForm({...passForm, confirmPassword: e.target.value})} />
                                <button onClick={changePassword} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold">确认修改</button>
                            </div>
                        )}
                        {modal === '2fa_setup' && (
                            <div className="space-y-4 text-center">
                                <div className="flex justify-center bg-white p-2 border rounded-lg">
                                    {qr ? <img src={qr} alt="2FA QR" className="w-48 h-48"/> : <div>Loading...</div>}
                                </div>
                                <input placeholder="6 位验证码" className="w-full border p-3 rounded-lg text-center font-mono text-xl" maxLength={6} onChange={e=>setCode(e.target.value)} />
                                <button onClick={confirm2FA} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold">验证开启</button>
                            </div>
                        )}
                        {(modal === '2fa_disable' || modal === 'clear_logs' || modal === 'delete_account') && (
                            <div className="space-y-4">
                                <p className="text-sm bg-red-50 text-red-600 p-3 rounded-lg">
                                    {modal === '2fa_disable' ? '警告：关闭 2FA 将降低账户安全性。' : '此操作不可逆，请输入登录密码以确认。'}
                                </p>
                                <PasswordInput placeholder="登录密码" autoComplete="current-password" className="w-full border p-3 rounded-lg" onChange={e=>setConfirmActionPass(e.target.value)} />
                                <button onClick={() => {
                                    if(modal==='2fa_disable') disable2FA();
                                    else handleDangerousAction(modal);
                                }} className="w-full bg-red-600 text-white py-3 rounded-lg font-bold">确认执行</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// 6. Logbook View (Same as provided, kept intact)
const LogbookView = () => {
    // 4. 普通用户界面中，全部日志应与日志管理同级显示 -> This component now only handles UPLOAD.
    // List view logic moved to 'AllLogsView'
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [stats, setStats] = useState(null);

    const handleUpload = async (e) => {
        e.preventDefault();
        if(!file) return;
        const ok = await confirmDialog({
            title: '导入通联日志',
            message: `确认导入「${file.name}」？`,
            detail: '导入会把 QSO 记录写入本站数据库（会占用服务器存储）；按「呼号+波段+模式+日期」判重，重复记录自动跳过。',
            confirmText: '导入',
        });
        if (!ok) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await apiFetch('/logbook/upload', { method: 'POST', body: formData });
            setStats(res);
            alert(`成功导入 ${res.imported} 条 QSO 记录`);
        } catch (err) { alert(err.message); } finally { setUploading(false); }
    };

    return (
        <div className="space-y-6">
            <h3 className="font-bold text-lg flex items-center gap-2"><Upload className="text-blue-600"/> 上传日志 (ADIF)</h3>
            <div className="bg-white p-6 rounded-2xl shadow-sm border">
                <form onSubmit={handleUpload} className="space-y-4">
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors">
                        <input type="file" accept=".adi,.adif" onChange={e => setFile(e.target.files[0])} className="hidden" id="adif-input" />
                        <label htmlFor="adif-input" className="cursor-pointer block">
                            <Database size={48} className="mx-auto text-slate-400 mb-2"/>
                            <div className="text-slate-600 font-medium">{file ? file.name : "点击选择或拖拽 ADIF 文件"}</div>
                        </label>
                    </div>
                    {uploading && <div className="text-center text-blue-600 font-bold animate-pulse">正在解析并导入数据...</div>}
                    <button disabled={!file || uploading} className="bg-blue-600 text-white w-full py-3 rounded-xl font-bold disabled:opacity-50">
                        {uploading ? '处理中...' : '开始上传'}
                    </button>
                </form>
                {stats && (
                    <div className="mt-6 p-4 bg-green-50 text-green-800 rounded-xl flex items-center gap-3">
                        <CheckCircle size={20} />
                        <span>本次解析 {stats.count} 条记录，成功入库 {stats.imported} 条 (去重后)。</span>
                    </div>
                )}
            </div>
        </div>
    );
};

// New: All Logs View (Separated from LogbookView - Fixed data loading issue)

/**
 * 把一条 QSO 行格式化成「DXCC 实体名 · 编号」短串。
 * 后端 (/api/user/qsos) 已经按 cty.dat 实时反查过 country/dxcc 了；
 * 旧记录或卡片补建的记录没字段时会显示 "—" 而不是 "未填"。
 * 命名约定：「Country」列全部改名「DXCC」，理由：
 *   - Country 这个词对"ham 语境"容易和实际操作国家混淆；
 *   - DXCC 才是奖状 / LoTW / ADIF 通用的"实体编号"概念，跨字段都对得上。
 */
const formatDxcc = (row) => {
    const name = (row?.country || '').trim();
    const num = (row?.dxcc || '').trim();
    if (!name && !num) return '—';
    if (name && num) return `${name} · ${num}`;
    return name || num;
};

const AllLogsView = () => {
    const [logs, setLogs] = useState([]);
    const [detailQso, setDetailQso] = useState(null);
    const [qsoAwards, setQsoAwards] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        // Added timestamp to prevent caching
        apiFetch(`/user/qsos?t=${new Date().getTime()}`)
            .then(data => {
                // Ensure data is an array
                if (Array.isArray(data)) setLogs(data);
                else setLogs([]);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const showQsoDetails = async (qso) => {
        setDetailQso(qso);
        setQsoAwards([]);
        try {
            const awards = await apiFetch(`/qsos/${qso.id}/awards`);
            setQsoAwards(awards);
        } catch(e) { console.error(e); }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-lg flex items-center gap-2"><List className="text-blue-600"/> 全部日志</h3>
                <div className="flex items-center gap-3">
                    {/* 实物卡片审核通过后会自动补一条日志（前提是材料填了通联日期），这里给个刷新入口 */}
                    <span className="text-xs text-slate-400">实物卡片审核通过后会自动补建日志（需材料填写通联日期）</span>
                    <button
                        onClick={load}
                        className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                        刷新
                    </button>
                </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 font-bold border-b">
                            <tr>
                                <th className="p-4 w-24">操作</th>
                                <th className="p-4">Date</th>
                                <th className="p-4">Callsign</th>
                                <th className="p-4">Band</th>
                                <th className="p-4">Mode</th>
                                <th className="p-4">DXCC</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {loading ? (
                                <tr><td colSpan="6" className="p-8 text-center text-slate-400">加载中...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan="6" className="p-8 text-center text-slate-400">暂无日志</td></tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="hover:bg-slate-50">
                                        <td className="p-4">
                                            {/* 3. 每条日志前增设一列按钮，点击后可以查看详细通联信息及参与申领的奖项 */}
                                            <button onClick={()=>showQsoDetails(log)} className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 border border-blue-200">详情</button>
                                        </td>
                                        <td className="p-4 font-mono">{log.qso_date}</td>
                                        <td className="p-4 font-bold">
                                            {log.callsign}
                                            {/* 来源标记：这条是"实物卡片审核通过"时自动补建的（不是 ADIF 导入的） */}
                                            {log.adif_raw?.source === 'evidence' && (
                                                <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 align-middle text-[10px] font-bold text-emerald-700">
                                                    实物卡片
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4">{log.band}</td>
                                        <td className="p-4">{log.mode}</td>
                                        {/* 实物卡片补建的日志没有国家字段（卡片不采集），显式显示"—"免得看着像加载失败 */}
                                        <td className="p-4 text-slate-500 truncate max-w-[200px]">{formatDxcc(log)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {detailQso && (
                <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg p-6 relative">
                        <button onClick={()=>setDetailQso(null)} className="absolute top-4 right-4 text-slate-400 hover:text-black"><X/></button>
                        <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Database className="text-blue-500"/> QSO 详情</h3>
                        
                        <div className="bg-slate-50 p-4 rounded-xl border grid grid-cols-2 gap-4 mb-6 text-sm">
                            <div><span className="text-slate-400 block text-xs uppercase">Callsign</span><span className="font-bold text-lg">{detailQso.callsign}</span></div>
                            <div><span className="text-slate-400 block text-xs uppercase">Date</span><span className="font-bold">{detailQso.qso_date}</span></div>
                            <div><span className="text-slate-400 block text-xs uppercase">Band</span><span className="font-bold">{detailQso.band}</span></div>
                            <div><span className="text-slate-400 block text-xs uppercase">Mode</span><span className="font-bold">{detailQso.mode}</span></div>
                            <div className="col-span-2"><span className="text-slate-400 block text-xs uppercase">DXCC</span><span className="font-bold">{formatDxcc(detailQso)}</span></div>
                            <div className="col-span-2"><span className="text-slate-400 block text-xs uppercase">State</span><span className="font-bold">{detailQso.state || detailQso.adif_raw?.state || '-'}</span></div>
                        </div>

                        {/* 3. 查看该条日志参与申领的奖项 */}
                        <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Award size={14}/> 参与的奖项申领 (Participating Awards)</h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {qsoAwards.length === 0 ? <div className="text-slate-400 text-xs italic">该 QSO 暂未符合任何已发布奖项的基础条件</div> : (
                                qsoAwards.map(a => (
                                    <div key={a.id} className="p-2 border rounded bg-yellow-50 text-yellow-800 text-xs font-bold flex justify-between items-center">
                                        <span>{a.name}</span>
                                        <CheckCircle size={12} className="text-green-600"/>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// 7. User Management (Same as provided, kept intact)
const UserManage = () => {
    const [users, setUsers] = useState([]);
    const [editing, setEditing] = useState(null);
    const [creating, setCreating] = useState(false);
    const [twoFaCode, setTwoFaCode] = useState('');
    const [newUserInfo, setNewUserInfo] = useState({ callsign: '', password: '', role: 'user' });
    const [roleRequests, setRoleRequests] = useState([]);
    const [reviewingReqId, setReviewingReqId] = useState(null);
    // 参考 HamCQ 用户列表加的搜索（前端过滤：呼号 / ID / 角色）
    const [search, setSearch] = useState('');
    
    useEffect(() => { loadUsers(); loadRoleRequests(); }, []);
    
    const loadUsers = async () => { 
        try { 
            const data = await apiFetch('/admin/users'); 
            setUsers(data); 
        } catch(e) { 
            console.error("Failed to load users:", e);
            if (e.status !== 401 && e.status !== 403) alert("加载用户列表失败: " + e.message);
        } 
    };

    const loadRoleRequests = () => {
        apiFetch('/admin/role-requests').then(setRoleRequests).catch(() => {});
    };

    const reviewRoleRequest = async (id, action) => {
        let reason = '';
        if (action === 'reject') {
            const r = await promptDialog({
                title: '驳回升级申请',
                message: '请填写驳回原因，申请人会收到这条说明。',
                placeholder: '例如：材料不足 / 暂无新增奖状计划',
                confirmText: '驳回',
                danger: true,
            });
            if (!r) return;
            reason = r;
        } else {
            const ok = await confirmDialog({
                title: '通过升级申请',
                message: '确认通过该用户的「奖状管理员」申请？',
                detail: '通过后该用户角色立即变更为奖状管理员，需要其重新登录才生效。',
                confirmText: '通过',
            });
            if (!ok) return;
        }
        setReviewingReqId(id);
        try {
            await apiFetch(`/admin/role-requests/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) });
            loadRoleRequests();
            loadUsers();
        } catch (err) {
            alert(err.message || '操作失败');
        } finally {
            setReviewingReqId(null);
        }
    };

    // confirmOpts 非空时先弹确认框：删除账号 / 改角色这类操作都会传，防止手滑
    const handleAction = async (method, url, body = {}, confirmOpts = null) => {
        if (confirmOpts && !(await confirmDialog(confirmOpts))) return;
        try {
            const headers = twoFaCode ? { 'x-2fa-code': twoFaCode } : {};
            await apiFetch(url, { method, body: JSON.stringify(body), headers });
            alert('操作成功');
            loadUsers(); setEditing(null); setCreating(false); setTwoFaCode(''); setNewUserInfo({ callsign: '', password: '', role: 'user' });
        } catch (err) {
            if (err.error === '2FA_REQUIRED') {
                const code = prompt('请输入管理员 2FA 验证码以继续:');
                if(code) { setTwoFaCode(code); alert('验证码已缓存，请再次点击确认。'); }
            } else { alert(err.message); }
        }
    };

    // ★ 参考 HamCQ 后台的「用户分页列表」（2026-09-23）：标题 + 副标题、搜索框、用户数、
    //   「新建用户」按钮、表格（ID / 呼号 / 注册时间 / 用户组徽标 / 状态 / 操作）。
    const keyword = search.trim().toLowerCase();
    const filteredUsers = keyword
        ? users.filter((u) => u.callsign.toLowerCase().includes(keyword) || String(u.id) === keyword || u.role.includes(keyword))
        : users;

    const ROLE_META = {
        admin: { label: '系统管理员', Icon: Shield, cls: 'bg-red-100 text-red-700 border-red-200' },
        award_admin: { label: '奖状管理员', Icon: Trophy, cls: 'bg-purple-100 text-purple-700 border-purple-200' },
        user: { label: '普通用户', Icon: User, cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="flex items-center gap-3 text-2xl font-black text-slate-800"><Users className="text-blue-600" /> 用户管理</h2>
                <p className="mt-1 text-sm text-slate-500">站内账号一览：角色调整、密码重置、账号删除，以及角色升级申请的审核。</p>
            </div>
            {/* 内测门禁（默认关闭）：自包含组件，自己拉数据 */}
            <InviteCodePanel />
            {roleRequests.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-purple-50/50 px-4 py-3 text-sm font-bold text-purple-700">
                        <Trophy size={16} /> 角色升级申请（{roleRequests.length}）
                    </div>
                    {roleRequests.map((r) => (
                        <div key={r.id} className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold text-slate-800">{r.callsign}</div>
                                <div className="text-xs text-slate-400">申请成为「奖状管理员」 · {new Date(r.created_at).toLocaleDateString('zh-CN')}</div>
                                {r.award_name && <div className="mt-1 text-xs text-slate-700">拟创建奖状：<b>{r.award_name}</b></div>}
                                {r.reason && <div className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-500">理由：{r.reason}</div>}
                                {r.experience && <div className="mt-1 text-xs text-slate-500">经验/背景：{r.experience}</div>}
                                {r.contact && <div className="mt-1 text-xs text-slate-500">联系方式：{r.contact}</div>}
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <button onClick={() => reviewRoleRequest(r.id, 'approve')} disabled={reviewingReqId === r.id} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">通过</button>
                                <button onClick={() => reviewRoleRequest(r.id, 'reject')} disabled={reviewingReqId === r.id} className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-200 disabled:opacity-60">驳回</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 工具条：搜索 / 用户数 / 新建 */}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="relative min-w-[220px] flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索呼号 / ID / 角色"
                        className="w-full rounded-xl border bg-white py-2 pl-9 pr-3 text-sm"
                    />
                </div>
                <div className="text-xs text-slate-500">
                    用户数：<b className="text-slate-700">{keyword ? `${filteredUsers.length} / ${users.length}` : users.length}</b>
                </div>
                <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
                    <UserPlus size={16} /> 新建用户
                </button>
            </div>

            {users.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">暂无用户数据或加载失败</div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-xs text-slate-500">
                                    <th className="px-4 py-3 text-left font-bold">ID</th>
                                    <th className="px-4 py-3 text-left font-bold">呼号</th>
                                    <th className="px-4 py-3 text-left font-bold whitespace-nowrap">注册时间</th>
                                    <th className="px-4 py-3 text-left font-bold">用户组</th>
                                    <th className="px-4 py-3 text-left font-bold whitespace-nowrap">两步验证</th>
                                    <th className="px-4 py-3 text-right font-bold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">没有匹配「{search}」的用户</td>
                                    </tr>
                                )}
                                {filteredUsers.map((u) => {
                                    const meta = ROLE_META[u.role] || ROLE_META.user;
                                    const RoleIcon = meta.Icon;
                                    return (
                                        <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                                            <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.id}</td>
                                            <td className="px-4 py-3 font-mono font-bold text-blue-600">{u.callsign}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                                                {u.created_at ? new Date(u.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${meta.cls}`}>
                                                    <RoleIcon size={12} /> {meta.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {u.has_2fa ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><Check size={14} /> 已启用</span>
                                                ) : (
                                                    <span className="text-xs text-slate-400">未启用</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => setEditing(u)} title="编辑角色 / 重置密码" className="rounded-lg border p-2 text-slate-600 hover:bg-slate-50"><Edit size={15} /></button>
                                                    <button onClick={() => handleAction('DELETE', `/admin/users/${u.id}`, {}, {
                                                        title: '删除账号',
                                                        message: `确认删除用户「${u.callsign}」？`,
                                                        detail: `当前角色：${u.role}\n该账号的通联日志、申领记录会级联删除；他创建的奖状会变成「无主」状态（奖状本身不删）。此操作不可恢复。`,
                                                        confirmText: '删除账号',
                                                        danger: true,
                                                    })} title="删除账号" className="rounded-lg border border-red-200 p-2 text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {(editing || creating) && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-6 rounded-xl w-full max-w-md space-y-4">
                        <h4 className="font-bold">{creating ? '添加新用户' : `编辑用户 ${editing.callsign}`}</h4>
                        {creating && <input className="w-full p-2 border rounded" placeholder="呼号" value={newUserInfo.callsign} onChange={e=>setNewUserInfo({...newUserInfo, callsign: e.target.value})} />}
                        <select className="w-full p-2 border rounded" value={creating ? newUserInfo.role : editing.role} onChange={e=> creating ? setNewUserInfo({...newUserInfo, role: e.target.value}) : setEditing({...editing, role:e.target.value})}>
                            <option value="user">普通用户</option><option value="award_admin">奖状管理员</option><option value="admin">系统管理员</option>
                        </select>
                        <input className="w-full p-2 border rounded" placeholder={creating ? "设置密码" : "重置密码 (留空不修改)"} type="password" id="modal-pass" value={creating ? newUserInfo.password : undefined} onChange={creating ? (e)=>setNewUserInfo({...newUserInfo, password:e.target.value}) : undefined}/>
                        <button onClick={()=>{
                            if (creating) {
                                handleAction('POST', '/admin/users', newUserInfo, {
                                    title: '新建账号',
                                    message: `确认创建账号「${String(newUserInfo.callsign || '').toUpperCase()}」？`,
                                    detail: `角色：${newUserInfo.role}\n创建后请把初始密码单独告知本人。`,
                                    confirmText: '创建账号',
                                });
                                return;
                            }
                            const pass = document.getElementById('modal-pass').value;
                            handleAction('PUT', `/admin/users/${editing.id}`, { role: editing.role, password: pass || undefined }, {
                                title: '保存账号变更',
                                message: `确认修改「${editing.callsign}」？`,
                                detail: `角色：${editing.role}${pass ? '\n将重置该账号的登录密码' : ''}\n注意：角色变更需要对方重新登录才会生效。`,
                                confirmText: '保存',
                            });
                        }} className="w-full bg-blue-600 text-white py-2 rounded font-bold">确认保存</button>
                        <button onClick={()=>{setEditing(null); setCreating(false);}} className="w-full text-slate-500 py-2">取消</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ================= Main App =================

export default function App() {
  const [view, setView] = useState('loading'); 
  const [user, setUser] = useState(null);
  // 公开静态页（关于 / 隐私政策）：与 view 无关、独立于登录态
  const [publicPage, setPublicPage] = useState(() => readPublicPage());
  // 主题：'dark'（默认）| 'light'；持久化到 localStorage 并同步到 <html>
  const [theme, setTheme] = useState(() => (localStorage.getItem('ham_theme') === 'light' ? 'light' : 'dark'));
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  useEffect(() => {
      document.documentElement.classList.toggle('theme-dark', theme === 'dark');
      document.documentElement.classList.toggle('theme-light', theme === 'light');
      localStorage.setItem('ham_theme', theme);
  }, [theme]);
  // 初始页面从 URL 读取；非法路由回落默认页，角色可见性由下方守卫校正
  const [subView, setSubView] = useState(() => readRoute() || DEFAULT_ROUTE);
  // 窄屏侧边栏抽屉开关（仅 lg 以下生效；宽屏侧边栏常驻，不读这个值）
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 主界面内容区（它自己才是内部滚动容器，不是 window）
  const mainRef = useRef(null);
  /**
   * 切页回到顶部。
   * Hash 路由只改 URL、不会重新加载文档，浏览器会保留上一页的滚动位置
   * （所以点「关于 / 隐私政策 / 用户协议 / 内容规范」后会停在原滚动高度）。
   * 公开页走 body 滚动、主界面走 <main> 内部滚动，两处都要归零。
   * ⚠️ 本 effect 必须写在 subView / publicPage 声明**之后**，否则引用未初始化
   * 变量会触发 TDZ 报错、整页白屏。
   */
  useEffect(() => {
      window.scrollTo(0, 0);
      if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [subView, publicPage]);
  const [show2FAInput, setShow2FAInput] = useState(false);
  const [loginForm, setLoginForm] = useState({});
  const [authMode, setAuthMode] = useState('login'); // Added for in-page register
  // OAuth（M5）：登录页按钮显隐 + 授权后「补全呼号」会话
  const [oauthProviders, setOauthProviders] = useState([]);
  const [oauthPendingToken, setOauthPendingToken] = useState(null);
  const [oauthPendingUsername, setOauthPendingUsername] = useState('');
  // 内测门禁：注册 / HamCQ 首次建号是否需要邀请码（来自公开接口 /api/system-status）
  const [requireInvite, setRequireInvite] = useState(false);
  
  // New States for Menu and Notifications
  const [expandedMenus, setExpandedMenus] = useState({});
  // 站内通知：list = 通知内容，unread = 铃铛红点，byType = 各业务类型的未读数（→ 侧边栏对应菜单红点）
  const [notifData, setNotifData] = useState({ list: [], unread: 0, byType: {} });
  const [notifPanel, setNotifPanel] = useState(false);

  useEffect(() => {
    // OAuth 回调/绑定（M5）：后端 302 跳回，URL 带 token 或 bind_token，
    // 必须在 system-status 初始化之前处理，避免竞态覆盖。
    const hash = window.location.hash || '';
    if (hash.startsWith('#/oauth/code')) {
      const q = new URLSearchParams(hash.split('?')[1] || '');
      const code = q.get('code');
      if (code) {
        // 安全加固（审计整改）：URL 里只有一次性短码，POST 向后端换 JWT，
        // 避免长期 JWT 暴露在地址栏/历史/浏览器扩展可见范围。
        apiFetch('/auth/oauth/code', { method: 'POST', body: JSON.stringify({ code }) })
          .then((data) => {
            if (data && data.token && data.user) {
              localStorage.setItem('ham_token', data.token);
              localStorage.setItem('ham_user', JSON.stringify(data.user));
              setUser(data.user);
              setView('main');
              setSubView(DEFAULT_ROUTE);
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`);
            } else {
              setView('auth');
            }
          })
          .catch(() => setView('auth'));
        return;
      }
    }
    if (hash.startsWith('#/oauth/complete')) {
      const q = new URLSearchParams(hash.split('?')[1] || '');
      const pt = q.get('pending_token');
      if (pt) {
        setOauthPendingToken(pt);
        setOauthPendingUsername(q.get('username') || '');
        setAuthMode('oauth_complete');
        setView('auth');
        return;
      }
    }

    apiFetch('/system-status').then(status => {
        if (!status.installed) {
            setView('install');
        } else {
            const savedUser = localStorage.getItem('ham_user');
            if (savedUser) {
                setUser(JSON.parse(savedUser));
                setView('main');
            } else {
                setView('landing'); // 已安装未登录：先展示网站首页，由 CTA 进入 auth
            }
        }
    }).catch(() => setView('landing'));
  }, []);

  // OAuth 提供方查询（M5）：登录页据此决定是否显示「使用 HamCQ 登录」
  // 同时读一次内测开关（同一个公开接口族，省一次请求也避免时序问题）
  useEffect(() => {
    fetch('/api/auth/oauth/providers')
      .then((r) => r.json())
      .then((d) => setOauthProviders(d.providers || []))
      .catch(() => {});
    fetch('/api/system-status')
      .then((r) => r.json())
      .then((d) => setRequireInvite(!!d.requireInvite))
      .catch(() => {});
  }, []);

  // ===================== Hash 路由同步（新增） =====================
  // 1) 手改地址栏 / 浏览器前进后退时，把 URL 变化同步回 subView
  useEffect(() => {
      const onHashChange = () => {
          setPublicPage(readPublicPage());
          const route = readRoute();
          if (route) setSubView(route);
      };
      window.addEventListener('hashchange', onHashChange);
      return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 2) subView 变化时写回 URL，使刷新能停在当前页、链接可分享。
  //    公开校验页 #/verify/<serial> 不归 subView 管，不能覆盖它的 URL。
  useEffect(() => {
      // 公开页（校验页 / 关于 / 隐私）时不写 hash，否则会把 #/about 之类顶回 #/dashboard
      if (view === 'main' && !isPublicHashRoute() && !publicPage) writeRoute(subView);
  }, [view, subView, publicPage]);

  // 3) 角色守卫：URL 指向当前角色看不到的页面时回落默认页，避免"所有分支都不满足"的白屏
  useEffect(() => {
      if (!user) return;
      if (!isRouteAllowed(subView, user.role)) setSubView(DEFAULT_ROUTE);
  }, [user, subView]);

  // ★ 2026-09-24：菜单红点改为「未读通知」驱动（原来用 /stats/dashboard 的"待审数量"，
  //   点进菜单后下一次轮询又把它写回来 → 红点永远消不掉，用户报过这个问题）。
  //   现在只有一个 10 秒轮询：通知列表 + 未读总数 + 按类型未读数（byType）。
  useEffect(() => {
      if (view !== 'main' || !user) return;
      const poll = () => {
          apiFetch('/notifications')
              .then((d) => setNotifData({ list: d.list || [], unread: d.unread || 0, byType: d.byType || {} }))
              .catch(() => {});
      };
      poll();
      const t = setInterval(poll, 10000);
      return () => clearInterval(t);
  }, [view, user]);

  /**
   * 通知类型 → 侧边栏菜单：点进对应页面就把该类型的未读清掉（红点消失）。
   * 没在表里的类型（如"审核通过/驳回"这类**结果通知给申请人自己**的）只出现在铃铛里。
   */
  const MENU_NOTIF_TYPES = {
      admin_audit: ['award_pending'],
      award_returned: ['award_returned'],
      drafts_group: ['award_returned'],
      evidence_audit: ['evidence_pending'],
      users: ['role_request'],
  };

  /** 某菜单项的未读数（未映射的类型返回 0，不显示红点） */
  const notifDot = (types) => (types || []).reduce((sum, t) => sum + (notifData.byType?.[t] || 0), 0);

  /** 点通知面板里的某条 → 跳到相关页面（只做有明确落点的类型） */
  const NOTIF_TARGET = {
      award_pending: 'admin_audit',
      evidence_pending: 'evidence_audit',
      role_request: 'users',
      award_returned: 'award_returned',
  };

  const markAllRead = async () => {
      try {
          await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) });
          setNotifData((prev) => ({ list: prev.list.map((n) => ({ ...n, read: true })), unread: 0, byType: {} }));
      } catch (e) { /* ignore */ }
  };

  /** 按类型标记已读（点菜单时调用）：本地同步清红点，避免等下一次轮询 */
  const markTypesRead = async (types) => {
      if (!types || !types.length || !user) return;
      const cleared = notifDot(types);
      if (cleared === 0) return;
      try {
          await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ types }) });
      } catch (e) { /* ignore */ }
      setNotifData((prev) => {
          const byType = { ...(prev.byType || {}) };
          types.forEach((t) => { delete byType[t]; });
          return {
              ...prev,
              byType,
              unread: Math.max(0, prev.unread - cleared),
              list: prev.list.map((n) => (types.includes(n.type) ? { ...n, read: true } : n)),
          };
      });
  };

  // 点单条通知即视为已读（并可跳到相关页面）
  const markRead = async (id) => {
      const item = notifData.list.find((n) => n.id === id);
      if (item && !item.read) {
          try {
              await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ id }) });
          } catch (e) { /* ignore */ }
          setNotifData((prev) => {
              const byType = { ...(prev.byType || {}) };
              if (byType[item.type]) {
                  byType[item.type] = Math.max(0, byType[item.type] - 1);
                  if (!byType[item.type]) delete byType[item.type];
              }
              return {
                  ...prev,
                  byType,
                  list: prev.list.map((n) => (n.id === id ? { ...n, read: true } : n)),
                  unread: Math.max(0, prev.unread - 1),
              };
          });
      }
      const target = item && NOTIF_TARGET[item.type];
      if (target) {
          setSubView(target);
          setNotifPanel(false);
      }
  };

  const refreshUser = async () => {
    try {
        const u = await apiFetch('/user/profile');
        setUser(u);
        localStorage.setItem('ham_user', JSON.stringify(u));
    } catch(e) { console.error(e); }
  };

  const handleLogin = async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      const payload = { ...loginForm, ...data }; // Removed loginType
      
      try {
          const res = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
          localStorage.setItem('ham_token', res.token);
          localStorage.setItem('ham_user', JSON.stringify(res.user));
          setUser(res.user);
          // 若 URL 里带了该角色可见的页面（分享链接），登录后直接过去
          const target = readRoute();
          setSubView(target && isRouteAllowed(target, res.user.role) ? target : DEFAULT_ROUTE);
          setView('main');
          setShow2FAInput(false);
      } catch (err) {
          if (err.error === '2FA_REQUIRED') {
              setLoginForm(data);
              setShow2FAInput(true);
          } else { alert(err.message || '登录失败'); }
      }
  };

  const handleRegister = async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      if (data.password !== data.confirmPassword) return alert("两次输入的密码不一致");
      
      try {
          await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) });
          alert('注册成功！请登录。');
          setAuthMode('login');
      } catch (err) { alert(err.message); }
  };

  // OAuth 授权后补全呼号（M5）：HamCQ 的 username 不一定是呼号（可能是昵称），
  // 由用户确认/输入呼号 —— 已注册则验密绑定（防冒名接管），未注册则创建新账号。
  const handleOauthComplete = async (e) => {
      e.preventDefault();
      const callsign = e.target.callsign.value;
      const password = e.target.password.value;
      const inviteCode = e.target.invite_code ? e.target.invite_code.value : '';
      try {
          const res = await apiFetch('/auth/oauth/complete', { method: 'POST', body: JSON.stringify({ pending_token: oauthPendingToken, callsign, password, invite_code: inviteCode }) });
          localStorage.setItem('ham_token', res.token);
          localStorage.setItem('ham_user', JSON.stringify(res.user));
          setUser(res.user);
          setView('main');
          setSubView(DEFAULT_ROUTE);
          setOauthPendingToken(null);
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`);
      } catch (err) {
          alert(err.message || '登录失败');
      }
  };

  const handleLogout = () => {
      localStorage.clear();
      // 顺手清掉 URL 里的页面 hash，避免下次带着上一个账号的路由进来
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      window.location.reload();
  };

  const toggleMenu = (id) => {
      setExpandedMenus(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Clear notification on click
  const handleMenuClick = (item) => {
      if (item.children) {
          toggleMenu(item.id);
      } else {
          setSubView(item.id);
          // ★ 进入页面即把该菜单对应的通知标记为已读（后端也写 read=TRUE），
          //   所以红点是"真的"消失，不会像以前那样被下一次轮询写回来。
          markTypesRead(MENU_NOTIF_TYPES[item.id]);
      }
  };

  // 公开校验页（奖状 PDF / 纸质件上的二维码指向这里）：必须免登录，
  // 所以在任何登录态判断之前拦截。
  const verifySerial = parseVerifyHash();
  if (verifySerial) return <VerifyView serial={verifySerial} theme={theme} />;

  // 公开静态页（关于 / 隐私政策）：同样免登录，返回时清掉 hash 回到原视图。
  const closePublicPage = () => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setPublicPage(null);
  };
  if (publicPage === 'about') return <AboutView onBack={closePublicPage} theme={theme} onToggleTheme={toggleTheme} />;
  if (publicPage === 'privacy') return <PrivacyView onBack={closePublicPage} theme={theme} onToggleTheme={toggleTheme} />;
  if (publicPage === 'terms') return <TermsView onBack={closePublicPage} theme={theme} onToggleTheme={toggleTheme} />;
  if (publicPage === 'protocol') return <ProtocolView onBack={closePublicPage} theme={theme} onToggleTheme={toggleTheme} />;

  if (view === 'install') return <InstallView onComplete={() => window.location.reload()} />;

  if (view === 'landing') return (
    <LandingView
      onLogin={() => { setAuthMode('login'); setView('auth'); }}
      onRegister={() => { setAuthMode('register'); setView('auth'); }}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );

  if (view === 'auth') {
    const field = 'w-full rounded-lg border border-white/10 bg-white/5 p-3 text-white placeholder-slate-500 outline-none transition-all focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/30';
    const labelCls = 'text-xs font-bold uppercase text-slate-400';
    // 主按钮用可被双主题映射的实色（深色主题=青，亮色主题=靛蓝），刻意不用渐变
    const primaryBtn = 'w-full rounded-xl bg-slate-900 py-3.5 font-bold text-white transition-all hover:-translate-y-0.5 active:scale-95';

    // HamCQ 登录按钮：登录页与注册页共用（注册页也常驻，因为"忘记密码"时它是唯一免密通道）
    const oauthBlock = oauthProviders.length > 0 ? (
      <div className="mt-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-slate-500">或</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <button
          type="button"
          onClick={() => { window.location.href = '/api/auth/oauth/start'; }}
          className="w-full rounded-xl border border-white/15 py-3 text-sm font-bold text-slate-200 transition-colors hover:bg-white/5"
        >
          {oauthProviders[0].label || '使用 HamCQ 登录'}
        </button>
      </div>
    ) : null;
    return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen bg-slate-950 antialiased`}>
      {/* 顶栏：跨两栏悬浮（返回首页 / 主题切换） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
        <button
          type="button"
          onClick={() => setView('landing')}
          className="pointer-events-auto inline-flex items-center gap-1.5 text-sm font-bold text-slate-400 transition-colors hover:text-white"
        >
          <span className="text-base leading-none">←</span> 返回首页
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-bold text-slate-400 transition-colors hover:text-white"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span className="hidden sm:inline">{theme === 'dark' ? '白天' : '夜间'}</span>
        </button>
      </div>

      {/* 分屏布局：左=表单，右=品牌展示（参考 Dribbble「Mix Certificate — Sign In & Landing Page UI」）
          注意 min-w-0：flex 子项默认 min-width:auto，会被内部内容撑开导致横向溢出，
          在 1024~1100px 这种刚过 lg 的宽度下尤其明显。 */}
      <div className="flex min-h-screen">
        {/* ---------- 左栏：表单 ---------- */}
        <div className="flex w-full min-w-0 flex-col justify-center px-6 pb-14 pt-24 lg:w-[46%] lg:px-14 lg:pt-14">
          <div className="mx-auto w-full min-w-0 max-w-[380px] animate-scale-in">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400 text-slate-950">
                <Award size={20} strokeWidth={2.5} />
              </span>
              <div>
                <div className="text-sm font-black tracking-[0.2em]">HAM<span className="text-cyan-400">AWARDS</span></div>
                <div className="text-[11px] text-slate-500">业余无线电奖状管理平台</div>
              </div>
            </div>

            <h1 className="mt-9 text-2xl font-black tracking-tight text-white">
              {authMode === 'register' ? '创建您的账号' : authMode === 'oauth_complete' ? '完成 HamCQ 授权' : '欢迎回来'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {authMode === 'register'
                ? '注册后即可导入通联日志、按规则申领奖状。'
                : authMode === 'oauth_complete'
                  ? '请确认你的本站呼号，再继续。'
                  : '登录后继续管理你的通联日志与奖状。'}
            </p>

            <div className="mt-7 flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <button onClick={()=>setAuthMode('login')} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors ${authMode==='login'?'bg-white/10 text-cyan-300':'text-slate-500 hover:text-slate-300'}`}>登录</button>
              <button onClick={()=>setAuthMode('register')} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors ${authMode==='register'?'bg-white/10 text-cyan-300':'text-slate-500 hover:text-slate-300'}`}>注册新账号</button>
            </div>

        {authMode === 'oauth_complete' ? (
            <div className="pt-6">
                <p className="mb-5 text-xs leading-relaxed text-slate-400">
                    已通过 HamCQ 账号「{oauthPendingUsername}」授权。请确认你的呼号（HamCQ 用户名不一定是呼号），再继续。
                </p>
                <form onSubmit={handleOauthComplete} className="space-y-4">
                    <div className="space-y-1">
                        <label className={labelCls}>本站呼号</label>
                        <input name="callsign" required defaultValue={oauthPendingUsername} className={`${field} uppercase`} placeholder="例如: BG1ABC" />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>本站密码（可选）</label>
                        <PasswordInput variant="dark" name="password" autoComplete="new-password" className={field} />
                        <span className="text-[10px] text-slate-500">若该呼号已注册，必须填写其本站密码完成绑定；若是新账号，可设置密码以便日后密码登录，留空则只能用 HamCQ 登录。</span>
                    </div>
                    {requireInvite && (
                        <div className="space-y-1">
                            <label className={labelCls}>内测邀请码</label>
                            <input name="invite_code" className={`${field} font-mono uppercase`} placeholder="新建账号必填；绑定已有账号可留空" />
                            <span className="text-[10px] text-slate-500">本站内测中：<b>新建账号</b>需要邀请码；若该呼号已注册（你在补齐绑定），用上面的密码验证即可，不需要邀请码。</span>
                        </div>
                    )}
                    <button className={primaryBtn}>确认并登录</button>
                    <button type="button" onClick={() => { setAuthMode('login'); setOauthPendingToken(null); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); }} className="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-300">返回登录</button>
                </form>
            </div>
        ) : authMode === 'login' ? (
            <div className="pt-6">
                <form onSubmit={handleLogin} className="space-y-4">
                    {!show2FAInput ? (
                        <>
                            <div className="space-y-1"><label className={labelCls}>呼号 (用户名)</label><input name="callsign" required className={field} /></div>
                            <div className="space-y-1">
                                <label className={labelCls}>密码</label>
                                <PasswordInput variant="dark" name="password" required autoComplete="current-password" className={field} />
                            </div>
                        </>
                    ) : (
                        <div className="space-y-1 animate-in fade-in slide-in-from-right duration-300">
                            <label className="flex items-center gap-2 text-xs font-bold uppercase text-cyan-300"><Lock size={12}/> 二步验证码 (2FA)</label>
                            <input name="code" autoFocus className={`${field} text-center font-mono font-bold tracking-[1em] text-xl`} placeholder="000000" maxLength={6} />
                            <button type="button" onClick={()=>setShow2FAInput(false)} className="mt-2 block w-full text-center text-xs text-slate-500 underline transition-colors hover:text-slate-300">返回重新输入账号</button>
                        </div>
                    )}
                    <button className={primaryBtn}>
                        {show2FAInput ? '验证并登录' : '登录系统'}
                    </button>
                </form>

                {!show2FAInput && (
                    <button
                        type="button"
                        onClick={() => infoDialog({
                            title: '忘记密码了？',
                            message: '本站目前没有自助找回密码，请用下面两种方式之一进入账号：',
                            detail:
                                '① 用 HamCQ 登录（推荐）\n'
                                + '如果你之前把 HamCQ 账号绑定过本站，点下面的「使用 HamCQ 登录」会直接进站，不需要本站密码；\n'
                                + '进站后到「用户中心 → 修改密码」重新设置即可。\n\n'
                                + '② 请管理员重置\n'
                                + '把你的呼号发给站点管理员，管理员可在「后台管理 → 用户管理」里为你设置一个新密码。\n\n'
                                + '提示：新注册账号建议直接用 HamCQ 登录，就不会再有忘记密码的问题。',
                            confirmText: '知道了',
                        })}
                        className="mt-3 block w-full text-center text-xs text-slate-500 underline transition-colors hover:text-slate-300"
                    >
                        忘记密码？
                    </button>
                )}

                {oauthBlock}
            </div>
        ) : (
            <div className="pt-6">
                <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-1"><label className={labelCls}>注册呼号</label><input name="callsign" required className={field} placeholder="例如: BA1AA" /></div>
                    <div className="space-y-1">
                        <label className={labelCls}>设置密码</label>
                        <PasswordInput variant="dark" name="password" required autoComplete="new-password" className={field} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>确认密码</label>
                        <PasswordInput variant="dark" name="confirmPassword" required autoComplete="new-password" className={field} />
                    </div>
                    {requireInvite && (
                        <div className="space-y-1">
                            <label className={labelCls}>内测邀请码</label>
                            <input name="invite_code" required className={`${field} font-mono uppercase`} placeholder="HAM-XXXX-XXXX" />
                            <span className="text-[10px] text-slate-500">本站处于内测阶段，注册需要邀请码；没有的话请联系站点管理员领取。</span>
                        </div>
                    )}
                    <button className="w-full rounded-xl bg-green-600 py-3.5 font-bold text-white transition-all hover:-translate-y-0.5 active:scale-95">立即注册</button>
                </form>

                {/* 注册就引导用 HamCQ：绑定后即使忘记本站密码也能直接进站（唯一免密通道） */}
                <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-3 text-xs leading-relaxed text-slate-300">
                    <b>建议用 HamCQ 登录</b>
                    ：绑定 HamCQ 后，忘记本站密码也能直接用论坛账号进站，不用记第二个密码。
                    {requireInvite ? '（内测期间同样需要邀请码）' : ''}
                </div>
                {oauthBlock}
            </div>
        )}
          </div>
        </div>

        {/* ---------- 右栏：品牌展示（仅 lg 以上显示） ---------- */}
        <div className="auth-brand relative hidden min-w-0 overflow-hidden lg:flex lg:w-[54%] lg:flex-col lg:justify-center lg:px-14">
          <div className="relative z-10 mx-auto w-full min-w-0 max-w-md">
            <h2 className="text-3xl font-black leading-snug tracking-tight" style={{ color: '#f4f4f5' }}>
              一站式管理<br />你的业余无线电奖状
            </h2>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: '#94a3b8' }}>
              LoTW 直连导入 · 可视化奖状设计 · 在线申请审核 · 二维码真伪校验
            </p>

            {/* 奖状预览（微微倾斜，呼应参考设计的证书卡） */}
            <div className="mt-10 -rotate-2 rounded-xl p-5 shadow-2xl shadow-black/40" style={{ backgroundColor: '#ffffff' }}>
              <div className="p-5 text-center" style={{ border: '2px solid rgba(252, 211, 77, 0.75)' }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color: '#b45309' }}>Certificate</div>
                <div className="mt-2 text-lg font-black" style={{ color: '#0f172a' }}>DX 大师奖</div>
                <div className="mt-0.5 text-[10px] font-bold tracking-widest" style={{ color: '#d97706' }}>GOLD LEVEL</div>
                <div className="mt-4 font-serif text-xl italic" style={{ color: '#1e293b' }}>BG1ABC</div>
                <div className="mx-auto mt-2 h-px w-16" style={{ backgroundColor: '#e2e8f0' }} />
                <div className="mt-4 flex items-center justify-between text-[9px]" style={{ color: '#64748b' }}>
                  <span className="font-mono">SN 7D0B5DF2</span>
                  <span className="grid h-8 w-8 place-items-center rounded-full text-white" style={{ backgroundColor: '#fbbf24' }}>
                    <QrCode size={14} />
                  </span>
                </div>
              </div>
            </div>

            {/* 三项能力标签（用真实功能表述，不编造统计数字） */}
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                { icon: ShieldCheck, label: '凭据零留存' },
                { icon: QrCode, label: '扫码可校验' },
                { icon: Radio, label: 'LoTW 直连' },
              ].map((f) => (
                <div
                  key={f.label}
                  className="rounded-xl px-3 py-3 text-center"
                  style={{ border: '1px solid rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <f.icon size={16} className="mx-auto" style={{ color: '#22d3ee' }} />
                  <div className="mt-2 text-[11px]" style={{ color: '#94a3b8' }}>{f.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  }

  if (view === 'main') {
      const menu = [
          // Common
          { id: 'dashboard', label: '概览', icon: BarChart, show: true },
          { id: 'awards', label: '奖状大厅', icon: Award, show: true },
          
          // 日志与申请（所有角色都可用：管理员/审核员同样能申请奖状）
          { id: 'my_awards', label: '我的奖状', icon: CheckCircle, show: true },
          { id: 'logbook', label: '日志上传', icon: Upload, show: true }, 
          { id: 'lotw_import', label: 'LoTW 直连', icon: Globe, show: true },
          { id: 'all_logs', label: '全部日志', icon: List, show: true }, 
          
          // 奖状管理：**奖状管理员与系统管理员都能用**（admin 也要能建奖状并发起审核）。
          // `group` 用于在侧边栏输出分组标题，见下方 nav 渲染。
          { id: 'award_create', label: '新建奖状', icon: Plus, show: user.role === 'award_admin' || user.role === 'admin', group: '奖状管理' },
          { 
              id: 'drafts_group', 
              label: '草稿箱', 
              icon: FileText, 
              show: user.role === 'award_admin' || user.role === 'admin',
              group: '奖状管理',
              isDropdown: true,
              children: [
                  { id: 'award_drafts', label: '我的草稿' },
                  { id: 'award_returned', label: '打回草稿', notification: notifDot(['award_returned']) }
              ],
              notification: notifDot(['award_returned']) // 父项红点跟随子项
          },
          { id: 'award_audit_list', label: '审核列表', icon: List, show: user.role === 'award_admin' || user.role === 'admin', group: '奖状管理' },
          { id: 'evidence_audit', label: '实物材料审核', icon: ImageIcon, show: user.role === 'award_admin', group: '奖状管理', notification: notifDot(['evidence_pending']) },

          // ★ 后台管理（仅最高级管理员）：把「用户管理 / 奖状审核 / 实物材料审核 / 审计日志」
          //   等管理类操作收进同一个分组，避免和普通用户菜单混在一起。
          { id: 'admin_audit', label: '奖状审核', icon: CheckCircle, show: user.role === 'admin', group: '后台管理', notification: notifDot(['award_pending']) },
          { id: 'admin_overview', label: '奖状总览', icon: Layout, show: user.role === 'admin', group: '后台管理' },
          { id: 'issuanceManager', label: '颁发管理', icon: Trophy, show: user.role === 'admin', group: '后台管理' }, 
          { id: 'users', label: '用户管理', icon: Users, show: user.role === 'admin', group: '后台管理', notification: notifDot(['role_request']) },
          { id: 'evidence_audit', label: '实物材料审核', icon: ImageIcon, show: user.role === 'admin', group: '后台管理', notification: notifDot(['evidence_pending']) },
          { id: 'admin_logs', label: '审计日志', icon: ShieldCheck, show: user.role === 'admin', group: '后台管理' },
          
          // Common Bottom
          { id: 'userCenter', label: '用户中心', icon: User, show: true },
      ].filter(i => i.show);

      return (
          <div className={`${theme === 'dark' ? 'app-dark bg-slate-950' : 'app-light'} relative flex h-screen overflow-hidden`}>
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 55% at 50% -10%, rgba(255,255,255,0.05), transparent)' }} />
              </div>
              {/* 窄屏点遮罩关闭抽屉 */}
              {sidebarOpen && (
                  <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
              )}
              <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-white/10 bg-slate-900/70 text-white backdrop-blur-xl transition-transform duration-200 lg:static lg:z-10 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                  <div className="p-6 border-b border-slate-800">
                      <div className="flex items-center justify-between">
                          <h1 className="font-black text-xl tracking-wider">HAM AWARDS</h1>
                          <button onClick={() => setNotifPanel(!notifPanel)} className="relative p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" title="站内通知">
                              <Bell size={18} />
                              {notifData.unread > 0 && (
                                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                      {notifData.unread > 99 ? '99+' : notifData.unread}
                                  </span>
                              )}
                          </button>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>{user.callsign} ({user.role})</div>
                  </div>
                  <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                      {menu.map((item, idx) => (
                          <div key={item.id}>
                            {/* 分组标题：组内第一项上方输出一次（菜单项用 `group` 字段归属分组） */}
                            {item.group && menu[idx - 1]?.group !== item.group && (
                                <div className="px-4 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">{item.group}</div>
                            )}
                            <button 
                                onClick={() => { handleMenuClick(item); setSidebarOpen(false); }} 
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${subView===item.id || (item.children && expandedMenus[item.id]) ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                            >
                                <div className="flex items-center gap-3">
                                    <item.icon size={18} />
                                    <span className="font-medium text-sm">{item.label}</span>
                                </div>
                                {item.children ? (
                                    <div className="flex items-center gap-2">
                                        {item.notification > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
                                        {expandedMenus[item.id] ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                                    </div>
                                ) : (
                                    item.notification > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                                )}
                            </button>
                            {/* Dropdown Children */}
                            {item.children && expandedMenus[item.id] && (
                                <div className="ml-4 mt-1 pl-4 border-l border-slate-700 space-y-1">
                                    {item.children.map(child => (
                                        <button 
                                            key={child.id}
                                            onClick={() => { handleMenuClick(child); setSidebarOpen(false); }}
                                            className={`w-full flex items-center justify-between px-4 py-2 rounded-lg text-sm transition-all ${subView===child.id ? 'text-white font-bold bg-white/10' : 'text-slate-500 hover:text-white'}`}
                                        >
                                            <span>{child.label}</span>
                                            {child.notification > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                          </div>
                      ))}
                  </nav>
                  <div className="p-4 border-t border-slate-800 space-y-1">
                      <button onClick={toggleTheme} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors">
                          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                          <span className="font-medium text-sm">{theme === 'dark' ? '白天模式' : '夜间模式'}</span>
                      </button>
                      <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-900/20 rounded-lg"><LogOut size={18} /> <span className="font-medium text-sm">退出登录</span></button>
                  </div>
                  {/* 侧边栏常驻条款入口：主界面不逐页加页脚，链接集中在这里，任何页面都能直接进入 */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 px-6 py-4 text-[11px] text-slate-400">
                      <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
                      <a href="#/privacy" className="transition-colors hover:text-cyan-300">隐私政策</a>
                      <a href="#/terms" className="transition-colors hover:text-cyan-300">用户协议</a>
                      <a href="#/protocol" className="transition-colors hover:text-cyan-300">内容规范</a>
                  </div>
              </aside>
              {/* 站内通知面板（M4.1） */}
              {notifPanel && (
                  <div className="fixed inset-0 z-[90]" onClick={() => setNotifPanel(false)}>
                      <div className="absolute top-16 right-4 w-96 max-w-[90vw] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                              <h3 className="font-bold text-sm text-slate-800">站内通知</h3>
                              {notifData.unread > 0 && (
                                  <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">全部已读</button>
                              )}
                          </div>
                          <div className="max-h-96 overflow-y-auto">
                              {notifData.list.length === 0 ? (
                                  <div className="text-center py-10 text-slate-400 text-sm">暂无通知</div>
                              ) : (
                                  notifData.list.map((n) => (
                                      <div
                                          key={n.id}
                                          onClick={() => !n.read && markRead(n.id)}
                                          className={`px-4 py-3 border-b border-slate-50 ${n.read ? 'opacity-60' : 'bg-blue-50/40 cursor-pointer hover:bg-blue-50'} transition-colors`}
                                      >
                                          <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                              {!n.read && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full shrink-0"></span>}
                                              {n.title}
                                          </div>
                                          <div className="text-xs text-slate-500 mt-0.5">{n.body}</div>
                                          <div className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString('zh-CN')}</div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>
                  </div>
              )}
              <main ref={mainRef} className="relative z-10 min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
                  {/* 窄屏顶部条：打开侧边栏抽屉（宽屏隐藏） */}
                  <div className="mb-4 flex items-center gap-3 lg:hidden">
                      <button
                          onClick={() => setSidebarOpen(true)}
                          title="打开菜单"
                          className="rounded-lg border border-white/10 p-2 text-slate-500 transition-colors hover:text-slate-300"
                      >
                          <Menu size={18} />
                      </button>
                      <span className="text-sm font-black tracking-[0.2em]">HAM<span className="text-cyan-400">AWARDS</span></span>
                  </div>
                  <div className="max-w-6xl mx-auto">
                      {subView === 'dashboard' && <DashboardView user={user} />}
                      {subView === 'awards' && <AwardCenterView user={user} />} 
                      {subView === 'my_awards' && <MyAwardsView user={user} />}
                      {subView === 'logbook' && <LogbookView />}
                      {subView === 'lotw_import' && <LotwImportView />}
                      {subView === 'all_logs' && <AllLogsView />}
                      {subView === 'users' && <UserManage />}
                      
                      {/* Award Admin Split Views */}
                      {subView === 'award_create' && <AwardAdminManager viewMode="create" />}
                      {subView === 'award_drafts' && <AwardAdminManager viewMode="drafts" />}
                      {subView === 'award_returned' && <AwardAdminManager viewMode="returned" />}
                      {subView === 'award_audit_list' && <AwardAdminManager viewMode="audit_list" />}
                      
                      {/* System Admin Split Views */}
                      {subView === 'admin_audit' && <SystemAdminAwardManager viewMode="audit" />}
                      {subView === 'admin_overview' && <SystemAdminAwardManager viewMode="overview" />}
                      
                      {subView === 'issuanceManager' && <IssuanceManager />}                      
                      {subView === 'evidence_audit' && <EvidenceAuditView />}
                      {subView === 'admin_logs' && <AuditLogsView />}
                      {subView === 'userCenter' && <UserCenterView user={user} refreshUser={refreshUser} onLogout={handleLogout} />}
                  </div>
              </main>
          </div>
      );
  }
  return null;
}