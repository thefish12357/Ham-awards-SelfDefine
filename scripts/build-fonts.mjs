/**
 * 从 @fontsource（devDependency）提取思源黑体 / 思源宋体的 woff2 分片，
 * 落到 public/fonts/ 并生成 src/styles/fonts.css。
 *
 * 用法（仅在需要更新字体时执行）：
 *   npm install
 *   node scripts/build-fonts.mjs
 *
 * ★ 授权：Noto Sans SC / Noto Serif SC 即思源黑体 / 思源宋体，采用
 *   **SIL Open Font License 1.1**（可商用、可再分发）。OFL 要求随字体分发许可证，
 *   因此脚本会把 LICENSE 一并复制成 public/fonts/LICENSE-*.txt —— 不要删。
 *
 * ★ 为什么只自托管这两款：字体有版权红线，禁止商业字体（见 AGENTS.md §7 第 12 条）。
 *
 * ★ 为什么要自托管：字体能否生效取决于渲染机器装没装。不自托管时，
 *   管理员用思源黑体设计的奖状，在没装该字体的用户端 / 导出端会静默回退。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'fonts');
const CSS_OUT = join(ROOT, 'src', 'styles', 'fonts.css');

/** 只自托管这两个字重。再加字重会线性增加仓库体积（每字重约 3.4–4.6 MB）。 */
const WEIGHTS = [400, 700];

const FAMILIES = [
    { pkg: '@fontsource/noto-sans-sc', label: '思源黑体 / Noto Sans SC' },
    { pkg: '@fontsource/noto-serif-sc', label: '思源宋体 / Noto Serif SC' },
];

mkdirSync(OUT_DIR, { recursive: true });

const copied = new Set();       // 已复制的 woff2 文件名
const faceBlocks = [];          // 改写后的 @font-face 块

for (const fam of FAMILIES) {
    const pkgDir = join(ROOT, 'node_modules', fam.pkg);
    if (!existsSync(pkgDir)) {
        // 刻意不写进 package.json：字体文件已提交在 public/fonts，构建完全用不到它，
        // 写进去会让 Docker 构建白白下载 160MB+。只在更新字体时临时装一次。
        throw new Error(
            `缺少依赖 ${fam.pkg}。字体文件已提交在 public/fonts，日常构建不需要它；\n` +
            `仅在需要更新字体时才临时安装：npm install --no-save @fontsource/noto-sans-sc @fontsource/noto-serif-sc`
        );
    }

    for (const weight of WEIGHTS) {
        // 以 CSS 为准：只复制 CSS 真正引用的分片，保证文件与 @font-face 一一对应
        // （files/ 里还有 chinese-simplified-*.woff2 这类**未声明 unicode-range**的整包文件，
        //   一旦引用就会被全量下载，且不含西文/符号，故不使用）
        const css = readFileSync(join(pkgDir, `${weight}.css`), 'utf8');
        const blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
        for (const block of blocks) {
            const m = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
            if (!m) continue;
            const name = m[1];
            if (!copied.has(name)) {
                copyFileSync(join(pkgDir, 'files', name), join(OUT_DIR, name));
                copied.add(name);
            }
            faceBlocks.push(block.replace(/src:[^;]*;/, `src: url('/fonts/${name}') format('woff2');`));
        }
    }

    // 3) OFL 要求：分发字体必须附带许可证
    const lic = join(pkgDir, 'LICENSE');
    if (existsSync(lic)) {
        copyFileSync(lic, join(OUT_DIR, `LICENSE-${fam.pkg.replace('@fontsource/', '')}.txt`));
    }

    console.log(`✓ ${fam.label}（${WEIGHTS.join('/')}）`);
}

const slicesPerFont = Math.round(copied.size / WEIGHTS.length / FAMILIES.length);

const header = `/*
 * 自托管字体：思源黑体（Noto Sans SC）+ 思源宋体（Noto Serif SC）
 * 授权：SIL Open Font License 1.1 —— 可商用、可再分发
 * 许可证副本：public/fonts/LICENSE-noto-sans-sc.txt、LICENSE-noto-serif-sc.txt
 *
 * ⚠️ 本文件由 scripts/build-fonts.mjs 自动生成，不要手动编辑。
 *    更新字体：npm install 后重新执行 node scripts/build-fonts.mjs
 *
 * 中文按 unicode-range 切成 ${slicesPerFont} 个分片，浏览器只会下载实际用到的那几片，
 * 因此仓库体积虽大，首屏并不会下载全部。
 */
`;

mkdirSync(dirname(CSS_OUT), { recursive: true });
writeFileSync(CSS_OUT, header + faceBlocks.join('\n\n') + '\n', 'utf8');

console.log(`\n字体文件 ${copied.size} 个 -> public/fonts/`);
console.log(`@font-face 块 ${faceBlocks.length} 条 -> src/styles/fonts.css`);
