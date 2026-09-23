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
  Loader2, Monitor, Sun, Moon
} from 'lucide-react';

// ================= 公共模块 =================
// 统一请求封装（原 apiFetch 定义就在这里）与 Hash 路由已抽到独立模块，
// 行为与原先保持一致，新功能请直接从这里 import，不要再写一份。
import { apiFetch } from './lib/apiFetch.js';
import { DEFAULT_ROUTE, isPublicHashRoute, isRouteAllowed, parseVerifyHash, readPublicPage, readRoute, writeRoute } from './lib/routes.js';
import LotwImportView from './pages/LotwImportView.jsx';
import VerifyView from './pages/VerifyView.jsx';
import EvidenceAuditView from './pages/EvidenceAuditView.jsx';
import LandingView from './pages/LandingView.jsx';
import AboutView from './pages/AboutView.jsx';
import PrivacyView from './pages/PrivacyView.jsx';
import TermsView from './pages/TermsView.jsx';
import ProtocolView from './pages/ProtocolView.jsx';
import { normalizeLayout } from './lib/awardLayout.js';
import { collectExternalImages } from './lib/media.js';
import VisualDesigner from './components/VisualDesigner.jsx';
import { ResponsiveAwardRenderer } from './components/AwardRenderer.jsx';
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

    if (error) return <div className="p-8 text-center text-red-500 bg-red-50 rounded-lg border border-red-200 m-8">❌ 统计数据加载失败: {error}</div>;

    if (!stats) return (
        <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            加载统计数据中...
        </div>
    );

    // Helper Card Component
    const StatCard = ({ title, value, icon: Icon, color, sub }) => (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
            <div>
                <div className="text-slate-500 text-xs font-bold uppercase mb-2">{title}</div>
                <div className="text-3xl font-black text-slate-800">{value}</div>
                {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
            </div>
            {Icon && <div className={`p-4 rounded-full ${color || 'bg-blue-50 text-blue-600'}`}><Icon size={24} /></div>}
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

            {/* 奖状管理员视图 - 仅显示自己的数据 */}
            {user.role === 'award_admin' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                         <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg shadow-slate-300">
                             <div className="text-slate-400 text-xs font-bold uppercase mb-2">系统状态</div>
                             <div className="text-2xl font-bold flex items-center gap-2">
                                 <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div> 运行正常
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
            <h3 className="text-xl font-bold flex items-center gap-2"><Award className="text-orange-500"/> 我的荣誉墙 (My Awards)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                {awards.map(ua => {
                    const badgeColor = getLevelColor(ua);
                    const textColor = getContrastColor(badgeColor);
                    const renderData = buildAwardRenderData(ua, user.callsign);
                    const layout = normalizeLayout(ua.layout, ua.bg_url);
                    const hasLayout = layout.elements.length > 0;
                    return (
                        <div key={ua.id} className="relative group perspective cursor-pointer" onClick={() => setSelectedAward(ua)}>
                            {/* 证书本体：有可视化布局就按布局渲染（与导出的 PDF 一致），否则退回旧的叠字卡片 */}
                            <div className="bg-white rounded-xl shadow-xl overflow-hidden border-4 border-slate-900 aspect-[1.414/1] relative">
                                {hasLayout ? (
                                    <ResponsiveAwardRenderer layout={layout} data={renderData} className="absolute inset-0" />
                                ) : (
                                    <>
                                        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${ua.bg_url})` }}></div>
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
                                 <div className="text-sm font-bold text-slate-600 flex items-center gap-2 truncate"><Eye size={14}/> {ua.name}</div>
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
                                        disabled={exportingId === ua.id}
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
    const [evForm, setEvForm] = useState({ callsign: '', band: '', mode: '', date: '' });

    const previewData = {
        callsign: (() => {
            try {
                return JSON.parse(localStorage.getItem('ham_user') || '{}').callsign || 'BH2VSQ';
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
        if (userRole === 'user') {
            checkEligibility();
        }
    }, []);

    useEffect(() => {
        if (userRole === 'user' && award.id) {
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
        if (!evForm.callsign.trim()) { alert('请先填写对方呼号'); return; }
        setEvUploading(true);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('award_id', award.id);
            fd.append('match_callsign', evForm.callsign.trim());
            if (evForm.band) fd.append('match_band', evForm.band);
            if (evForm.mode) fd.append('match_mode', evForm.mode);
            if (evForm.date) fd.append('match_date', evForm.date);
            await apiFetch('/evidence', { method: 'POST', body: fd });
            const list = await apiFetch('/evidence/mine');
            setMyEvidence((list || []).filter((x) => x.award_id === award.id));
            alert('实物卡片已上传，等待管理员审核');
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
                        ) : (
                            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${award.bg_url})` }} />
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
                            {userRole === 'user' && (
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

                    {/* 实物材料（M4）：用户上传 QSL 卡片 */}
                    {userRole === 'user' && (
                        <div className="mt-6 pt-4 border-t">
                            <h4 className="font-bold text-sm text-slate-500 uppercase flex items-center gap-2 mb-2">
                                <ImageIcon size={14}/> 实物卡片材料
                            </h4>
                            <p className="text-xs text-slate-400 mb-3">
                                上传 QSL 卡片照片并填写卡面对应的通联信息；管理员审核通过后，会自动把匹配的日志记录标记为「已确认」，照片立即从服务器删除。
                            </p>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <label className="block col-span-2">
                                    <span className="text-xs text-slate-500">对方呼号（必填）</span>
                                    <input value={evForm.callsign} onChange={(e) => setEvForm({ ...evForm, callsign: e.target.value.toUpperCase() })} placeholder="例如: JA1ABC" className="w-full mt-1 p-2 border rounded-lg uppercase text-sm" />
                                </label>
                                <label className="block">
                                    <span className="text-xs text-slate-500">波段</span>
                                    <select value={evForm.band} onChange={(e) => setEvForm({ ...evForm, band: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm">
                                        <option value="">不限</option>
                                        {QSL_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-xs text-slate-500">操作模式</span>
                                    <select value={evForm.mode} onChange={(e) => setEvForm({ ...evForm, mode: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm">
                                        <option value="">不限</option>
                                        {QSL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </label>
                                <label className="block col-span-2">
                                    <span className="text-xs text-slate-500">通联日期</span>
                                    <input type="date" value={evForm.date} onChange={(e) => setEvForm({ ...evForm, date: e.target.value })} className="w-full mt-1 p-2 border rounded-lg text-sm" />
                                </label>
                            </div>
                            <input ref={evidenceFileRef} type="file" accept="image/*" className="hidden" onChange={handleEvidenceUpload} />
                            <button
                                type="button"
                                onClick={() => evidenceFileRef.current && evidenceFileRef.current.click()}
                                disabled={evUploading}
                                className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-60"
                            >
                                {evUploading ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}
                                {evUploading ? '上传中…' : '上传实物卡片照片'}
                            </button>
                            {myEvidence.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs">
                                    {myEvidence.map((ev) => (
                                        <li key={ev.id} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded border">
                                            <span className="text-slate-600">
                                                {ev.match_callsign || 'QSL 卡片'}
                                                {ev.match_band ? ` · ${ev.match_band}` : ''}
                                                {ev.match_mode ? ` · ${ev.match_mode}` : ''}
                                                {ev.match_date ? ` · ${ev.match_date}` : ''}
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
                    {mode !== 'view_only' && canApply && userRole === 'user' && (
                        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-700">
                                <Info size={15} /> 申领须知
                            </div>
                            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                                <li>资格由本奖状的规则自动判定，可查看下方进度与明细；条件未满足时无法申领。</li>
                                <li>同一奖状的<b>同一等级只能领取一次</b>，请在条件达成后再申领。</li>
                                <li>可用 QSL 实物卡片补充确认：审核通过后计入成绩，照片在审核结束后立即删除。</li>
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
                        <div className="h-48 bg-slate-200 bg-cover bg-center relative" style={{backgroundImage: `url(${aw.bg_url})`}}>
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

    const handleDelete = async (id) => {
        if(!confirm('确定删除此记录吗？')) return;
        try {
            await apiFetch(`/awards/${id}`, { method: 'DELETE' });
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
                                    <div className="h-32 bg-slate-100 bg-cover bg-center relative" style={{backgroundImage: `url(${d.bg_url})`}}>
                                        {isReturnedMode && <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded font-bold">已退回</div>}
                                    </div>
                                    <div className="p-4">
                                        <h4 className="font-bold mb-1">{d.name || '未命名奖状'}</h4>
                                        {isReturnedMode && d.reject_reason && (
                                            <div className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">原因: {d.reject_reason}</div>
                                        )}
                                        <div className="flex gap-2 mt-4">
                                            <button onClick={()=>setEditingAward(d)} className="flex-1 bg-slate-900 text-white py-2 rounded-lg text-sm font-bold">编辑/重交</button>
                                            <button onClick={()=>handleDelete(d.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
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
                                            <button onClick={()=>apiFetch('/admin/awards/audit', {method:'POST', body:JSON.stringify({id:item.id, action:'approve'})}).then(()=>{alert('已通过');load()})} className="px-3 py-1 bg-green-100 text-green-700 rounded font-bold text-sm">通过</button>
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
const IssuanceManager = () => {
    const [issuanceList, setIssuanceList] = useState([]);

    const load = () => {
        apiFetch('/admin/issued-awards').then(setIssuanceList).catch(console.error);
    };

    useEffect(() => { load(); }, []);

    const handleDeleteIssuance = async (id) => {
        if(!confirm('确定要撤销并删除该颁发记录吗？')) return;
        try {
            await apiFetch(`/admin/issued-awards/${id}`, { method: 'DELETE' });
            alert('删除成功');
            load();
        } catch(e) { alert(e.message); }
    };

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2"><Trophy className="text-orange-500"/> 颁发管理 (Issuance Management)</h3>
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="p-4">颁发ID</th><th className="p-4">奖状名称</th><th className="p-4">序列号</th><th className="p-4">申请时间</th><th className="p-4">申请人</th><th className="p-4">等级</th><th className="p-4">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {issuanceList.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-slate-400">暂无颁发记录</td></tr>}
                        {issuanceList.map(item => (
                            <tr key={item.id}>
                                <td className="p-4 text-xs font-mono">{item.id}</td>
                                <td className="p-4 font-bold">{item.award_name} <span className="text-xs text-slate-400">({item.tracking_id})</span></td>
                                <td className="p-4 font-mono text-sm">{item.serial_number}</td>
                                <td className="p-4 text-sm text-slate-500">{new Date(item.issued_at).toLocaleString()}</td>
                                <td className="p-4 font-bold text-blue-600">{item.applicant_call}</td>
                                <td className="p-4"><span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold">{item.level}</span></td>
                                <td className="p-4">
                                    <button onClick={()=>handleDeleteIssuance(item.id)} className="p-2 bg-red-50 text-red-600 rounded hover:bg-red-100 text-xs font-bold flex items-center gap-1"><Trash2 size={14}/> 删除颁发</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// 4. Award Designer (Updated for Full Collection Checkbox)
const AwardDesigner = ({ initData, onClose }) => {
    // Basic UI States
    const [step, setStep] = useState(1);
    const [bgUrl, setBgUrl] = useState(initData?.bg_url || '');
    // 可视化布局（v2 schema，单位 mm）。旧数据（[] 或旧结构）会被归一化成空布局。
    const [layout, setLayout] = useState(() => normalizeLayout(initData?.layout, initData?.bg_url));
    
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

            const finalBgUrl = layout.canvas?.bgUrl || bgUrl;
            if (!finalBgUrl) throw new Error("请先在「视觉设计」里上传奖状底图");

            // ★ 保存前检测外站图片：跨域会污染 canvas 导致导出失败 + 随时可能失效
            const external = collectExternalImages({
                ...layout,
                canvas: { ...layout.canvas, bgUrl: finalBgUrl },
            });
            if (external.length) {
                const shown = external.slice(0, 3).join('\n');
                const more = external.length > 3 ? `\n…另有 ${external.length - 3} 张` : '';
                const ok = window.confirm(
                    `检测到 ${external.length} 张图片来自外部网站：\n\n${shown}${more}\n\n` +
                    '这些图片可能导致：\n' +
                    '· 导出 PDF 时因跨域而失败或缺图\n' +
                    '· 图片随时失效（对方删除 / 更换防盗链）\n\n' +
                    '强烈建议改为上传到本站。仍要继续保存吗？',
                );
                if (!ok) return; // 用户选择返回修改，不保存
            }

            await apiFetch('/awards', {
                method: 'POST',
                body: JSON.stringify({
                    id: initData?.id,
                    name: meta.name,
                    description: meta.description,
                    bg_url: finalBgUrl,
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
                                    <li><b>奖状名称</b>与<b>底图</b>为必填项，缺少任一项都无法保存草稿或提交审核。</li>
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
const AllLogsView = () => {
    const [logs, setLogs] = useState([]);
    const [detailQso, setDetailQso] = useState(null);
    const [qsoAwards, setQsoAwards] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 3. 修复：当前普通用户界面中，全部日志未显示当前用户的完整日志
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
    }, []);

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
            <h3 className="font-bold text-lg flex items-center gap-2"><List className="text-blue-600"/> 全部日志</h3>
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
                                <th className="p-4">Country</th>
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
                                        <td className="p-4 font-bold">{log.callsign}</td>
                                        <td className="p-4">{log.band}</td>
                                        <td className="p-4">{log.mode}</td>
                                        <td className="p-4 text-slate-500 truncate max-w-[150px]">{log.country}</td>
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
                            <div className="col-span-2"><span className="text-slate-400 block text-xs uppercase">Country</span><span className="font-bold">{detailQso.country || '-'}</span></div>
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
            const r = window.prompt('请输入驳回原因：');
            if (!r || !r.trim()) return;
            reason = r.trim();
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

    const handleAction = async (method, url, body = {}) => {
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-xl flex items-center gap-2"><User size={24}/> 用户管理</h3>
                <button onClick={()=>setCreating(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2"><UserPlus size={18}/> 添加用户</button>
            </div>
            {roleRequests.length > 0 && (
                <div className="bg-white rounded-xl shadow border border-purple-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-purple-50/50">
                        <h4 className="font-bold text-sm text-purple-700 flex items-center gap-2"><Trophy size={16}/> 角色升级申请</h4>
                    </div>
                    {roleRequests.map((r) => (
                        <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-50 last:border-0">
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm text-slate-800">{r.callsign}</div>
                                <div className="text-xs text-slate-400">申请成为「奖状管理员」 · {new Date(r.created_at).toLocaleDateString('zh-CN')}</div>
                                {r.award_name && <div className="text-xs text-slate-700 mt-1">拟创建奖状：<b>{r.award_name}</b></div>}
                                {r.reason && <div className="text-xs text-slate-500 mt-1 bg-slate-50 rounded p-2">理由：{r.reason}</div>}
                                {r.experience && <div className="text-xs text-slate-500 mt-1">经验/背景：{r.experience}</div>}
                                {r.contact && <div className="text-xs text-slate-500 mt-1">联系方式：{r.contact}</div>}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => reviewRoleRequest(r.id, 'approve')} disabled={reviewingReqId === r.id} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-60">通过</button>
                                <button onClick={() => reviewRoleRequest(r.id, 'reject')} disabled={reviewingReqId === r.id} className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 disabled:opacity-60">驳回</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {users.length === 0 ? (
                <div className="text-center p-8 bg-white rounded-xl shadow border border-slate-100 text-slate-400">暂无用户数据或加载失败</div>
            ) : (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b">
                            <tr><th className="p-4">ID</th><th className="p-4">呼号</th><th className="p-4">角色</th><th className="p-4">2FA</th><th className="p-4">操作</th></tr>
                        </thead>
                        <tbody className="divide-y">
                            {users.map(u => (
                                <tr key={u.id}>
                                    <td className="p-4">{u.id}</td>
                                    <td className="p-4 font-mono font-bold">{u.callsign}</td>
                                    <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${u.role==='admin'?'bg-red-100 text-red-700':u.role==='award_admin'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>{u.role}</span></td>
                                    <td className="p-4">{u.has_2fa ? <Check className="text-green-500"/> : <span className="text-slate-300">-</span>}</td>
                                    <td className="p-4 flex gap-2">
                                        <button onClick={()=>setEditing(u)} className="p-2 hover:bg-slate-100 rounded"><Edit size={16}/></button>
                                        <button onClick={()=>handleAction('DELETE', `/admin/users/${u.id}`)} className="p-2 hover:bg-red-50 text-red-500 rounded"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
                            if (creating) handleAction('POST', '/admin/users', newUserInfo);
                            else { const pass = document.getElementById('modal-pass').value; handleAction('PUT', `/admin/users/${editing.id}`, { role: editing.role, password: pass || undefined }); }
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
  const [show2FAInput, setShow2FAInput] = useState(false);
  const [loginForm, setLoginForm] = useState({});
  const [authMode, setAuthMode] = useState('login'); // Added for in-page register
  // OAuth（M5）：登录页按钮显隐 + 授权后「补全呼号」会话
  const [oauthProviders, setOauthProviders] = useState([]);
  const [oauthPendingToken, setOauthPendingToken] = useState(null);
  const [oauthPendingUsername, setOauthPendingUsername] = useState('');
  
  // New States for Menu and Notifications
  const [expandedMenus, setExpandedMenus] = useState({});
  const [notifications, setNotifications] = useState({ pending: 0, returned: 0 });
  const [notifData, setNotifData] = useState({ list: [], unread: 0 });
  const [notifPanel, setNotifPanel] = useState(false);

  useEffect(() => {
    // OAuth 回调/绑定（M5）：后端 302 跳回，URL 带 token 或 bind_token，
    // 必须在 system-status 初始化之前处理，避免竞态覆盖。
    const hash = window.location.hash || '';
    if (hash.startsWith('#/oauth/callback')) {
      const q = new URLSearchParams(hash.split('?')[1] || '');
      const token = q.get('token');
      const userStr = q.get('user');
      if (token && userStr) {
        try {
          const u = JSON.parse(userStr);
          localStorage.setItem('ham_token', token);
          localStorage.setItem('ham_user', JSON.stringify(u));
          setUser(u);
          setView('main');
          setSubView(DEFAULT_ROUTE);
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`);
          return;
        } catch (e) { /* 落到正常初始化 */ }
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
  useEffect(() => {
    fetch('/api/auth/oauth/providers')
      .then((r) => r.json())
      .then((d) => setOauthProviders(d.providers || []))
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

  // 1 & 2. Auto-check for notifications every 1 second
  useEffect(() => {
      if (view !== 'main' || !user) return;
      
      const checkNotifications = () => {
          // Re-use dashboard stats endpoint for notifications
          // In a real app, you might want a lighter endpoint
          apiFetch('/stats/dashboard').then(stats => {
              if (user.role === 'admin') {
                  setNotifications({ pending: stats.awards_pending || 0 });
              } else if (user.role === 'award_admin') {
                  setNotifications({ returned: stats.my_returned || 0 });
              }
          }).catch(console.error);
      };

      const intervalId = setInterval(checkNotifications, 1000);
      checkNotifications(); // Initial check

      return () => clearInterval(intervalId);
  }, [view, user]);

  // 站内通知（M4.1）：每 10 秒拉一次未读数 + 列表
  useEffect(() => {
      if (view !== 'main' || !user) return;
      const poll = () => {
          apiFetch('/notifications').then((d) => setNotifData({ list: d.list || [], unread: d.unread || 0 })).catch(() => {});
      };
      poll();
      const t = setInterval(poll, 10000);
      return () => clearInterval(t);
  }, [view, user]);

  const markAllRead = async () => {
      try {
          await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) });
          setNotifData((prev) => ({ list: prev.list.map((n) => ({ ...n, read: true })), unread: 0 }));
      } catch (e) { /* ignore */ }
  };

  // 点单条通知即视为已读
  const markRead = async (id) => {
      try {
          await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ id }) });
          setNotifData((prev) => ({
              list: prev.list.map((n) => (n.id === id ? { ...n, read: true } : n)),
              unread: Math.max(0, prev.unread - 1),
          }));
      } catch (e) { /* ignore */ }
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
      try {
          const res = await apiFetch('/auth/oauth/complete', { method: 'POST', body: JSON.stringify({ pending_token: oauthPendingToken, callsign, password }) });
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
          // 1 & 2. Click to clear red dot simulation (real clear happens on next poll usually, but UI can be optimistic)
          if (item.id === 'admin_audit') setNotifications(prev => ({ ...prev, pending: 0 }));
          if (item.id === 'award_returned') setNotifications(prev => ({ ...prev, returned: 0 })); 
          // Note: Logic says "Click to enter interface then eliminate red dot". 
          // The interval will keep it 0 if the backend status changes, or we can just ignore it locally until refresh.
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
    const primaryBtn = 'w-full rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 py-3.5 font-bold text-slate-950 shadow-lg shadow-cyan-500/25 transition-all hover:-translate-y-0.5 hover:from-cyan-300 hover:to-indigo-300 active:scale-95';
    return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 antialiased`}>
      {/* 背景光晕：与首页保持一致的深色科技风 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top, rgba(56,189,248,0.16), transparent 55%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at bottom right, rgba(99,102,241,0.20), transparent 55%)' }} />
        <div className="absolute -left-24 -top-24 h-96 w-96 animate-float-slow rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-96 w-96 animate-float rounded-full bg-indigo-500/20 blur-3xl" />
      </div>

      <button
        type="button"
        onClick={() => setView('landing')}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-1.5 text-sm font-bold text-slate-400 transition-colors hover:text-white"
      >
        <span className="text-base leading-none">←</span> 返回首页
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
        className="absolute right-6 top-6 z-10 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-bold text-slate-300 transition-colors hover:text-white"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        <span className="hidden sm:inline">{theme === 'dark' ? '白天' : '夜间'}</span>
      </button>

      <div className="relative z-10 w-full max-w-md animate-scale-in overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl shadow-slate-950/60 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-8 pb-5 pt-7">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-slate-950 shadow-lg shadow-cyan-500/30">
                <Award size={20} strokeWidth={2.5} />
            </span>
            <div>
                <div className="text-sm font-black tracking-[0.2em]">HAM<span className="text-cyan-400">AWARDS</span></div>
                <div className="text-[11px] text-slate-500">业余无线电奖状管理平台</div>
            </div>
        </div>
        <div className="flex border-b border-white/10">
            <button onClick={()=>setAuthMode('login')} className={`flex-1 py-3.5 font-bold text-sm transition-colors ${authMode==='login'?'bg-white/5 text-cyan-300':'text-slate-500 hover:text-slate-300'}`}>登录</button>
            <button onClick={()=>setAuthMode('register')} className={`flex-1 py-3.5 font-bold text-sm transition-colors ${authMode==='register'?'bg-white/5 text-cyan-300':'text-slate-500 hover:text-slate-300'}`}>注册新账号</button>
        </div>

        {authMode === 'oauth_complete' ? (
            <div className="p-8">
                <div className="text-center mb-6">
                    <h2 className="text-xl font-bold text-white">完成 HamCQ 登录</h2>
                    <p className="text-xs text-slate-400 mt-1">已通过 HamCQ 账号「{oauthPendingUsername}」授权。请确认你的呼号（HamCQ 用户名不一定是呼号），再继续。</p>
                </div>
                <form onSubmit={handleOauthComplete} className="space-y-4">
                    <div className="space-y-1">
                        <label className={labelCls}>本站呼号</label>
                        <input name="callsign" required defaultValue={oauthPendingUsername} className={`${field} uppercase`} placeholder="例如: BH7CSA" />
                    </div>
                    <div className="space-y-1">
                        <label className={labelCls}>本站密码（可选）</label>
                        <PasswordInput variant="dark" name="password" autoComplete="new-password" className={field} />
                        <span className="text-[10px] text-slate-500">若该呼号已注册，必须填写其本站密码完成绑定；若是新账号，可设置密码以便日后密码登录，留空则只能用 HamCQ 登录。</span>
                    </div>
                    <button className={primaryBtn}>确认并登录</button>
                    <button type="button" onClick={() => { setAuthMode('login'); setOauthPendingToken(null); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); }} className="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-300">返回登录</button>
                </form>
            </div>
        ) : authMode === 'login' ? (
            <div className="p-8">
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

                {oauthProviders.length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs text-slate-500">或</span>
                            <div className="flex-1 h-px bg-white/10" />
                        </div>
                        <button
                            type="button"
                            onClick={() => { window.location.href = '/api/auth/oauth/start'; }}
                            className="w-full rounded-xl border border-white/15 py-3 font-bold text-sm text-slate-200 transition-colors hover:bg-white/5"
                        >
                            {oauthProviders[0].label || '使用 HamCQ 登录'}
                        </button>
                    </div>
                )}
            </div>
        ) : (
            <div className="p-8">
                <div className="text-center mb-6">
                    <h2 className="text-xl font-bold text-white">欢迎加入 HAM AWARDS</h2>
                    <p className="text-xs text-slate-400 mt-1">创建您的账户以申请奖状和管理日志</p>
                </div>
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
                    <button className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3.5 font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:-translate-y-0.5 hover:from-emerald-300 hover:to-teal-300 active:scale-95">立即注册</button>
                </form>
            </div>
        )}
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
          
          // Award Admin Only (Split Views with Dropdown)
          { id: 'award_create', label: '新建奖状', icon: Plus, show: user.role === 'award_admin' },
          { 
              id: 'drafts_group', 
              label: '草稿箱', 
              icon: FileText, 
              show: user.role === 'award_admin',
              isDropdown: true,
              children: [
                  { id: 'award_drafts', label: '我的草稿' },
                  { id: 'award_returned', label: '打回草稿', notification: notifications.returned }
              ],
              notification: notifications.returned // 2. Parent red dot if child has notifications
          },
          { id: 'award_audit_list', label: '审核列表', icon: List, show: user.role === 'award_admin' },

          // System Admin Only (Split Views)
          { id: 'admin_audit', label: '奖状审核', icon: CheckCircle, show: user.role === 'admin', notification: notifications.pending }, // 1. System Admin Red Dot
          { id: 'admin_overview', label: '奖状总览', icon: Layout, show: user.role === 'admin' },
          { id: 'issuanceManager', label: '颁发管理', icon: Trophy, show: user.role === 'admin' }, 
          { id: 'users', label: '用户管理', icon: Users, show: user.role === 'admin' },
          { id: 'evidence_audit', label: '实物材料审核', icon: ImageIcon, show: user.role === 'admin' || user.role === 'award_admin' },
          
          // Common Bottom
          { id: 'userCenter', label: '用户中心', icon: User, show: true },
      ].filter(i => i.show);

      return (
          <div className={`${theme === 'dark' ? 'app-dark bg-slate-950' : 'bg-slate-50'} relative flex h-screen overflow-hidden`}>
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top, rgba(56,189,248,0.10), transparent 55%)' }} />
                  <div className="absolute -right-32 top-1/3 h-96 w-96 animate-float rounded-full bg-indigo-500/10 blur-3xl" />
              </div>
              <aside className="relative z-10 w-64 bg-slate-900/70 backdrop-blur-xl text-white flex flex-col shrink-0 border-r border-white/10">
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
                      {menu.map(item => (
                          <div key={item.id}>
                            <button 
                                onClick={() => handleMenuClick(item)} 
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
                                            onClick={() => handleMenuClick(child)}
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
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 px-6 py-4 text-[11px] text-slate-500">
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
              <main className="relative z-10 flex-1 overflow-y-auto p-8">
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
                      {subView === 'userCenter' && <UserCenterView user={user} refreshUser={refreshUser} onLogout={handleLogout} />}
                  </div>
              </main>
          </div>
      );
  }
  return null;
}