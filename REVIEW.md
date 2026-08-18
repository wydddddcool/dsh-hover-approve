# dsh-hover-approve 代码审查报告（第二轮复检）

> ## 重启后验证清单（v0.2.0 发布前）
>
> 分两档预期，避免把「短时验证」说得太满：
>
> **A. 重启后立即可验（2 项，30 秒内）**
> 1. **归档过滤（本轮核心修复）**：已归档的「幸运咖小程序社区需求开…」会话——重启后**不应再弹**「目标已阻断」气泡（此前误弹就是这个 bug）。不弹 = 修复生效 ✅
> 2. **插件正常挂载**：页面无报错，有黄点会话时气泡按预期弹出/锚定。
>
> **B. 等真实事件触发时才可验（4 项，不保证短时出现，遇上验一个即可，不阻塞发布）**
> 3. 授权：会话请求权限 → 气泡显示工具/智能体说明/文件/命令 + 拒绝/授权按钮可用；
> 4. 选择：askUserQuestion 到来 → 单选点选即答 / 多选勾选确认；
> 5. 计划确认：plan-review 场景 → 计划卡片 + 批准/拒绝；
> 6. 查看后关闭：目标阻断 / 多题批次点「去会话查看」→ 打开会话同时气泡关闭。
>
> **判定**：A 两项过 + B 项在后续使用中逐条确认无异常 → 升 1.0.0。

> ✅ **2026-08-16 终修确认**：本轮 3 个 🔴 已全部修复并验证——
> - 🔴-1：`respondApproval(sessionId, outcome, approvalId)` 已绑定展示时捕获的 approvalId，找不到即抛错不发送（见 `lib/client.js`）；
> - 🔴-2：README 已重写为四模式完整版（授权/选择/计划确认/目标阻断 + 安装/测试/兼容性/限制）；
> - 🔴-3：test.mjs 的 10 个夹具缺陷已修（跨 realm 比较改 `sameJson`、rAF 时序加 `waitRaf`、补 `opened` return），**npm test 15/15 全绿**。
> 代码已同步 profile 副本，可进入发布准备（升 0.2.0-beta、补 repository/LICENSE、真机回归）。

> 复检快照：`lib/client.js` md5 `19d56ccb8efd43f2950ed38e8bedaee0`，1243 行，mtime 2026-08-16 22:29:56（已稳定，语法通过）；`package.json` 0.1.1；`test.mjs` 20329 字节。
> 第一轮审查（快照 `788e0866`，19:27）发现的多数问题已在本轮修复，见文末「本轮已修复清单」。

---

## 结论先行

- **总体评分：7.0 / 10**（较上轮 6.0 上升）
- **一句话结论**：question / plan-review 链路已经接通并有 jsdom 测试覆盖，重试、卸载清理、视口钳制等上轮 🟡 项基本修完；当前剩余 3 个阻断项——**授权应答仍未与展示的 approvalId 绑定（误授权竞态）**、**README 仍停留在 v1 只讲 approval**、**npm test 10/15 失败（全部为测试夹具缺陷，产品逻辑本身正确）**。
- **是否可发布**：❌ 暂不可发布。修完 3 个 🔴（其中测试需修到 15/15 全绿）后，可以 `0.2.0-beta` 发布。

---

## 🔴 阻断项（必须修复）

### 🔴-1 授权应答仍未绑定展示时的 approvalId，「所见非所批」竞态依旧存在
- **位置**：`lib/client.js:1072-1080`（展示时捕获 `approvalId`）→ `lib/client.js:872`（点击时只传 `sessionId, outcome`）→ `lib/client.js:1084-1101`（重新 `pending.find(kind==='approval')` 取第一个应答）
- **问题**：气泡展示审批 A 后，若 A 被解决、同一会话又来了审批 B（列表 summary 仍是 `approval`），用户点「授权」会批准一个**从未展示过**的 B；多审批并存时也总批第一个。Host 端校验只保证 payload 与 rpcId 路由一致，拦不住这种「对象被替换」的错批。
- **理由**：授权类插件的确认对象完整性是安全底线，必须修。
- **修法**：`respondApproval(sessionId, outcome, approvalId)` 用 `info.approvalId` 精确匹配 PendingWait（`pending.find(p => p.kind==='approval' && p.payload.approvalId===approvalId)`），找不到就抛错不发送；顺带把锚点与 `PendingWait.key` 绑定（见 🟡-1）。

