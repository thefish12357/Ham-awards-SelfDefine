# data/cty.dat — 数据来源与许可

`cty.dat` 来自 **Country Files**（https://www.country-files.com），由 Jim Reisert（AD1C）维护，
是业余无线电 **DXCC 实体前缀列表**。本项目的「呼号 → DXCC / CQ 分区 / ITU 分区 / 大洲」查询（`server/services/cty.js` 的 `lookupDxcc`）依赖此文件。

- 来源：https://www.country-files.com/cty/cty.dat
- 许可：Country Files 允许自由再分发，条件是**保留原作者署名与来源链接**。本项目依此约定随源码附带该文件。
- 同步：可一键拉取上游最新版，见 `server/services/cty.js` 的 `syncCtyFromWeb()` 与 `scripts/update-cty.mjs`。

> 本文件仅含公开的「前缀 / 分区 / 大洲」对照数据，**不包含任何个人通联记录**。
