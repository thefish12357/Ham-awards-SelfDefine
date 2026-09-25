import { presetAwardLayout } from './awardLayout.js';

/**
 * 落地页「在线演示」用的示例奖状数据
 * ------------------------------------------------------------------
 * 注意：这些是**演示用途的示例数据**，不是真实库里的奖状。
 * 目的是让未登录 / 未注册访客通过「真实渲染」看到奖状长什么样、
 * 规则与等级怎么写；点击进去是只读详情，进度 / 申领按钮替换为登录引导。
 *
 * 布局复用 `presetAwardLayout()`（v2 结构，AwardThumbnail / AwardRenderer 都能直接渲染），
 * 仅按奖状主题改一下描边 / 强调色，确保「真实陈列」而非假卡片。
 */

function buildLayout(accent) {
  const layout = presetAwardLayout();
  layout.elements = layout.elements.map((el) => {
    if (el.type === 'shape') return { ...el, stroke: accent };
    // preset 里强调色文字统一用 #b08a3e，跟着主题色走
    if (el.type === 'text' && el.color === '#b08a3e') return { ...el, color: accent };
    return el;
  });
  return layout;
}

export const DEMO_AWARDS = [
  {
    id: 'demo-dx-master',
    name: 'DX 大师奖',
    description: '表彰在多个不同 DXCC 实体完成确认通联的业余无线电爱好者。',
    tracking_id: 'DEMO-DX',
    bg_url: null,
    layout: buildLayout('#c8a45c'),
    rules: {
      v2: true,
      logic: 'collection',
      basic: { qslRequired: true },
      filters: [],
      targets: { type: 'dxcc', list: '' },
      thresholds: [
        { name: 'BRONZE', value: 10 },
        { name: 'SILVER', value: 50 },
        { name: 'GOLD', value: 100 },
      ],
    },
  },
  {
    id: 'demo-band-collector',
    name: '波段收集奖',
    description: '鼓励通联覆盖更多业余频段，集齐不同波段即可升级。',
    tracking_id: 'DEMO-BAND',
    bg_url: null,
    layout: buildLayout('#3b82f6'),
    rules: {
      v2: true,
      logic: 'collection',
      basic: { qslRequired: false },
      filters: [],
      targets: { type: 'any' },
      thresholds: [
        { name: 'BRONZE', value: 5 },
        { name: 'SILVER', value: 10 },
        { name: 'GOLD', value: 15 },
      ],
    },
  },
  {
    id: 'demo-grid-explorer',
    name: '网格探索奖',
    description: '探索更广阔的 Maidenhead 网格，记录你电波足迹的广度。',
    tracking_id: 'DEMO-GRID',
    bg_url: null,
    layout: buildLayout('#10b981'),
    rules: {
      v2: true,
      logic: 'collection',
      basic: { qslRequired: true, startDate: '2020-01-01' },
      filters: [],
      targets: { type: 'grid', list: '' },
      thresholds: [
        { name: 'BRONZE', value: 20 },
        { name: 'SILVER', value: 50 },
        { name: 'GOLD', value: 100 },
      ],
    },
  },
];