### 🔴-2 README 严重过期，与代码/package.json 四处不一致
- **位置**：`README.md:3`、`:5-20`（整篇只讲 approval）、`:48`「只处理授权（approval）…question / plan-review v1 不处理」
- **问题**：代码现已支持 approval + question（单选/多选/多题批次/纯文本兜底）+ plan-review + goal-blocked，`package.json:3` 描述也已更新为四种模式，唯独 README 停留在 v1。用户按 README 会得到完全错误的预期，npm/awesome 发布时文档失真是硬伤。
- **修法**：按最终实现重写 README：四种模式的效果/协议/限制、兼容性声明（dsh 0.1.0-rc.6 实测）、安装/卸载/热更说明、截图或 GIF。

### 🔴-3 npm test 10/15 失败（测试夹具缺陷，修到 15/15 才能发布）
- **位置**：`test.mjs`（15 个用例，当前 pass 5 / fail 10）
- **失败明细与根因**：
  1. `test.mjs:163` 首个 approval 用例断言 `bubble.style.left === '210px'` 时拿到 `''`——`anchorAll` 用 rAF 定位，气泡在 350ms 防抖后 append，rAF 要到下一帧（约 400ms）才写 left；断言与 rAF 存在事件循环时序竞争。修法：断言前 `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))` 或轮询到 `style.left` 非空。
  2. `test.mjs:189 / 218 / 280 / 321 / 357` 共 5 处 `assert.deepStrictEqual(respondCalls[0], {...})` 失败——`respondCalls` 里的消息对象是 jsdom window realm 创建的，与 Node realm 的期望对象原型不同（报错「same structure but are not reference-equal」；实际 payload 与期望完全一致）。修法：比较 `JSON.parse(JSON.stringify(respondCalls[0]))`，或改逐字段断言。
  3. `test.mjs:389 / 410 / 443` 共 3 处 `h.opened` 为 `undefined`——`setup()` 内部定义了 `opened` 数组（`test.mjs:53`）但没有放进 `test.mjs:110` 的 return 对象。修法：return 中补 `opened`（产品代码 `ctx.sessions.open` 调用本身正常）。
  4. `test.mjs:547-555` `fileInfoOfArgs` 返回的对象同样是 jsdom realm 对象，跨 realm `deepStrictEqual` 失败。修法：同 2（JSON 序列化比较或逐字段断言）。
- **理由**：`npm test` 是 CI/社区第一道门禁，红着不能发。
- **修法**：按上述四点修 test.mjs，并确保 `npm test` 15/15 通过后再发布。

---

## 🟡 建议项（应当修复）

### 🟡-1 同类型请求替换（A 审批解决 → B 审批到达，status 仍为 approval）不会被识别
- **位置**：`lib/client.js:1162-1177`（仅 `prev !== status` 触发重建）
- **问题**：类型切换（approval→question 等）已修复，但 status 不变、请求对象已换时，旧气泡不会重建、`dismissed` 不清除，仍展示 A 的内容——这正是 🔴-1 误授权竞态的温床。
- **修法**：reconcile 对 interactive 会话读取 `binding().session.getSnapshot().pending` 的首个 `PendingWait.key`（或 approvalId），与 `lastSeen` 记录对比；key 变化同样执行 `removeBubble + dismissed.delete + 重新 showBubble`。这同时完成 🔴-1 的绑定。

