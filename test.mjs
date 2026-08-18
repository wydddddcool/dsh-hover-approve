/**
 * dsh-hover-approve 客户端气泡功能测试。
 *
 * 在 jsdom 中运行真实的 lib/client.js（window.__ModuleLoader__ 注册工厂），
 * 用 mock 的 sessions 服务驱动列表快照与 pending 帧，验证：
 *   1. approval 气泡弹出、锚定、命令/原因展示、授权与拒绝的应答编码；
 *   2. question 单选点击即答、多选勾选后确认；
 *   3. plan-review 计划卡片展示与批准应答；
 *   4. 多问题批次 / 纯文本问题：去会话查看；
 *   5. goal-blocked 通知与打开会话；
 *   6. 同一会话交互类型变化时气泡重建；
 *   7. 行不存在时重试、视口右侧钳制、卸载清理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const SOURCE = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

/** jsdom 中 getBoundingClientRect 恒为 0，给每个测试行装一个可控的矩形。 */
function installRect(el, rect) {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, ...rect })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等 jsdom 的双 rAF（anchorAll 在 rAF 里写定位样式，需跨两帧）。 */
const waitRaf = (window) => new Promise((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
})

/** 跨 realm 深比较：jsdom window 创建的对象与 Node realm 对象原型不同，
 * deepStrictEqual 会误报「same structure but not reference-equal」。 */
function sameJson(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected)
}

/** 每个测试独立装配一套浏览器环境 + 插件实例。 */
function setup() {
  const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head></head><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })
  const { window } = dom
  const { document } = window

  let handoff = null
  window.__ModuleLoader__ = {
    load(value) {
      handoff = value
    },
  }
  window.eval(SOURCE)
  assert.ok(handoff, 'client bundle should register its factory')
  const module = handoff.factory()
  assert.equal(typeof module.apply, 'function')

  // ── mock sessions 服务 ──
  const listeners = new Set()
  let listSnapshot = { ids: [], byId: {}, current: undefined }
  const bindings = new Map()
  const opened = []

  const sessions = {
    list: {
      getSnapshot: () => listSnapshot,
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      update(next) {
        listSnapshot = next
        for (const fn of [...listeners]) fn()
      },
    },
    binding(id) {
      return bindings.get(id)
    },
    open(id) {
      opened.push(id)
    },
  }

  // ── mock workspaces 服务（registry 全局归档集合）──
  const wsListeners = new Set()
  let wsSnapshot = { archivedSessionIds: [] }
  const workspaces = {
    list: {
      getSnapshot: () => wsSnapshot,
      subscribe(fn) {
        wsListeners.add(fn)
        return () => wsListeners.delete(fn)
      },
      update(next) {
        wsSnapshot = next
        for (const fn of [...wsListeners]) fn()
      },
    },
  }

  const ctx = {
    sessions,
    workspaces,
    locale: {
      getSnapshot: () => ({ active: 'zh-CN' }),
    },
  }

  /** 注册一个会话绑定：pending / runningCalls 每次 getSnapshot 现读。 */
  function setBinding(id, pending = [], runningCalls = []) {
    bindings.set(id, {
      sessionId: id,
      session: {
        getSnapshot: () => ({ pending, runningCalls }),
      },
    })
  }

  /** 新建一个列表行元素（title 精确匹配 displayTitle）。 */
  function addRow(title, rect = { width: 200, height: 32, left: 0, right: 200, top: 40, bottom: 72 }) {
    const row = document.createElement('div')
    row.setAttribute('role', 'treeitem')
    row.textContent = title
    installRect(row, rect)
    document.body.appendChild(row)
    return row
  }

  /** 更新列表快照并通知订阅者。 */
  function updateList(summaries) {
    const ids = summaries.map((s) => s.id)
    const byId = Object.fromEntries(summaries.map((s) => [s.id, s]))
    sessions.list.update({ ids, byId, current: undefined })
  }

  const dispose = module.apply(ctx)
  return {
    dom,
    window,
    document,
    module,
    ctx,
    sessions,
    workspaces,
    setBinding,
    addRow,
    updateList,
    opened,
    dispose,
  }
}

