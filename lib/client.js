// dsh-hover-approve browser half: 会话列表「待处理交互」自动弹出锚定气泡。
//
// 行为：
//   - 订阅会话列表：会话进入「等待授权 / 等待回答 / 计划待确认 / 目标被阻断」
//     时，自动在**左侧会话列表里那一行的右侧**弹出气泡，并带一条引线 + 圆点
//     连到该行——一眼看出是哪个会话在等你处理。
//   - approval：完整展示工具名 / 要执行的命令 / 写入文件 / 授权原因，以及
//     「拒绝」「授权」两个按钮——不用点进会话。
//   - question：单选选项点击即答；多选选项勾选后统一确认。无法在气泡内回答的
//     （多问题批次 / 纯文本问题）给出「去会话查看」按钮，一键打开会话。
//   - plan-review：以「计划待确认」卡片展示计划正文 + 批准/拒绝选项，点击即答。
//   - goal-blocked：展示阻断原因与目标，「去会话查看」一键打开会话。
//   - 行滚动/列表重渲染时气泡跟随行位置；会话离开待处理状态 → 气泡自动消失；
//     多个会话同时待处理 → 各自锚定自己的行、横向错开。
//
// 自包含手写 bundle（不需要打包器）：module system 会把它包成 CJS
// factory，并采纳 { apply, inject } 作为客户端插件。
window.__ModuleLoader__.load({
  id: 'dsh-hover-approve',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ── 文案（跟随应用语言设置）────────────────────────────────────

    const zh = {
      approve: '授权',
      reject: '拒绝',
      approving: '授权中…',
      approvingReject: '拒绝中…',
      answering: '回答中…',
      approved: '已授权 ✓',
      rejected: '已拒绝',
      answered: '已回答 ✓',
      failed: '操作失败',
      needApprove: '需要你授权',
      needChoose: '需要你选择',
      planReview: '需要你确认计划',
      goalBlocked: '目标已阻断',
      goalBlockedNote: '这个对话的目标被阻断了：',
      goalObjective: '目标',
      ask: '这个对话想执行下面的操作：',
      askChoose: '这个对话想请你选择：',
      action: '操作',
      runCommand: '要运行的命令',
      targetFile: '要写入的文件',
      fileContent: '内容预览',
      agentNote: '智能体说明',
      close: '关闭',
      choose: '选择',
      confirm: '确认选择',
      multiHint: '（可多选）',
      freeTextNote: '这个问题需要输入文字，请到会话里回答。',
      batchNote: '这个对话提出了 {count} 个问题，请到会话里逐步回答。',
      openSession: '去会话查看',
    }
    const en = {
      approve: 'Approve',
      reject: 'Reject',
      approving: 'Approving…',
      approvingReject: 'Rejecting…',
      answering: 'Answering…',
      approved: 'Approved ✓',
      rejected: 'Rejected',
      answered: 'Answered ✓',
      failed: 'Action failed',
      needApprove: 'Approval needed',
      needChoose: 'Please choose',
      planReview: 'Plan review',
      goalBlocked: 'Goal blocked',
      goalBlockedNote: 'This conversation goal was blocked:',
      goalObjective: 'Goal',
      ask: 'This conversation wants to do the following:',
      askChoose: 'This conversation wants you to choose:',
      action: 'Action',
      runCommand: 'Command to run',
      targetFile: 'File to write',
      fileContent: 'Content preview',
      agentNote: 'Agent note',
      close: 'Close',
      choose: 'Choose',
      confirm: 'Confirm selection',
      multiHint: '(multi-select)',
      freeTextNote: 'This question needs a written answer — open the conversation to reply.',
      batchNote: 'This conversation asked {count} questions — open it to answer them one by one.',
      openSession: 'Open conversation',
    }

    /** 工具名 → 大白话（非技术用户也能看懂）；未知工具返回原文。 */
    const TOOL_LABELS_ZH = {
      bash: '运行终端命令',
      'bash-local': '运行终端命令',
      write: '写入文件',
      edit: '修改文件',
      'str-replace-editor': '修改文件',
      web: '访问网页',
      'web-search': '搜索网页',
      'web-fetch': '读取网页内容',
      'find-dsh-plugin': '查找插件',
      'memory-evolve': '读写记忆',
    }
    function toolLabel(toolName, lang) {
      if (!toolName) return '?'
      if (lang === 'zh') return TOOL_LABELS_ZH[toolName] || toolName
      return toolName
    }

    // ── 帮助函数 ────────────────────────────────────────────────────

    /** 当前界面语言（html lang → navigator → locale 快照的 active 字段）。 */
    function resolveLang(ctx) {
      try {
        const htmlLang = document.documentElement?.lang
        if (htmlLang && htmlLang.startsWith('zh')) return 'zh'
        if (htmlLang && /^en/i.test(htmlLang)) return 'en'
      } catch { /* ignore */ }
      try {
        const nav = navigator.language || navigator.userLanguage || ''
        if (nav.startsWith('zh')) return 'zh'
        if (/^en/i.test(nav)) return 'en'
      } catch { /* ignore */ }
      try {
        const snap = ctx.locale?.getSnapshot?.()
        if (snap && typeof snap === 'object' && snap.active) {
          return String(snap.active).startsWith('zh') ? 'zh' : 'en'
        }
      } catch { /* ignore */ }
      return 'zh'
    }

    /** 从 argsRaw 解析 bash 类工具的命令；解析失败返回 undefined。 */
    function commandOfArgs(argsRaw) {
      if (typeof argsRaw !== 'string' || argsRaw.length === 0) return undefined
      try {
        const args = JSON.parse(argsRaw)
        return typeof args.command === 'string' ? args.command : undefined
      } catch {
        return undefined
      }
    }

    /**
     * 从 argsRaw 解析文件类工具（write/edit/str-replace-editor）的目标文件路径
     * 和内容预览。write 用 file_path + content；edit/str-replace-editor 用
     * file_path / path，预览取 new_string / file_text / old_string。
     * 解析失败返回 undefined。
     * @returns {{ path: string, preview?: string } | undefined}
     */
    function fileInfoOfArgs(argsRaw) {
      if (typeof argsRaw !== 'string' || argsRaw.length === 0) return undefined
      let args
      try {
        args = JSON.parse(argsRaw)
      } catch {
        return undefined
      }
      const path = typeof args.file_path === 'string' && args.file_path.trim() !== ''
        ? args.file_path
        : (typeof args.path === 'string' && args.path.trim() !== '' ? args.path : undefined)
      if (!path) return undefined
      const content = [args.new_string, args.file_text, args.content, args.old_string]
        .find((value) => typeof value === 'string' && value.length > 0)
      let preview
      if (content) {
        const flat = content.replace(/\s+/g, ' ').trim()
        if (flat) preview = flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
      }
      return preview ? { path, preview } : { path }
    }

    /**
     * 在左侧会话列表里找标题匹配的行元素（每次实时查询，行重渲染也可靠）。
     * 按「全文精确 → 前缀 → 包含」评分，避免短标题误锚到含相同子串的其他行。
     */
    function findSessionRow(title) {
      if (!title) return null
      const needle = String(title).replace(/\s+/g, ' ').trim()
      if (!needle) return null
      let best = null
      let bestScore = -1
      for (const row of document.querySelectorAll('[role="treeitem"]')) {
        const text = (row.textContent || '').replace(/\s+/g, ' ').trim()
        if (!text) continue
        let score = -1
        if (text === needle) score = 3
        else if (text.startsWith(needle)) score = 2
        else if (text.includes(needle)) score = 1
        if (score > bestScore) {
          best = row
          bestScore = score
        }
      }
      return best
    }

    /**
     * 构建锚定气泡（fixed 定位，会随行位置重定位）。
     * @param {object} opts
     * @param {string} opts.title 会话标题
     * @param {object} opts.info { kind, toolName?, command?, reason?, ... }
     * @param {(key: string, params?: object) => string} opts.t 文案
     * @param {(action: object) => void} opts.onAction
     * @param {() => void} opts.onClose
     * @param {() => void} opts.onOpen 去会话查看
     * @returns {{root: Element, bubble: Element, tail: Element, dot: Element}}
     */
    function buildAnchoredBubble(opts) {
      const { title, info, t, lang = 'zh', onAction, onClose, onOpen } = opts

      // root：气泡本体（fixed）
      const bubble = document.createElement('div')
      bubble.setAttribute('data-hover-approve-bubble', '')
      bubble.style.cssText = [
        'position:fixed',
        'width:min(440px, calc(100vw - 24px))',
        'min-width:min(320px, calc(100vw - 24px))',
        'box-sizing:border-box',
        'background:var(--dsw-specific-input-major, #1e1f24)',
        'border:1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(255,255,255,.12))',
        'border-radius:14px',
        'box-shadow:0 8px 32px rgba(0,0,0,.45)',
        'color:var(--dsw-alias-label-primary, #eee)',
        'padding:12px 14px',
        'z-index:2147483000',
        'font-size:13px',
        'line-height:20px',
        'animation:ha-slide-in .18s ease-out',
        'pointer-events:auto',
        'display:none', // 锚定到位后再显示，避免闪跳
      ].join(';')

      // 引线（从气泡左缘伸向行的短横线）
      const tail = document.createElement('div')
      tail.setAttribute('data-hover-approve-tail', '')
      tail.style.cssText = [
        'position:fixed',
        'height:1px',
        'background:var(--dsw-alias-state-warn-primary, #f5a623)',
        'z-index:2147482999',
        'pointer-events:none',
        'display:none',
      ].join(';')

      // 行端的圆点（引线终点，落在行右边缘上）
      const dot = document.createElement('div')
      dot.setAttribute('data-hover-approve-dot', '')
      dot.style.cssText = [
        'position:fixed',
        'width:7px',
        'height:7px',
        'border-radius:50%',
        'background:var(--dsw-alias-state-warn-primary, #f5a623)',
        'box-shadow:0 0 4px rgba(245,166,35,.8)',
        'z-index:2147482999',
        'pointer-events:none',
        'display:none',
      ].join(';')

      // 头部：需要你授权 + 会话名 + 关闭按钮
      const header = document.createElement('div')
      header.style.cssText = ['display:flex', 'align-items:center', 'gap:8px', 'margin-bottom:6px'].join(';')

      const dotIcon = document.createElement('span')
      dotIcon.style.cssText = [
        'width:8px', 'height:8px', 'border-radius:50%', 'flex:none',
        'background:var(--dsw-alias-state-warn-primary, #f5a623)',
      ].join(';')
      header.appendChild(dotIcon)

      const headText = document.createElement('span')
      headText.style.cssText = [
        'font-weight:800', 'font-size:16px',
        info.kind === 'goal-blocked'
          ? 'color:var(--dsw-alias-state-error-primary, #e5534b)'
          : 'color:var(--dsw-alias-state-warn-primary, #f5a623)',
        'flex:1', 'min-width:0',
      ].join(';')
      headText.textContent = info.kind === 'question' ? t('needChoose')
        : info.kind === 'plan-review' ? t('planReview')
        : info.kind === 'goal-blocked' ? t('goalBlocked')
        : t('needApprove')
      header.appendChild(headText)

      const sessionLabel = document.createElement('span')
      sessionLabel.style.cssText = [
        'font-size:12px', 'color:var(--dsw-alias-label-tertiary, #999)',
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
        'max-width:130px',
      ].join(';')
      sessionLabel.textContent = title
      sessionLabel.title = title
      header.appendChild(sessionLabel)

      const closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.setAttribute('aria-label', t('close'))
      closeBtn.textContent = '×'
      closeBtn.style.cssText = [
        'flex:none', 'width:20px', 'height:20px', 'border:none', 'border-radius:50%',
        'background:transparent', 'color:var(--dsw-alias-label-tertiary, #999)',
        'font-size:15px', 'line-height:1', 'cursor:pointer',
        'display:inline-flex', 'align-items:center', 'justify-content:center',
      ].join(';')
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      })
      header.appendChild(closeBtn)
      bubble.appendChild(header)

      // 权限内容卡
      const body = document.createElement('div')
      body.style.cssText = [
        'display:flex', 'flex-direction:column', 'gap:6px',
        'padding:10px 12px',
        'border:1px solid var(--dsw-alias-state-warn-secondary, rgba(245,166,35,.45))',
        'border-radius:10px',
        'background:var(--dsw-alias-state-warn-tertiary, rgba(245,166,35,.08))',
      ].join(';')

      const rowCss = (extra) => ['font-size:13px', 'line-height:20px', ...extra].join(';')

      /** 「去会话查看」按钮：无法在气泡里完成的交互，一键打开会话。 */
      const appendOpenButton = () => {
        const openBtn = document.createElement('button')
        openBtn.type = 'button'
        openBtn.dataset.haOpen = ''
        openBtn.textContent = t('openSession')
        openBtn.style.cssText = [
          'display:inline-flex', 'align-items:center', 'justify-content:center',
          'margin-top:6px', 'padding:6px 16px', 'border-radius:999px',
          'font:inherit', 'font-size:13px', 'line-height:20px', 'cursor:pointer',
          'border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2))',
          'background:transparent', 'color:var(--dsw-alias-label-primary, #eee)',
        ].join(';')
        openBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpen?.()
        })
        body.appendChild(openBtn)
      }

      if (info.kind === 'goal-blocked') {
        // ── goal-blocked 模式：目标被阻断通知 + 一键打开会话 ──
        const noteLine = document.createElement('div')
        noteLine.style.cssText = rowCss([
          'color:var(--dsw-alias-label-secondary, #aaa)',
          'font-size:12px',
        ])
        noteLine.textContent = t('goalBlockedNote')
        body.appendChild(noteLine)

        // 阻断原因（重点大字，红色系）
        const reasonText = document.createElement('div')
        reasonText.style.cssText = rowCss([
          'font-size:14px', 'font-weight:700',
          'color:var(--dsw-alias-state-error-primary, #e5534b)',
          'word-break:break-all', 'white-space:pre-wrap',
        ])
        reasonText.textContent = info.blockReason || '?'
        body.appendChild(reasonText)

        // 目标内容（次要小字）
        if (info.objective) {
          const objRow = document.createElement('div')
          objRow.style.cssText = rowCss([
            'color:var(--dsw-alias-label-tertiary, #888)',
            'font-size:12px',
            'word-break:break-all', 'white-space:pre-wrap',
          ])
          objRow.textContent = `${t('goalObjective')}：${info.objective}`
          body.appendChild(objRow)
        }

        appendOpenButton()
      } else if (info.kind === 'question' || info.kind === 'plan-review') {
        // ── question / plan-review 模式：问题 + 选项列表 ──
        const isPlan = info.kind === 'plan-review'

        if (!isPlan) {
          const askLine = document.createElement('div')
          askLine.style.cssText = rowCss([
            'color:var(--dsw-alias-label-secondary, #aaa)',
            'font-size:12px',
          ])
          askLine.textContent = t('askChoose')
          body.appendChild(askLine)
        }

        // 问题文本（重点大字）
        const questionText = document.createElement('div')
        questionText.style.cssText = rowCss([
          'font-size:14px', 'font-weight:700',
          'color:var(--dsw-alias-label-primary, #eee)',
          'word-break:break-all', 'white-space:pre-wrap',
        ])
        questionText.textContent = info.question || '?'
        body.appendChild(questionText)

        if (isPlan && info.detail) {
          // 计划正文（可滚动查看）
          const planBox = document.createElement('div')
          planBox.style.cssText = rowCss([
            'color:var(--dsw-alias-label-secondary, #ccc)',
            'font-size:12px',
            'background:rgba(0,0,0,.25)',
            'border-radius:8px',
            'padding:8px 10px',
            'max-height:160px',
            'overflow-y:auto',
            'white-space:pre-wrap',
            'word-break:break-all',
          ])
          planBox.textContent = info.detail
          body.appendChild(planBox)
        } else if (!isPlan && info.detail) {
          const detailRow = document.createElement('div')
          detailRow.style.cssText = rowCss([
            'color:var(--dsw-alias-label-tertiary, #888)',
            'font-size:12px',
            'word-break:break-all', 'white-space:pre-wrap',
          ])
          detailRow.textContent = info.detail
          body.appendChild(detailRow)
        }

        // 选项列表：单选点击即答；多选勾选后统一确认
        if (info.answerable !== false && info.options && info.options.length > 0) {
          const multi = info.multiSelect === true
          const selected = new Set()
          let confirmBtn = null
          const optList = document.createElement('div')
          optList.style.cssText = [
            'display:flex', 'flex-direction:column', 'gap:6px',
            'margin-top:4px',
          ].join(';')
          info.options.forEach((opt, i) => {
            const optBtn = document.createElement('button')
            optBtn.type = 'button'
            optBtn.dataset.haOption = String(i)
            const label = opt.label || String(i + 1)
            const recommended = (info.kind === 'plan-review' && label === info.approveLabel)
              || /推荐|recommended|⭐/i.test(label + (opt.description || ''))
            optBtn.style.cssText = [
              'display:flex', 'flex-direction:column', 'align-items:flex-start', 'gap:2px',
              'text-align:left', 'width:100%',
              'padding:8px 10px',
              'border-radius:8px',
              'border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18))',
              'background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.05))',
              'color:var(--dsw-alias-label-primary, #eee)',
              'font:inherit', 'font-size:13px', 'line-height:18px',
              'cursor:pointer',
            ].join(';')
            const setSelectedStyle = (on) => {
              optBtn.style.borderColor = on || recommended
                ? 'var(--dsw-alias-state-warn-primary, #f5a623)'
                : 'var(--dsw-alias-border-l2, rgba(255,255,255,.18))'
              optBtn.style.background = on
                ? 'rgba(245,166,35,.14)'
                : 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.05))'
            }
            setSelectedStyle(false)
            const labelSpan = document.createElement('span')
            labelSpan.textContent = `${i + 1}. ${label}${recommended && !label.includes('⭐') ? ' ⭐' : ''}`
            if (recommended) labelSpan.style.fontWeight = '600'
            optBtn.appendChild(labelSpan)
            if (opt.description) {
              const desc = document.createElement('span')
              desc.style.cssText = [
                'font-size:12px', 'color:var(--dsw-alias-label-tertiary, #999)',
                'white-space:pre-wrap', 'word-break:break-all',
              ].join(';')
              desc.textContent = opt.description
              optBtn.appendChild(desc)
            }
            optBtn.addEventListener('click', (e) => {
              e.preventDefault()
              e.stopPropagation()
              if (multi) {
                if (selected.has(label)) selected.delete(label)
                else selected.add(label)
                setSelectedStyle(selected.has(label))
                if (confirmBtn) confirmBtn.disabled = selected.size === 0
                return
              }
              onAction({ kind: 'question', answers: [{ id: info.questionId, selected: [label] }] })
            })
            optList.appendChild(optBtn)
          })
          body.appendChild(optList)

          if (multi) {
            const hint = document.createElement('div')
            hint.style.cssText = rowCss([
              'color:var(--dsw-alias-label-tertiary, #999)',
              'font-size:12px',
            ])
            hint.textContent = t('multiHint')
            body.appendChild(hint)
            confirmBtn = document.createElement('button')
            confirmBtn.type = 'button'
            confirmBtn.dataset.haConfirm = ''
            confirmBtn.textContent = t('confirm')
            confirmBtn.disabled = true
            confirmBtn.style.cssText = [
              'display:inline-flex', 'align-items:center', 'justify-content:center',
              'margin-top:2px', 'padding:6px 16px', 'border-radius:999px',
              'font:inherit', 'font-size:13px', 'line-height:20px',
              'cursor:pointer', 'border:1px solid transparent',
              'background:var(--dsw-alias-button-info-fill, #1f6feb)', 'color:#fff',
            ].join(';')
            confirmBtn.addEventListener('click', (e) => {
              e.preventDefault()
              e.stopPropagation()
              if (selected.size === 0) return
              onAction({ kind: 'question', answers: [{ id: info.questionId, selected: [...selected] }] })
            })
            body.appendChild(confirmBtn)
          }
        } else {
          // 无法在气泡内回答：说明原因 + 去会话查看
          const note = document.createElement('div')
          note.style.cssText = rowCss([
            'color:var(--dsw-alias-label-tertiary, #999)',
            'font-size:12px',
            'word-break:break-all', 'white-space:pre-wrap',
          ])
          note.textContent = (info.questionCount ?? 0) > 1
            ? t('batchNote', { count: info.questionCount })
            : t('freeTextNote')
          body.appendChild(note)
          appendOpenButton()
        }
      } else {
        // ── approval 模式：操作 → 说明（重点） → 文件/命令 ──
        // 引导语（次要）
        const askLine = document.createElement('div')
        askLine.style.cssText = rowCss([
          'color:var(--dsw-alias-label-secondary, #aaa)',
          'font-size:12px',
        ])
        askLine.textContent = t('ask')
        body.appendChild(askLine)

        // 操作类型（大白话，值突出）
        const actionRow = document.createElement('div')
        actionRow.style.cssText = rowCss(['display:flex', 'align-items:baseline', 'gap:6px'])
        const actionLabel = document.createElement('span')
        actionLabel.style.cssText = ['font-size:12px', 'color:var(--dsw-alias-label-tertiary, #888)'].join(';')
        actionLabel.textContent = t('action') + '：'
        const actionValue = document.createElement('span')
        actionValue.style.cssText = [
          'font-size:14px', 'font-weight:700',
          'color:var(--dsw-alias-label-primary, #eee)',
        ].join(';')
        actionValue.textContent = toolLabel(info.toolName, lang)
        actionRow.appendChild(actionLabel)
        actionRow.appendChild(actionValue)
        body.appendChild(actionRow)

        // 智能体说明（重点提升：13px 亮色、完整显示、位置提前）
        if (info.reason) {
          const reasonRow = document.createElement('div')
          reasonRow.style.cssText = rowCss([
            'color:var(--dsw-alias-label-primary, #ddd)',
            'font-size:13px',
            'margin-top:2px',
            'word-break:break-all', 'white-space:pre-wrap',
          ])
          const reasonLabel = document.createElement('span')
          reasonLabel.style.cssText = [
            'font-weight:700',
            'color:var(--dsw-alias-label-secondary, #aaa)',
          ].join(';')
          reasonLabel.textContent = t('agentNote') + '：'
          reasonRow.appendChild(reasonLabel)
          reasonRow.appendChild(document.createTextNode(info.reason))
          body.appendChild(reasonRow)
        }

        // 要写入的文件（重点高亮块：等宽 + 黄色左边框 + 加粗）
        if (info.filePath) {
          const fileLabel = document.createElement('div')
          fileLabel.style.cssText = rowCss([
            'color:var(--dsw-alias-label-tertiary, #888)',
            'font-size:12px',
            'margin-top:2px',
          ])
          fileLabel.textContent = t('targetFile') + '：'
          body.appendChild(fileLabel)

          const fileBox = document.createElement('div')
          fileBox.style.cssText = [
            'font-family:var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace)',
            'font-size:13px', 'font-weight:700',
            'line-height:22px',
            'background:rgba(0,0,0,.35)',
            'border-left:3px solid var(--dsw-alias-state-warn-primary, #f5a623)',
            'border-radius:6px', 'padding:6px 10px',
            'color:var(--dsw-alias-label-primary, #fff)',
            'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
            'direction:ltr', 'text-align:left',
            'cursor:pointer',
          ].join(';')
          fileBox.textContent = info.filePath
          fileBox.title = info.filePath
          fileBox.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            const expanded = fileBox.dataset.haExpanded === '1'
            if (expanded) {
              fileBox.style.whiteSpace = 'nowrap'
              fileBox.dataset.haExpanded = '0'
            } else {
              fileBox.style.whiteSpace = 'pre-wrap'
              fileBox.style.wordBreak = 'break-all'
              fileBox.dataset.haExpanded = '1'
            }
          })
          body.appendChild(fileBox)

          // 内容预览（若有）
          if (info.contentPreview) {
            const previewRow = document.createElement('div')
            previewRow.style.cssText = rowCss([
              'color:var(--dsw-alias-label-tertiary, #888)',
              'font-size:12px',
              'word-break:break-all', 'white-space:pre-wrap',
            ])
            previewRow.textContent = `${t('fileContent')}：${info.contentPreview}`
            body.appendChild(previewRow)
          }
        }

        // 要运行的命令（单行截断，点击展开）
        if (info.command) {
          const cmdLabel = document.createElement('div')
          cmdLabel.style.cssText = rowCss([
            'color:var(--dsw-alias-label-tertiary, #888)',
            'font-size:12px',
            'margin-top:2px',
          ])
          cmdLabel.textContent = t('runCommand') + '：'
          body.appendChild(cmdLabel)

          const cmdBox = document.createElement('div')
          cmdBox.style.cssText = [
            'font-family:var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace)',
            'font-size:13px',
            'line-height:22px',
            'background:rgba(0,0,0,.35)',
            'border-left:3px solid var(--dsw-alias-state-warn-primary, #f5a623)',
            'border-radius:6px', 'padding:6px 10px',
            'color:var(--dsw-alias-label-primary, #eee)',
            'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
            'direction:ltr', 'text-align:left',
            'cursor:pointer',
          ].join(';')
          cmdBox.textContent = `$ ${info.command}`
          cmdBox.title = t('runCommand')
          cmdBox.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            const expanded = cmdBox.dataset.haExpanded === '1'
            if (expanded) {
              cmdBox.style.whiteSpace = 'nowrap'
              cmdBox.style.maxHeight = ''
              cmdBox.style.overflow = 'hidden'
              cmdBox.dataset.haExpanded = '0'
            } else {
              cmdBox.style.whiteSpace = 'pre-wrap'
              cmdBox.style.maxHeight = '120px'
              cmdBox.style.overflowY = 'auto'
              cmdBox.dataset.haExpanded = '1'
            }
          })
          body.appendChild(cmdBox)
        }
      }

      bubble.appendChild(body)

      // 操作行（approval 模式有拒绝/授权；question/plan-review 在分支内点击即答）
      if (info.kind === 'approval') {
        const actions = document.createElement('div')
        actions.style.cssText = ['display:flex', 'justify-content:flex-end', 'gap:10px', 'margin-top:10px'].join(';')
        actions.setAttribute('data-ha-actions', '')

        const makeBtn = (labelKey, primary, outcome) => {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.dataset.haOutcome = outcome
          btn.textContent = t(labelKey)
          const css = [
            'display:inline-flex', 'align-items:center', 'justify-content:center',
            'padding:5px 18px', 'border-radius:999px',
            'font:inherit', 'font-size:13px', 'line-height:20px',
            'cursor:pointer', 'border:1px solid transparent',
          ]
          if (primary) {
            css.push('background:var(--dsw-alias-button-info-fill, #1f6feb)', 'color:#fff')
          } else {
            css.push('background:transparent', 'color:var(--dsw-alias-label-secondary, #bbb)', 'border-color:var(--dsw-alias-border-l2, rgba(255,255,255,.2))')
          }
          btn.style.cssText = css.join(';')
          btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            onAction({ kind: 'approval', outcome })
          })
          return btn
        }

        const rejectBtn = makeBtn('reject', false, 'rejected')
        const approveBtn = makeBtn('approve', true, 'allowed-once')
        actions.appendChild(rejectBtn)
        actions.appendChild(approveBtn)
        bubble.appendChild(actions)
      }

      // 状态行：授权中 / 已授权 / 失败等反馈（不篡改按钮文字）
      const statusEl = document.createElement('div')
      statusEl.dataset.haStatus = ''
      statusEl.style.cssText = [
        'display:none', 'margin-top:8px', 'font-size:12px', 'text-align:right',
        'color:var(--dsw-alias-label-secondary, #aaa)',
      ].join(';')
      bubble.appendChild(statusEl)

      // 滑入动画样式（一次注入）
      if (!document.getElementById('ha-anim-style')) {
        const style = document.createElement('style')
        style.id = 'ha-anim-style'
        style.textContent = '@keyframes ha-slide-in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}'
        document.head.appendChild(style)
      }

      return { bubble, tail, dot }
    }

    // ── 插件主体 ────────────────────────────────────────────────────
    function apply(ctx) {
      let sessionsStore = null
      try {
        sessionsStore = ctx.sessions?.list ?? null
      } catch {
        sessionsStore = null
      }
      if (!sessionsStore) {
        console.warn('[hover-approve] sessions service unavailable; plugin disabled')
        return
      }

      const lang = resolveLang(ctx)
      const dict = lang === 'zh' ? zh : en
      const t = (key, params) => {
        let text = dict[key] ?? key
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            text = text.replaceAll(`{${k}}`, String(v))
          }
        }
        return text
      }

      // 已手动关闭的会话（本轮不再弹；下一轮新交互重置）
      const dismissed = new Set()
      /** sessionId → { bubble, tail, dot, sessionId, title } */
      const anchors = new Map()

      /** 已归档会话集合（registry 全局归档集）：归档会话不弹任何通知。 */
      let archivedSet = new Set()
      /** sessionId → 行查找失败重试计数 */
      const retries = new Map()
      /** 本轮登记的全部定时器（热卸载时统一清理，避免残留气泡） */
      const timers = new Set()
      const later = (fn, ms) => {
        const id = setTimeout(() => {
          timers.delete(id)
          fn()
        }, ms)
        timers.add(id)
        return id
      }

      /** 弹入动画结束后重置 transform（避免残留影响定位）。 */
      const onAnimEnd = (el) => {
        el.addEventListener('animationend', () => {
          el.style.animation = 'none'
        }, { once: true })
      }

      /** 状态行反馈（授权中 / 已授权 / 失败…）。 */
      const setStatus = (bubble, text) => {
        const el = bubble.querySelector('[data-ha-status]')
        if (!el) return
        el.textContent = text
        el.style.display = text ? '' : 'none'
      }

      /** 禁用/恢复气泡内的操作按钮（× 关闭始终可用）。 */
      const setButtonsDisabled = (bubble, disabled) => {
        const selector = '[data-ha-actions] button, [data-ha-option], [data-ha-confirm], [data-ha-open]'
        for (const btn of bubble.querySelectorAll(selector)) btn.disabled = disabled
      }

      /** 一键打开会话并收起气泡（question 文本题 / 多问题批次 / goal-blocked 用）。 */
      const openSession = (sessionId) => {
        try {
          ctx.sessions.open?.(sessionId)
        } catch (err) {
          console.warn('[hover-approve] open session failed:', err)
        }
        // 用户已去会话查看，本轮交互的气泡一并收起（goal-blocked 是终态，
        // 状态不会自行变化，不主动收的话气泡会一直挂着）
        dismissed.add(sessionId)
        removeBubble(sessionId)
      }

      /**
       * 为一个待处理会话建立锚定气泡。
       * @returns {boolean} 是否成功建立（行不存在时返回 false 等待重试）
       */
      const showBubble = (sessionId, summary) => {
        if (anchors.has(sessionId) || dismissed.has(sessionId)) return true
        if (archivedSet.has(sessionId)) return true // 归档会话：不弹，重试也直接放弃
        const title = summary.displayTitle || summary.title || sessionId
        // 行必须存在才能锚定（可能因分组折叠暂时查不到，稍后重试）
        const row = findSessionRow(title)
        if (!row) return false

        let info = null
        try {
          info = readApprovalInfo(sessionId, summary)
        } catch (err) {
          console.warn('[hover-approve] read approval info failed:', err)
        }
        if (!info) return true // 读不到信息就不弹（状态可能已变）

        const { bubble, tail, dot } = buildAnchoredBubble({
          title,
          info,
          t,
          lang,
          onAction: (action) => {
            if (bubble.dataset.haBusy === '1') return
            bubble.dataset.haBusy = '1'

            // question / plan-review：选项答案由 UI 组装好，直接应答
            if (action && action.kind === 'question') {
              setButtonsDisabled(bubble, true)
              setStatus(bubble, t('answering'))
              respondQuestion(sessionId, action.answers)
                .then(() => {
                  setStatus(bubble, t('answered'))
                  // 列表订阅会随后收起气泡
                })
                .catch((err) => {
                  console.warn('[hover-approve] question respond failed:', err)
                  setStatus(bubble, t('failed'))
                  setButtonsDisabled(bubble, false)
                  bubble.dataset.haBusy = '0'
                })
              return
            }

            // approval：拒绝 / 授权（绑定展示时的 approvalId，防「所见非所批」）
            if (action && action.kind === 'approval') {
              const outcome = action.outcome
              const btnRow = bubble.querySelector('[data-ha-actions]')
              const targetBtn = btnRow ? btnRow.querySelector(`[data-ha-outcome="${outcome}"]`) : null
              const busyLabel = outcome === 'allowed-once' ? t('approving') : t('approvingReject')
              const doneLabel = outcome === 'allowed-once' ? t('approved') : t('rejected')
              setButtonsDisabled(bubble, true)
              setStatus(bubble, busyLabel)
              respondApproval(sessionId, outcome, info.approvalId)
                .then(() => {
                  setStatus(bubble, doneLabel)
                  // 列表订阅会随后收起气泡
                })
                .catch((err) => {
                  console.warn('[hover-approve] respond failed:', err)
                  setStatus(bubble, t('failed'))
                  setButtonsDisabled(bubble, false)
                  if (targetBtn) targetBtn.disabled = false
                  bubble.dataset.haBusy = '0'
                })
              return
            }
          },
          onClose: () => {
            dismissed.add(sessionId)
            removeBubble(sessionId)
          },
          onOpen: () => openSession(sessionId),
        })

        document.body.appendChild(bubble)
        document.body.appendChild(tail)
        document.body.appendChild(dot)
        anchors.set(sessionId, { bubble, tail, dot, sessionId, title })
        retries.delete(sessionId)
        onAnimEnd(bubble)
        anchorAll()
        bubble.style.display = ''
        return true
      }

      /** 移除一个会话的气泡。 */
      const removeBubble = (sessionId) => {
        const a = anchors.get(sessionId)
        if (a) {
          a.bubble.remove()
          a.tail.remove()
          a.dot.remove()
          anchors.delete(sessionId)
        }
      }

      /** 重新定位所有气泡：锚定到各自行右侧 + 引线连接，并夹在视口内。 */
      let anchorRaf = 0
      const anchorAll = () => {
        if (anchorRaf) return
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0
          if (anchors.size === 0) return
          const viewW = window.innerWidth || document.documentElement?.clientWidth || 1200
          const viewH = window.innerHeight || document.documentElement?.clientHeight || 800
          let index = 0
          for (const [, a] of anchors) {
            const row = findSessionRow(a.title)
            if (!row) {
              // 行暂时找不到（折叠/重渲染中）：保留气泡但隐藏，等下次重新锚定
              a.bubble.style.display = 'none'
              a.tail.style.display = 'none'
              a.dot.style.display = 'none'
              continue
            }
            const rect = row.getBoundingClientRect()
            if (rect.width === 0 && rect.height === 0) {
              a.bubble.style.display = 'none'
              a.tail.style.display = 'none'
              a.dot.style.display = 'none'
              continue
            }
            const gap = 10
            const width = a.bubble.offsetWidth || 440
            const height = a.bubble.offsetHeight || 0
            // 优先排在行右侧；放不下时向左收，保证整块气泡留在视口内
            let x = rect.right + gap + index * 26
            x = Math.max(8, Math.min(x, Math.max(8, viewW - width - 8)))
            let top = rect.top - 8 // 气泡顶略高于行
            if (height > 0 && top + height > viewH - 8) {
              top = Math.max(8, viewH - height - 8)
            }
            top = Math.max(8, top)
            a.bubble.style.left = `${x}px`
            a.bubble.style.top = `${top}px`
            a.bubble.style.display = ''

            // 引线：从气泡左缘到行右边缘，纵向对齐行的中心
            const rowMidY = rect.top + rect.height / 2
            const tailStartX = rect.right + 2
            const tailEndX = x - 2
            if (tailEndX > tailStartX) {
              a.tail.style.left = `${tailStartX}px`
              a.tail.style.top = `${Math.round(rowMidY) - 0.5}px`
              a.tail.style.width = `${tailEndX - tailStartX}px`
              a.tail.style.display = ''
            } else {
              a.tail.style.display = 'none'
            }

            // 圆点：落在行右边缘中心
            a.dot.style.left = `${rect.right - 3}px`
            a.dot.style.top = `${Math.round(rowMidY) - 3}px`
            a.dot.style.display = ''

            index += 1
          }
        })
      }

      /**
       * 读取一次待处理交互的完整信息（approval 或 question）。
       * binding() 对列表中的会话会懒实例化，pending 帧会回放。
       */
      function readApprovalInfo(sessionId, summary) {
        // goal-blocked：目标被阻断（来自列表快照的会话投影）
        const goalProj = summary?.projectionValues?.goal
        if (goalProj && goalProj.goal && goalProj.goal.phase === 'blocked') {
          return {
            kind: 'goal-blocked',
            blockReason: goalProj.goal.blockedReason?.message || '?',
            objective: goalProj.goal.objective,
            approvalId: undefined,
          }
        }

        if (typeof ctx.sessions.binding !== 'function') return null
        const binding = ctx.sessions.binding(sessionId)
        if (!binding) return null
        const snapshot = binding.session?.getSnapshot?.()
        if (!snapshot) return null
        const pending = Array.isArray(snapshot.pending) ? snapshot.pending : []

        // question / plan-review：等待用户回答
        const question = pending.find((p) => p && p.kind === 'question')
        if (question) {
          const qs = question.payload?.questions || []
          const first = qs[0]
          if (!first) return null
          const intent = first.intent
          const options = Array.isArray(first.options) ? first.options : []
          // 与内置 PlanReviewPanel 相同的收窄规则：单问题 + plan-review intent
          // + 有 detail + 单选 + ≤2 个选项且含 approve 标签
          const isPlanReview = qs.length === 1
            && intent?.kind === 'plan-review'
            && typeof first.detail === 'string'
            && first.multiSelect !== true
            && options.length <= 2
            && options.some((opt) => opt && opt.label === intent.approve)
          if (isPlanReview) {
            return {
              kind: 'plan-review',
              question: first.question || first.header || '?',
              detail: first.detail,
              options,
              multiSelect: false,
              questionId: first.id,
              answerable: true,
              approveLabel: intent.approve,
            }
          }
          if (qs.length === 1) {
            return {
              kind: 'question',
              question: first.question || first.header || '?',
              detail: first.detail,
              options,
              multiSelect: first.multiSelect === true,
              questionId: first.id,
              answerable: options.length > 0,
            }
          }
          // 多问题批次：气泡只提示 + 一键打开会话（不伪造答案）
          return {
            kind: 'question',
            question: first.question || first.header || '?',
            options: [],
            multiSelect: false,
            questionCount: qs.length,
            answerable: false,
          }
        }

        // approval：等待授权
        const approval = pending.find((p) => p && p.kind === 'approval')
        if (!approval) return null
        const payload = approval.payload || {}
        let command
        let filePath
        let contentPreview
        if (payload.callId) {
          const runningCalls = Array.isArray(snapshot.runningCalls) ? snapshot.runningCalls : []
          const call = runningCalls.find((c) => c && c.callId === payload.callId)
          if (call) {
            command = commandOfArgs(call.argsRaw)
            const fileInfo = fileInfoOfArgs(call.argsRaw)
            if (fileInfo) {
              filePath = fileInfo.path
              contentPreview = fileInfo.preview
            }
          }
        }
        return {
          kind: 'approval',
          toolName: payload.toolName || '?',
          reason: payload.reason,
          command,
          filePath,
          contentPreview,
          approvalId: payload.approvalId,
        }
      }

      /** 响应授权请求。 */
      /**
       * 响应授权请求。approvalId 必须是气泡展示时捕获的那个——
       * 若该审批已被处理、同一会话来了新的审批，这里会抛错而不误批新请求。
       * @param {string} sessionId
       * @param {'allowed-once' | 'rejected'} outcome
       * @param {string | undefined} approvalId 展示时捕获的审批 id
       */
      async function respondApproval(sessionId, outcome, approvalId) {
        if (!approvalId) throw new Error(`no approvalId bound for session ${sessionId}`)
        const binding = ctx.sessions.binding(sessionId)
        if (!binding) throw new Error(`no session binding for ${sessionId}`)
        const session = binding.session
        const pending = session.getSnapshot().pending || []
        // 精确匹配展示时的那个审批，找不到（已被替换/处理）即拒绝发送
        const approval = pending.find((p) => p && p.kind === 'approval' && p.payload.approvalId === approvalId)
        if (!approval) throw new Error(`pending approval ${approvalId} is gone or replaced in session ${sessionId}`)
        const receipt = await approval.respond({
          ok: true,
          value: {
            sessionId,
            approvalId: approval.payload.approvalId,
            outcome,
          },
        })
        if (!receipt.accepted) throw new Error(`approval response rejected: ${receipt.reason}`)
        return true
      }

      /**
       * 响应提问 / 计划确认（question）：answers 由气泡 UI 按问题 id 组装，
       * 与内置 QuestionFlow 的编码完全一致（selected 为选项 label 数组）。
       */
      async function respondQuestion(sessionId, answers) {
        if (!Array.isArray(answers) || answers.length === 0) {
          throw new Error('no question answers to send')
        }
        const binding = ctx.sessions.binding(sessionId)
        if (!binding) throw new Error(`no session binding for ${sessionId}`)
        const session = binding.session
        const pending = session.getSnapshot().pending || []
        const question = pending.find((p) => p && p.kind === 'question')
        if (!question) throw new Error(`no pending question in session ${sessionId}`)
        const receipt = await question.respond({
          ok: true,
          value: {
            sessionId,
            answer: { answers },
          },
        })
        if (!receipt.accepted) throw new Error(`question response rejected: ${receipt.reason}`)
        return true
      }

      /** 处理列表快照：新增/变更交互 → 弹气泡；离开 → 收气泡。 */
      let lastSeen = new Map()
      /** 派生一个会话的交互类型：approval / plan-review / question / goal-blocked / none。 */
      const interactionOf = (s) => {
        if (!s) return 'none'
        if (s.pendingInteraction === 'approval') return 'approval'
        if (s.pendingInteraction === 'question') return 'question'
        if (s.pendingInteraction === 'plan-review') return 'plan-review'
        const goalProj = s.projectionValues?.goal
        if (goalProj && goalProj.goal && goalProj.goal.phase === 'blocked') return 'goal-blocked'
        return 'none'
      }
      /** 行找不到时重试几次（等列表渲染 / 分组展开）。 */
      const scheduleRetry = (id, status) => {
        const n = retries.get(id) ?? 0
        if (n >= 6) return
        retries.set(id, n + 1)
        later(() => {
          const snap3 = sessionsStore.getSnapshot()
          const s3 = snap3?.byId?.[id]
          if (s3 && interactionOf(s3) === status) {
            const ok = showBubble(id, s3)
            if (!ok) scheduleRetry(id, status)
          }
        }, 600)
      }
      const reconcile = () => {
        // 归档集合（registry 全局）：归档会话不弹通知；
        // workspaces.list 变化也会触发本函数（见下方订阅），归档/取消归档即时生效
        archivedSet = new Set(ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds ?? [])
        const snap = sessionsStore.getSnapshot()
        if (!snap || !Array.isArray(snap.ids) || !snap.byId) return
        const now = new Map()
        for (const id of snap.ids) {
          const s = snap.byId[id]
          if (!s) continue
          if (archivedSet.has(id)) continue // 归档会话：跳过（已归档的旧对话不再弹任何通知）
          now.set(id, interactionOf(s))
        }
        for (const [id, status] of now) {
          const prev = lastSeen.get(id) ?? 'none'
          const interactive = status !== 'none'
          if (interactive && prev !== status) {
            // 新一轮交互（none→x），或同一会话的交互类型变了（x→y）：
            // 都允许重新弹出，并用新内容重建气泡
            dismissed.delete(id)
            removeBubble(id)
            retries.delete(id)
            later(() => {
              const snap2 = sessionsStore.getSnapshot()
              const summary = snap2?.byId?.[id]
              if (!summary || interactionOf(summary) !== status) return
              const ok = showBubble(id, summary)
              if (!ok) scheduleRetry(id, status)
            }, prev === 'none' ? 350 : 0)
          } else if (!interactive && prev !== 'none') {
            removeBubble(id)
            retries.delete(id)
          }
        }
        for (const id of lastSeen.keys()) {
          if (!now.has(id)) {
            removeBubble(id)
            retries.delete(id)
          }
        }
        lastSeen = now
        // 状态变化后行位置可能变化，重新锚定
        anchorAll()
      }

      // 初始快照也检查（插件加载时可能已有待处理会话）
      reconcile()
      const unsubscribe = sessionsStore.subscribe?.(reconcile) ?? (() => {})
      // 归档集合变化（host/archived-sessions-changed）也影响气泡：走同一 reconcile
      const unsubscribeWorkspaces = ctx.workspaces?.list?.subscribe?.(reconcile) ?? (() => {})

      // 点击气泡外部区域：关闭所有气泡（等同于 ×，本轮不再弹）
      const onDocPointerDown = (e) => {
        if (anchors.size === 0) return
        const target = e.target instanceof Element ? e.target : null
        if (!target) return
        // 点在气泡内部（含其按钮/选项）不关闭
        if (target.closest('[data-hover-approve-bubble]')) return
        for (const [sessionId] of [...anchors]) {
          dismissed.add(sessionId)
          removeBubble(sessionId)
        }
      }
      document.addEventListener('pointerdown', onDocPointerDown, true)

      // 跟随滚动/尺寸变化/列表重渲染：重新锚定
      const onMove = () => anchorAll()
      window.addEventListener('scroll', onMove, true)
      window.addEventListener('resize', onMove)
      const observer = new MutationObserver(onMove)
      observer.observe(document.body, { childList: true, subtree: true })

      // 卸载清理：可逆效应，热重载不留残留。
      return () => {
        unsubscribe()
        unsubscribeWorkspaces()
        for (const id of timers) clearTimeout(id)
        timers.clear()
        if (anchorRaf) cancelAnimationFrame(anchorRaf)
        anchorRaf = 0
        document.removeEventListener('pointerdown', onDocPointerDown, true)
        window.removeEventListener('scroll', onMove, true)
        window.removeEventListener('resize', onMove)
        observer.disconnect()
        for (const el of document.querySelectorAll('[data-hover-approve-bubble], [data-hover-approve-tail], [data-hover-approve-dot]')) el.remove()
        document.getElementById('ha-anim-style')?.remove()
        anchors.clear()
        retries.clear()
        lastSeen = new Map()
      }
    }

    exports.apply = apply
    exports.inject = ['sessions', 'locale', 'workspaces']
    exports._internal = { commandOfArgs, fileInfoOfArgs, buildAnchoredBubble, findSessionRow, resolveLang }
    return module.exports
  },
})