### 🟡-2 同一会话多个 approval / question 等待并存时，只能处理第一个
- **位置**：`lib/client.js:1004 / 1054`（`pending.find` 取第一个）、`lib/client.js:849-859 / 872-883`（成功后 busy 锁死）
- **问题**：第一个等待应答成功后按钮保持 disabled、`haBusy='1'`；若 summary 因第二个等待仍为 `approval`，气泡不收，第二个等待无法在气泡内操作（只能进会话）。
- **修法**：气泡按 `PendingWait.key` 维度管理；成功后主动 `removeBubble` 并让 reconcile 依据新 key 重新弹；至少成功回调里解除 busy 并重新读取 pending 刷新内容。

### 🟡-3 question / plan-review 应答未校验「等待对象仍是展示的那个」
- **位置**：`lib/client.js:1107-1125`（点击时重新 `pending.find(kind==='question')`）
- **问题**：若展示的问题已解决、同会话来了新问题，UI 会把旧答案发给新 wait。多数情况下 Host 的 `matchesQuestions`（按 id/选项校验）会拒绝，但如果新问题 id 相同且选项重叠，可能被误答。
- **修法**：把展示时捕获的 `PendingWait.key` 传入 `respondQuestion`，`pending.find(p => p.key === key)` 不匹配即抛错；发送前再对照 `question.payload.questions` 校验 answers 条数与 id。

### 🟡-4 发布元数据仍不完整
- **位置**：`package.json` 全文（已补 scripts/devDependencies/version 0.1.1/描述，很好）
- **问题**：仍缺 `repository / author / homepage / bugs`；声明 `license: MIT`（`:40`）但仓库没有 LICENSE 文件，`files`（`:23-28`）也未包含；未声明对 `@deepseek-ai/dsh-client-runtime` 的兼容范围（依赖 0.1.0-rc.6 时代的 `pendingInteraction / projectionValues / sessions.open / PendingWait` API）。
- **修法**：补齐元数据 + LICENSE；加 `peerDependencies`（可选）+ README 写明「dsh 0.1.0-rc.6 实测」。

### 🟡-5 测试套件还未覆盖两个最关键的回归点
- **位置**：`test.mjs` 整体
- **问题**：已有 15 个用例质量不错，但缺 🔴-1（审批替换后点击应答的对象绑定）和 🟡-1（同类型 key 变化重建）的回归用例——这俩正是当前最危险的洞。
- **修法**：新增「展示 approval-1 → pending 换成 approval-2 → 点击授权必须拒绝/不发送」与「status 不变但 PendingWait.key 变化 → 气泡重建」两个用例。

---

## 🟢 可选优化（可修可不修）

- **🟢-1** `readApprovalInfo` 的 goal-blocked 判断在 pending 之前（`lib/client.js:985-994`），而 `interactionOf` 的优先级相反（`lib/client.js:1131-1138`）。极端并发（goal blocked + pending approval 同时存在）时气泡会显示 goal 通知而无审批按钮。建议两者对齐优先级。
- **🟢-2** 重试 7 次（约 4s）耗尽后，用户再展开折叠工作区不会补弹（MutationObserver 只重定位已有气泡）。可在 `onMove` 中增加「交互仍激活、无 anchor、未 dismissed」会话的补建逻辑；或按 README 明确该限制。
- **🟢-3** `respondQuestion` 依赖 Host 兜底校验，客户端未预检；建议发送前对照 `question.payload.questions` 校验 id/选项/条数，提前给出明确错误提示。
- **🟢-4** `resolveLang` 只在 `apply` 时解析一次（`lib/client.js:757`），运行中切换界面语言不会更新气泡文案；如需可订阅 locale 重建。
- **🟢-5** 无障碍：气泡无 `role="dialog"/aria-live`、无 Escape 关闭/焦点管理；多选选项无 `aria-pressed`。建议补基本 ARIA 与键盘支持。
- **🟢-6** `z-index: 2147483000`（`lib/client.js:225`）极高，可能压过 DSH 弹层；建议评估降级或动态压层。
- **🟢-7** 小残留：`choose` 文案键未使用；`exports._internal` 未暴露 `interactionOf / respondApproval / respondQuestion`，不便对状态机与应答逻辑做单测。
- **🟢-8** `npm pack --dry-run` 在本机因 `~/.npm` 缓存权限失败（EPERM，环境问题而非插件问题），发布前建议换一台干净机器跑一次 `npm pack` 验证产物清单。