/** 做一个可应答的 pending wait，记录应答消息。 */
function makeWait(kind, payload, respondCalls, accepted = true) {
  return {
    kind,
    key: `${kind}:key`,
    sessionId: payload?.sessionId ?? 's1',
    payload,
    respond: async (message) => {
      respondCalls.push(message)
      return { accepted, reason: accepted ? undefined : 'carrier rejected' }
    },
  }
}

const APPROVAL_PAYLOAD = {
  approvalId: 'approval-1',
  toolName: 'bash',
  callId: 'call-1',
  reason: '运行测试命令',
}

test('approval：弹出锚定气泡并展示命令/原因', async () => {
  const h = setup()
  try {
    const respondCalls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, respondCalls)], [
      { callId: 'call-1', argsRaw: JSON.stringify({ command: 'npm run test' }) },
    ])
    h.addRow('会话A')
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: 'approval' }])

    await sleep(400) // 350ms 防抖
    await waitRaf(h.window) // anchorAll 在 rAF 里定位
    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.ok(bubble, '应弹出气泡')
    assert.match(bubble.textContent, /需要你授权/)
    assert.match(bubble.textContent, /运行终端命令/)
    assert.match(bubble.textContent, /\$ npm run test/)
    assert.match(bubble.textContent, /运行测试命令/)
    // 锚定：行右边缘 200 + gap 10 = 210
    assert.equal(bubble.style.left, '210px')
    assert.equal(h.document.querySelector('[data-hover-approve-tail]').style.display, '')
    assert.equal(h.document.querySelector('[data-hover-approve-dot]').style.display, '')

    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('approval：点「授权」发送 allowed-once 并显示成功状态', async () => {
  const h = setup()
  try {
    const respondCalls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, respondCalls)], [
      { callId: 'call-1', argsRaw: JSON.stringify({ command: 'npm run test' }) },
    ])
    h.addRow('会话A')
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: 'approval' }])
    await sleep(400)

    const approve = h.document.querySelector('[data-ha-outcome="allowed-once"]')
    approve.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await sleep(20)

    assert.equal(respondCalls.length, 1)
    sameJson(respondCalls[0], {
      ok: true,
      value: { sessionId: 's1', approvalId: 'approval-1', outcome: 'allowed-once' },
    })
    assert.match(h.document.querySelector('[data-ha-status]').textContent, /已授权 ✓/)
    assert.equal(approve.disabled, true)

    // 列表状态离开待授权 → 气泡收起
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: undefined }])
    await sleep(10)
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null)
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('approval：点「拒绝」发送 rejected；失败时按钮恢复', async () => {
  const h = setup()
  try {
    const respondCalls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, respondCalls, false)])
    h.addRow('会话A')
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: 'approval' }])
    await sleep(400)

    const reject = h.document.querySelector('[data-ha-outcome="rejected"]')
    reject.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await sleep(20)
    sameJson(respondCalls[0], {
      ok: true,
      value: { sessionId: 's1', approvalId: 'approval-1', outcome: 'rejected' },
    })
    assert.match(h.document.querySelector('[data-ha-status]').textContent, /操作失败/)
    assert.equal(reject.disabled, false, '失败后按钮应恢复可用')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('approval：× 关闭后本轮不再弹，新一轮交互重新弹出', async () => {
  const h = setup()
  try {
    const respondCalls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, respondCalls)])
    h.addRow('会话A')
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: 'approval' }])
    await sleep(400)
    assert.ok(h.document.querySelector('[data-hover-approve-bubble]'))

    // 点 × 关闭
    const closeBtn = h.document.querySelector('[data-hover-approve-bubble] button[aria-label="关闭"]')
    closeBtn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null)

    // 交互离开再回来 → 允许重新弹出
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: undefined }])
    h.updateList([{ id: 's1', displayTitle: '会话A', pendingInteraction: 'approval' }])
    await sleep(400)
    assert.ok(h.document.querySelector('[data-hover-approve-bubble]'), '新一轮交互应重新弹出')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('question：单选点击即答（与内置 QuestionFlow 编码一致）', async () => {
  const h = setup()
  try {
    const respondCalls = []
    const question = {
      id: 'q1',
      question: '选哪个方案？',
      options: [{ label: '方案A' }, { label: '方案B' }],
    }
    h.setBinding('s1', [makeWait('question', { questions: [question] }, respondCalls)])
    h.addRow('会话B')
    h.updateList([{ id: 's1', displayTitle: '会话B', pendingInteraction: 'question' }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.match(bubble.textContent, /需要你选择/)
    assert.match(bubble.textContent, /选哪个方案/)

    const options = bubble.querySelectorAll('[data-ha-option]')
    assert.equal(options.length, 2)
    options[0].dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await sleep(20)

    assert.equal(respondCalls.length, 1)
    sameJson(respondCalls[0], {
      ok: true,
      value: {
        sessionId: 's1',
        answer: { answers: [{ id: 'q1', selected: ['方案A'] }] },
      },
    })
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('question：多选勾选后统一确认发送', async () => {
  const h = setup()
  try {
    const respondCalls = []
    const question = {
      id: 'q2',
      question: '想保留哪些？',
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    }
    h.setBinding('s1', [makeWait('question', { questions: [question] }, respondCalls)])
    h.addRow('会话B')
    h.updateList([{ id: 's1', displayTitle: '会话B', pendingInteraction: 'question' }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    const options = bubble.querySelectorAll('[data-ha-option]')
    const confirm = bubble.querySelector('[data-ha-confirm]')
    assert.ok(confirm, '多选应有确认按钮')
    assert.equal(confirm.disabled, true)

    options[0].dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    options[2].dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    assert.equal(confirm.disabled, false)
    confirm.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await sleep(20)

    assert.equal(respondCalls.length, 1)
    sameJson(respondCalls[0], {
      ok: true,
      value: {
        sessionId: 's1',
        answer: { answers: [{ id: 'q2', selected: ['A', 'C'] }] },
      },
    })
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('plan-review：计划卡片 + 批准选项应答', async () => {
  const h = setup()
  try {
    const respondCalls = []
    const question = {
      id: 'plan-1',
      question: '这个计划可以执行吗？',
      detail: '# 计划\n1. 先做 A\n2. 再做 B',
      intent: { kind: 'plan-review', approve: '批准' },
      options: [{ label: '批准' }, { label: '拒绝' }],
    }
    h.setBinding('s1', [makeWait('question', { questions: [question] }, respondCalls)])
    h.addRow('会话C')
    h.updateList([{ id: 's1', displayTitle: '会话C', pendingInteraction: 'plan-review' }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.match(bubble.textContent, /需要你确认计划/)
    assert.match(bubble.textContent, /先做 A/)

    const approve = bubble.querySelector('[data-ha-option]')
    approve.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    await sleep(20)
    sameJson(respondCalls[0], {
      ok: true,
      value: {
        sessionId: 's1',
        answer: { answers: [{ id: 'plan-1', selected: ['批准'] }] },
      },
    })
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('question：多问题批次提示并「去会话查看」打开会话', async () => {
  const h = setup()
  try {
    const respondCalls = []
    const questions = [
      { id: 'q1', question: '第一个问题', options: [{ label: 'A' }] },
      { id: 'q2', question: '第二个问题', options: [{ label: 'B' }] },
    ]
    h.setBinding('s1', [makeWait('question', { questions }, respondCalls)])
    h.addRow('会话D')
    h.updateList([{ id: 's1', displayTitle: '会话D', pendingInteraction: 'question' }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.match(bubble.textContent, /2 个问题/)
    assert.equal(bubble.querySelectorAll('[data-ha-option]').length, 0, '多问题批次不应渲染选项')
    const openBtn = bubble.querySelector('[data-ha-open]')
    assert.ok(openBtn)
    openBtn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.opened, ['s1'])
    assert.equal(respondCalls.length, 0, '未回答时不应发请求')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('question：无选项文本题提示并打开会话', async () => {
  const h = setup()
  try {
    const respondCalls = []
    h.setBinding('s1', [makeWait('question', { questions: [{ id: 'q1', question: '请补充细节' }] }, respondCalls)])
    h.addRow('会话E')
    h.updateList([{ id: 's1', displayTitle: '会话E', pendingInteraction: 'question' }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.match(bubble.textContent, /需要输入文字/)
    const openBtn = bubble.querySelector('[data-ha-open]')
    openBtn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.opened, ['s1'])
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('goal-blocked：展示阻断原因/目标并可打开会话', async () => {
  const h = setup()
  try {
    h.addRow('会话F')
    h.updateList([{
      id: 's1',
      displayTitle: '会话F',
      pendingInteraction: undefined,
      projectionValues: {
        goal: {
          goal: {
            objective: '完成周报',
            phase: 'blocked',
            blockedReason: { code: 'round-cap', message: '目标轮次已用完' },
          },
        },
      },
    }])
    await sleep(400)

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.ok(bubble)
    assert.match(bubble.textContent, /目标已阻断/)
    assert.match(bubble.textContent, /目标轮次已用完/)
    assert.match(bubble.textContent, /完成周报/)
    bubble.querySelector('[data-ha-open]').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.opened, ['s1'])
    // 点「查看」打开会话后，气泡应收起（用户已过去看，不再挂通知）
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null, '查看后气泡应关闭')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('归档会话：不弹 goal-blocked 气泡，归档后收起且不重弹', async () => {
  const h = setup()
  try {
    const blocked = (id, title) => ({
      id,
      displayTitle: title,
      pendingInteraction: undefined,
      projectionValues: {
        goal: {
          goal: {
            objective: '旧目标',
            phase: 'blocked',
            blockedReason: { code: 'round-cap', message: '旧原因' },
          },
        },
      },
    })
    h.addRow('会话I')
    h.updateList([blocked('s1', '会话I')])
    await sleep(400)
    assert.ok(h.document.querySelector('[data-hover-approve-bubble]'), '未归档时应弹气泡')

    // 归档该会话 → 气泡立即收起
    h.workspaces.list.update({ archivedSessionIds: ['s1'] })
    await sleep(50)
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null, '归档后气泡应收起')

    // 列表快照再次变化（模拟其他会话刷新）→ 归档会话不再重新弹出
    h.addRow('会话J')
    h.updateList([blocked('s1', '会话I'), { id: 's2', displayTitle: '会话J', pendingInteraction: undefined }])
    await sleep(400)
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null, '归档会话不应因快照刷新重新弹出')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('状态切换：approval → question 同一会话气泡重建', async () => {
  const h = setup()
  try {
    const calls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, calls)])
    h.addRow('会话G')
    h.updateList([{ id: 's1', displayTitle: '会话G', pendingInteraction: 'approval' }])
    await sleep(400)
    let bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.match(bubble.textContent, /需要你授权/)

    // 交互类型直接变化（不经过 none）
    const question = { id: 'q1', question: '改选哪个？', options: [{ label: 'X' }] }
    h.setBinding('s1', [makeWait('question', { questions: [question] }, calls)])
    h.updateList([{ id: 's1', displayTitle: '会话G', pendingInteraction: 'question' }])
    await sleep(50)

    bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.ok(bubble, '状态变化后应重建气泡')
    assert.match(bubble.textContent, /需要你选择/)
    assert.match(bubble.textContent, /改选哪个/)
    assert.doesNotMatch(bubble.textContent, /需要你授权/)
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('行暂缺：重试后等行出现再弹出', async () => {
  const h = setup()
  try {
    const calls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, calls)])
    h.updateList([{ id: 's1', displayTitle: '会话H', pendingInteraction: 'approval' }])
    await sleep(400)
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null, '行不存在不弹')

    h.addRow('会话H')
    await sleep(700) // 600ms 重试间隔
    assert.ok(h.document.querySelector('[data-hover-approve-bubble]'), '行出现后重试应弹出')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('定位：行靠近视口右缘时气泡向左钳制', async () => {
  const h = setup()
  try {
    const calls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, calls)])
    h.addRow('会话I', { width: 200, height: 32, left: 280, right: 480, top: 40, bottom: 72 })
    Object.defineProperty(h.window, 'innerWidth', { value: 500, configurable: true })
    h.updateList([{ id: 's1', displayTitle: '会话I', pendingInteraction: 'approval' }])
    await sleep(400)
    await waitRaf(h.window) // anchorAll 在 rAF 里定位

    const bubble = h.document.querySelector('[data-hover-approve-bubble]')
    assert.equal(bubble.style.left, '52px', '500 - 440(宽) - 8 = 52，气泡应留在视口内')
    h.dispose()
  } finally {
    h.dom.window.close()
  }
})

test('卸载清理：气泡、样式、待触发的定时器全部清掉', async () => {
  const h = setup()
  try {
    const calls = []
    h.setBinding('s1', [makeWait('approval', APPROVAL_PAYLOAD, calls)])
    h.addRow('会话J')
    h.updateList([{ id: 's1', displayTitle: '会话J', pendingInteraction: 'approval' }])
    await sleep(400)
    assert.ok(h.document.querySelector('[data-hover-approve-bubble]'))

    // 触发一个处于防抖中的新交互，立刻卸载
    h.updateList([{ id: 's1', displayTitle: '会话J', pendingInteraction: undefined }])
    h.updateList([{ id: 's1', displayTitle: '会话J', pendingInteraction: 'approval' }])
    h.dispose()
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null)
    assert.equal(h.document.getElementById('ha-anim-style'), null)

    await sleep(400)
    assert.equal(h.document.querySelector('[data-hover-approve-bubble]'), null, '卸载后定时器不应再产生气泡')
  } finally {
    h.dom.window.close()
  }
})

test('工具函数：fileInfoOfArgs 兼容 write/edit/str-replace-editor 参数形态', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
  const { window } = dom
  let handoff = null
  window.__ModuleLoader__ = { load: (v) => { handoff = v } }
  window.eval(SOURCE)
  const { fileInfoOfArgs, findSessionRow } = handoff.factory()._internal

  sameJson(
    fileInfoOfArgs(JSON.stringify({ file_path: '/tmp/a.md', content: 'hello world' })),
    { path: '/tmp/a.md', preview: 'hello world' },
  )
  sameJson(
    fileInfoOfArgs(JSON.stringify({ path: '/tmp/b.ts', old_string: 'a', new_string: 'b' })),
    { path: '/tmp/b.ts', preview: 'b' },
  )
  sameJson(
    fileInfoOfArgs(JSON.stringify({ path: '/tmp/c.html', file_text: '<div>x</div>' })),
    { path: '/tmp/c.html', preview: '<div>x</div>' },
  )
  assert.equal(fileInfoOfArgs(JSON.stringify({ command: 'ls' })), undefined)
  assert.equal(fileInfoOfArgs('not json'), undefined)

  // 行匹配评分：精确匹配优先于包含
  const rowExact = window.document.createElement('div')
  rowExact.setAttribute('role', 'treeitem')
  rowExact.textContent = '登录页'
  const rowLong = window.document.createElement('div')
  rowLong.setAttribute('role', 'treeitem')
  rowLong.textContent = '登录页 v2'
  window.document.body.append(rowExact, rowLong)
  assert.equal(findSessionRow('登录页'), rowExact)
  assert.equal(findSessionRow('登录页 v2'), rowLong)
  dom.window.close()
})