---

## 优点清单

- **协议正确性已达标**：approval 应答 `{sessionId, approvalId, outcome}` 与 Host zod schema 完全一致；question/plan-review 应答 `{sessionId, answer:{answers:[{id, selected}]}}` 与 `dsh-user-questions` 类型及 Host `questionResponsePayloadSchema` 一致；`receipt.accepted` 失败检查到位。
- **question/plan-review 完整落地**：单选点击即答、多选确认、多问题批次与纯文本题的「去会话查看」兜底、plan-review 收窄规则与 approve 高亮，均符合内置面板语义，且不伪造答案。
- **安全性好**：全部动态内容 `textContent`，无 innerHTML/XSS；只读列表快照 + 官方 PendingWait 应答通道，无越权路径。
- **健壮性明显提升**：`later()` 定时器登记 + 卸载统一 clearTimeout、取消 rAF、移除动画 style；reconcile 支持交互类型切换重建；retry 递归 6 次；`binding/getSnapshot/subscribe` 均有防御；视口左右/上下钳制；MutationObserver + rAF 重定位。
- **测试基础设施已建立**：jsdom 真实加载 `lib/client.js` 跑 15 个端到端用例，mock sessions 驱动，覆盖三种应答、多选、goal-blocked、状态切换、重试、钳制、卸载——虽有 10 个夹具缺陷，但骨架与断言设计优秀，修起来很快。
- **工程形态**：手写 bundle 免构建、`dsh.client`/`dsh.bundle.patch` 声明正确、`package.json` 描述/关键词/版本/测试脚本已跟上代码，中文注释清晰。

---

## 本轮已修复清单（相对上一轮快照 `788e0866`）

1. ✅ respondQuestion 改为接收 `answers` 并原样发送（修复嵌套数组协议错误）。
2. ✅ `readApprovalInfo` 补齐 `questionId / answerable / questionCount`，并实现 plan-review 收窄与 plan-review info。
3. ✅ `interactionOf` 增加 `plan-review` 分支，plan-review 气泡可触发。
4. ✅ reconcile 支持交互类型切换（approval→question 等）重建气泡，并有测试覆盖。
5. ✅ retry 递归计数到 6 次、经 `later()` 管理；「行暂缺→行出现重试弹出」测试通过。
6. ✅ 卸载清理补全：clearTimeout 全部 timers、cancelAnimationFrame、移除 `#ha-anim-style`、`retries.clear()`。
7. ✅ 视口钳制：气泡左右/上下夹在视口内（右侧钳制测试通过）。
8. ✅ `setButtonsDisabled` 不再禁用 × 关闭按钮；`anchors.size===0` 时 anchorAll 早退。
9. ✅ 防御性：`ctx.sessions.binding/subscribe/getSnapshot` 存在性检查、pending/runningCalls 数组化。
10. ✅ package.json：0.1.1、四种模式描述与关键词、`npm test` 脚本、jsdom devDependency；新增 `test.mjs`（15 用例）。

---

## 发布建议（发布前必做清单）

1. 修 🔴-1：授权应答绑定展示时的 `approvalId`/`PendingWait.key`，杜绝误授权。
2. 修 🔴-2：重写 README（四种模式 + 协议 + 限制 + 兼容性 + 截图）。
3. 修 🔴-3：按诊断修 test.mjs 的 10 个夹具缺陷，`npm test` 必须 15/15 全绿。
4. 完成 🟡-1/🟡-2/🟡-3（key 级气泡管理与应答校验），并补 🟡-5 的两个回归用例。
5. 补 repository/author/homepage/LICENSE 与兼容性声明。
6. 全模式真机回归（approval / question 单选多选 / plan-review / goal-blocked / 热重载）通过后，升 `0.2.0-beta` 上 npm。
7. 提 awesome-dsh-plugin 时附真实截图/GIF 与最终版 README。
8. 发布定稿后再按本报告逐项复核一次（审查期间源码曾多轮变动，以定稿为准）。
