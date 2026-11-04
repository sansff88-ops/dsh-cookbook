// Recipe Box — browser half.
//
// Registers a sidebar entry + full central panel in the Web GUI and renders the
// recipe browser: search, category filter, daily pick, detail pages, pantry
// lookup ("what can I cook with these"), favorites, cooked marks and kitchen
// tips. All data comes from the host half's /recipe-box/ route.

window.__ModuleLoader__.load({
  id: 'dsh-cookbook',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_KEY = 'recipe-box'
    const DATA_URL = '/recipe-box/data.json'
    const STORE_FAV = 'dsh.recipe-box.favorites.v1'
    const STORE_COOKED = 'dsh.recipe-box.cooked.v1'

    const CATEGORY_EMOJI = {
      素菜: '🥬',
      荤菜: '🥩',
      水产: '🐟',
      主食: '🍜',
      汤与粥: '🍲',
      早餐: '🥣',
      甜品: '🍮',
      饮料: '🥤',
      半成品加工: '🥟',
      '酱料和其它材料': '🫙',
    }

    const TABS = [
      ['all', '全部菜谱'],
      ['favorites', '收藏'],
      ['cooked', '做过'],
      ['pantry', '按食材找'],
      ['tips', '厨房技巧'],
    ]

    // ------------------------------------------------------------------ helpers
    function readList(key) {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
      } catch {
        return []
      }
    }

    function writeList(key, list) {
      try {
        localStorage.setItem(key, JSON.stringify(list))
      } catch {
        /* storage disabled: keep the in-memory state */
      }
    }

    function normalized(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[\s_\-·、，,。.（）()：:]/g, '')
    }

    // Chinese ingredient synonyms. Without this a pantry of 西红柿 never satisfies
    // a recipe that asks for 番茄, which hides the most obvious match.
    const SYNONYM_GROUPS = [
      ['番茄', '西红柿'],
      ['土豆', '马铃薯', '洋芋'],
      ['香菜', '芫荽'],
      ['圆白菜', '卷心菜', '包菜', '甘蓝'],
      ['西兰花', '绿花菜', '青花菜'],
      ['红薯', '地瓜', '番薯'],
      ['山药', '淮山'],
      ['青椒', '柿子椒', '甜椒'],
      ['豆角', '四季豆', '芸豆'],
      ['小葱', '香葱'],
      ['生姜', '姜'],
      ['大蒜', '蒜'],
      ['食用油', '植物油', '花生油', '色拉油', '玉米油'],
      ['淀粉', '生粉', '玉米淀粉', '土豆淀粉'],
      ['酱油', '生抽', '老抽'],
      ['醋', '香醋', '陈醋', '米醋'],
      ['白糖', '砂糖', '绵白糖'],
      ['猪肉', '五花肉', '里脊肉', '猪里脊'],
      ['鸡肉', '鸡胸肉', '鸡腿肉'],
      ['牛肉', '牛腩', '牛里脊'],
    ]
    const SYNONYM = new Map()
    for (const group of SYNONYM_GROUPS) {
      for (const word of group) SYNONYM.set(word, group[0])
    }

    function canonical(value) {
      const name = normalized(value)
      return SYNONYM.get(name) || name
    }

    // Two tiers ship with the bundle: 640px for cards, 1200px for the detail
    // page. The proxy picks the directory; a missing HD file falls back to 640.
    // The dataset stores already percent-encoded paths (%E6%8B%94...), so the
    // path has to be decoded before it is encoded for the request; encoding it
    // twice turns %E6 into %25E6 and every picture misses its bundled file.
    function imagePath(raw) {
      const markers = ['/HowToCook@master/', '/HowToCook/master/']
      let path = raw
      for (const marker of markers) {
        const index = raw.indexOf(marker)
        if (index >= 0) { path = raw.slice(index + marker.length); break }
      }
      try {
        return decodeURIComponent(path.replace(/^\/+/, ''))
      } catch {
        return path.replace(/^\/+/, '')
      }
    }

    function imgUrl(raw, size) {
      if (!raw) return ''
      const suffix = size === 'hd' ? '?size=hd' : ''
      if (/^https?:/i.test(raw) && raw.indexOf('/HowToCook@master/') < 0 && raw.indexOf('/HowToCook/master/') < 0) return raw
      return `/recipe-box/img/${encodeURIComponent(imagePath(raw))}${suffix}`
    }

    // Pantry starters: what a fridge usually has, not what a spice rack has.
    // Names match the dataset vocabulary so each chip returns real dishes.
    const PANTRY_STAPLES = [
      { label: '常见肉类', items: ['五花肉', '猪肉', '排骨', '牛肉', '鸡腿肉', '鸡胸肉'] },
      { label: '常见蔬菜', items: ['西红柿', '土豆', '青椒', '洋葱', '胡萝卜', '茄子', '黄瓜', '白菜', '香菇', '菠菜'] },
      { label: '鸡蛋', items: ['鸡蛋'] },
    ]

    function stars(count) {
      const n = Math.max(0, Math.min(5, Number(count) || 0))
      return n ? '★'.repeat(n) : ''
    }

    function hashHue(text) {
      let hash = 0
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360
      return hash
    }

    function tokenize(query) {
      return String(query || '')
        .split(/[\s,，、]+/)
        .map((token) => normalized(token))
        .filter(Boolean)
    }

    function matchesQuery(recipe, tokens) {
      if (!tokens.length) return true
      const haystack = [
        normalized(recipe.name),
        normalized(recipe.category),
        normalized(recipe.intro),
        ...(recipe.ingredients || []).map((item) => normalized(item.name)),
      ]
      return tokens.every((token) => haystack.some((field) => field.includes(token)))
    }

    // Exact names count 1, substring matches 0.5 — "番茄" must not alone make
    // a dish look makeable just because it also sells 番茄酱.
    function matchRatio(recipe, wanted) {
      if (!wanted.length) return 0
      const names = (recipe.ingredients || []).map((item) => canonical(item.name))
      let score = 0
      for (const raw of wanted) {
        const want = canonical(raw)
        if (names.some((name) => name === want)) score += 1
        else if (names.some((name) => name.includes(want) || want.includes(name))) score += 0.5
      }
      return score / wanted.length
    }

    function makeStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch }
          if (!next || next === state) return
          state = next
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    // ----------------------------------------------------------------- tips md
    // The tips files are markdown; the dataset keeps them as raw lines, so the
    // panel turns the few constructs that actually appear (headings, fenced
    // definition lists, bullets, bold, links) into elements instead of dumping
    // "##" and "```" on screen.
    const TIP_INLINE = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`)/g

    function inlineNodes(text, keyPrefix) {
      const nodes = []
      let last = 0
      let match
      TIP_INLINE.lastIndex = 0
      while ((match = TIP_INLINE.exec(text))) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        if (match[2] != null) nodes.push(h('strong', { key: `${keyPrefix}-b${match.index}` }, match[2]))
        else if (match[3] != null) nodes.push(h('span', { key: `${keyPrefix}-a${match.index}`, className: 'dsh-rcp-tip-link' }, match[3]))
        else if (match[5] != null) nodes.push(h('code', { key: `${keyPrefix}-c${match.index}` }, match[5]))
        last = TIP_INLINE.lastIndex
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    const tipTableRow = (line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())

    // The extractor sometimes flattens a whole markdown table onto one line
    // ("| a | b | | :--: | :--: | | 1 | 2 |"). Rebuild rows from the cells.
    function parseCollapsedTable(line) {
      if (!/^\|/.test(line) || !/\|\s*:?-{2,}/.test(line)) return null
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
      const split = cells.findIndex((cell) => /^:?-{2,}:?$/.test(cell))
      if (split < 1) return null
      const header = cells.slice(0, split)
      const rest = cells.slice(split + 1)
      // the separator row contributes one dash cell per column; drop them
      while (rest.length && /^:?-{2,}:?$/.test(rest[0])) rest.shift()
      const rows = []
      for (let index = 0; index + header.length <= rest.length; index += header.length) {
        rows.push(rest.slice(index, index + header.length))
      }
      return rows.length ? { header, rows } : null
    }

    function renderTipTable(header, rows, key) {
      return h(
        'div',
        { key, className: 'dsh-rcp-tip-table-wrap' },
        h(
          'table',
          { className: 'dsh-rcp-tip-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              header.map((cell, index) => h('th', { key: index }, inlineNodes(cell, `${key}h${index}`))),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((row, rowIndex) =>
              h(
                'tr',
                { key: rowIndex },
                row.map((cell, index) => h('td', { key: index }, inlineNodes(cell, `${key}r${rowIndex}c${index}`))),
              ),
            ),
          ),
        ),
      )
    }

    // The tips files are markdown. Render the constructs that actually appear
    // (headings, tables, fenced tag lists, bullets, quotes, bold, links, code)
    // so the panel never shows raw "##", "| --- |" or "```" on screen.
    function renderTipDocument(paragraphs) {
      const lines = []
      for (const paragraph of paragraphs || []) {
        for (const line of String(paragraph == null ? '' : paragraph).split('\n')) lines.push(line)
        lines.push('')
      }
      const blocks = []
      let buffer = []
      let key = 0
      const flush = () => {
        if (!buffer.length) return
        const text = buffer.join(' ').trim()
        buffer = []
        if (text) blocks.push(h('p', { key: key++, className: 'dsh-rcp-tip-p' }, inlineNodes(text, `p${key}`)))
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) {
          flush()
          continue
        }
        // Shopping lists are fenced "text" blocks, usually on a single line.
        const inlineFence = /^(?:```|~~~)[a-zA-Z]*\s*([\s\S]*?)\s*(?:```|~~~)$/.exec(line)
        if (inlineFence) {
          flush()
          const items = inlineFence[1]
            .split(/[，,、\n]+/)
            .map((item) => item.trim())
            .filter(Boolean)
          blocks.push(
            h(
              'div',
              { key: key++, className: 'dsh-rcp-tip-tags' },
              items.map((item, index) => h('span', { key: index, className: 'dsh-rcp-tip-tag' }, item)),
            ),
          )
          continue
        }
        if (/^(```|~~~)/.test(line)) {
          // A multi-line fence only counts when a closing fence really follows;
          // otherwise the marker is a stray and the lines are plain text.
          let close = -1
          for (let j = i + 1; j < lines.length; j++) {
            if (/^(```|~~~)/.test(lines[j].trim())) {
              close = j
              break
            }
          }
          if (close > 0) {
            flush()
            const items = []
            for (let j = i + 1; j < close; j++) {
              for (const piece of lines[j].split(/[，,、]+/)) {
                const item = piece.trim()
                if (item) items.push(item)
              }
            }
            blocks.push(
              h(
                'div',
                { key: key++, className: 'dsh-rcp-tip-tags' },
                items.map((item, index) => h('span', { key: index, className: 'dsh-rcp-tip-tag' }, item)),
              ),
            )
            i = close
            continue
          }
        }
        if (/^\|/.test(line) && lines[i + 1] && /^\|[\s:\-|]+\|?$/.test(lines[i + 1].trim())) {
          flush()
          const header = tipTableRow(line)
          const rows = []
          i += 2
          while (i < lines.length && /^\|/.test(lines[i].trim())) {
            rows.push(tipTableRow(lines[i].trim()))
            i++
          }
          i--
          blocks.push(renderTipTable(header, rows, key++))
          continue
        }
        const collapsed = parseCollapsedTable(line)
        if (collapsed) {
          flush()
          blocks.push(renderTipTable(collapsed.header, collapsed.rows, key++))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          flush()
          const level = Math.min(3, heading[1].length)
          blocks.push(
            h(
              'div',
              { key: key++, className: `dsh-rcp-tip-h dsh-rcp-tip-h${level}` },
              inlineNodes(heading[2], `h${key}`),
            ),
          )
          continue
        }
        if (/^>\s?/.test(line)) {
          flush()
          blocks.push(
            h(
              'div',
              { key: key++, className: 'dsh-rcp-tip-quote' },
              inlineNodes(line.replace(/^>\s?/, ''), `q${key}`),
            ),
          )
          continue
        }
        const bullet = /^([-*+])\s+(.*)$/.exec(line)
        if (bullet) {
          flush()
          const items = []
          while (i < lines.length) {
            const match = /^([-*+])\s+(.*)$/.exec(lines[i].trim())
            if (!match) break
            // The extractor sometimes joins a bullet run into one line, leaving
            // bare "* " separators; each piece is its own list item.
            for (const piece of match[2].split(/(?<!\*)\*(?!\*)\s*/)) {
              const text = piece.trim()
              if (text) items.push(text)
            }
            i++
          }
          i--
          blocks.push(
            h(
              'ul',
              { key: key++, className: 'dsh-rcp-tip-list' },
              items.map((item, index) => h('li', { key: index }, inlineNodes(item, `l${key}-${index}`))),
            ),
          )
          continue
        }
        const ordered = /^\d+[.、)]\s+(.*)$/.exec(line)
        if (ordered) {
          flush()
          const items = []
          while (i < lines.length) {
            const match = /^\d+[.、)]\s+(.*)$/.exec(lines[i].trim())
            if (!match) break
            items.push(match[1])
            i++
          }
          i--
          blocks.push(
            h(
              'ol',
              { key: key++, className: 'dsh-rcp-tip-list ordered' },
              items.map((item, index) => h('li', { key: index }, inlineNodes(item, `o${key}-${index}`))),
            ),
          )
          continue
        }
        buffer.push(line)
      }
      flush()
      return blocks
    }

    // ---------------------------------------------------------------- amounts
    // Home cooks measure with spoons, not with a scale: 1 小勺 (茶匙) = 5 ml,
    // 1 汤匙 (大勺) = 15 ml, 1 碗 ≈ 250 ml. Liquids weigh about 1 g per ml.
    const LIQUID_INGREDIENT =
      /(酱油|生抽|老抽|豉油|醋|料酒|黄酒|米酒|油|香油|蚝油|蜂蜜|糖浆|水|高汤|牛奶|奶油|椰浆|汁|酒|ml|毫升)/
    const GRAM_AMOUNT = /^(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)$/i
    const roundHalf = (value) => Math.round(value * 2) / 2

    function humanAmount(name, amount) {
      const raw = String(amount || '').trim()
      if (!raw) return { main: '适量', sub: '', vague: true }
      const match = GRAM_AMOUNT.exec(raw)
      if (!match) return { main: raw, sub: '', vague: false }
      const value = parseFloat(match[1])
      const liquid = /ml|毫升/i.test(match[2]) || LIQUID_INGREDIENT.test(name)
      let main
      if (value < 2.5) main = '半小勺'
      else if (value < 12) main = `约 ${roundHalf(value / 5)} 小勺`
      else if (liquid && value >= 180) main = `约 ${roundHalf(value / 250)} 碗`
      else if (!liquid && value > 40) return { main: raw, sub: '', vague: false }
      else main = `约 ${roundHalf(value / 15)} 汤匙`
      return { main, sub: raw, vague: false }
    }

    // -------------------------------------------------------------- tips view
    const SPOON_SAMPLES = [
      { file: 'tips/spoon-teaspoon.webp', caption: '小勺 / 茶匙 ≈ 5 ml' },
      { file: 'tips/spoon-tablespoon.webp', caption: '汤匙 / 大勺 ≈ 15 ml' },
      { file: 'tips/spoons-compare.webp', caption: '三种量勺对比' },
    ]

    function SpoonCard() {
      return h(
        'section',
        { className: 'dsh-rcp-spoons' },
        h(
          'div',
          { className: 'dsh-rcp-spoons-head' },
          h('h3', null, '常用勺具换算'),
          h('p', null, '菜谱里的克重按下面的勺量换算就行，不必称重。'),
        ),
        h(
          'div',
          { className: 'dsh-rcp-spoons-body' },
          h(
            'div',
            { className: 'dsh-rcp-spoon-shots' },
            SPOON_SAMPLES.map((sample) =>
              h(
                'figure',
                { key: sample.file, className: 'dsh-rcp-spoon-shot' },
                h('img', { src: imgUrl(sample.file), alt: sample.caption, loading: 'lazy' }),
                h('figcaption', null, sample.caption),
              ),
            ),
          ),
          h(
            'table',
            { className: 'dsh-rcp-tip-table dsh-rcp-spoon-table' },
            h(
              'thead',
              null,
              h('tr', null, h('th', null, '量具'), h('th', null, '容量'), h('th', null, '大致等于')),
            ),
            h(
              'tbody',
              null,
              h('tr', null, h('td', null, '1 小勺（茶匙）'), h('td', null, '5 ml'), h('td', null, '5 g 盐 / 糖 / 淀粉')),
              h('tr', null, h('td', null, '1 汤匙（大勺）'), h('td', null, '15 ml'), h('td', null, '15 g 盐 / 糖，约 9 g 面粉')),
              h('tr', null, h('td', null, '1 碗'), h('td', null, '250 ml'), h('td', null, '一碗水，约 250 g')),
              h('tr', null, h('td', null, '1 纸杯'), h('td', null, '200 ml'), h('td', null, '一次性纸杯装满')),
            ),
          ),
        ),
      )
    }

    function TipsPanel(props) {
      const tips = props.tips || []
      const [active, setActive] = React.useState(0)
      const index = active < tips.length ? active : 0
      const tip = tips[index] || { title: '', paragraphs: [] }
      return h(
        'div',
        { className: 'dsh-rcp-tips' },
        h(SpoonCard, null),
        h(
          'div',
          { className: 'dsh-rcp-tips-grid' },
          h(
            'aside',
            { className: 'dsh-rcp-toc' },
            h('div', { className: 'dsh-rcp-toc-title' }, `厨房技巧 · 共 ${tips.length} 篇`),
            tips.map((item, itemIndex) =>
              h(
                'button',
                {
                  key: itemIndex,
                  type: 'button',
                  className: `dsh-rcp-toc-item${itemIndex === index ? ' active' : ''}`,
                  onClick: () => setActive(itemIndex),
                },
                h('span', { className: 'dsh-rcp-toc-no' }, String(itemIndex + 1).padStart(2, '0')),
                h('span', { className: 'dsh-rcp-toc-label' }, item.title),
              ),
            ),
          ),
          h(
            'article',
            { className: 'dsh-rcp-tipdoc' },
            h('h3', { className: 'dsh-rcp-tipdoc-title' }, tip.title),
            renderTipDocument(tip.paragraphs),
          ),
        ),
      )
    }

    // ------------------------------------------------------------------ styles
    const CSS = `
.dsh-rcp-root{
  height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  background:var(--dsw-alias-bg-base,#fff);
  color:var(--dsw-alias-label-primary,#1f2328);
  font-size:13px;line-height:1.55;
  font-family:inherit;
}
.dsh-rcp-scroll{overflow:auto;flex:1;min-height:0;}
.dsh-rcp-head{
  display:flex;align-items:center;gap:14px;padding:14px 20px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));
  flex:none;
}
.dsh-rcp-brand{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-rcp-logo{
  width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(140deg,rgba(255,138,60,.22),rgba(255,86,48,.16));
  color:#e2542b;flex:none;
}
.dsh-rcp-title{font-size:15px;font-weight:600;letter-spacing:.2px;line-height:1.2}
.dsh-rcp-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-rcp-head-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.dsh-rcp-search{position:relative;display:flex;align-items:center}
.dsh-rcp-search svg{position:absolute;left:9px;color:var(--dsw-alias-label-secondary,#6b7280);pointer-events:none}
.dsh-rcp-input{
  height:30px;width:230px;border-radius:8px;padding:0 10px 0 28px;font-size:12.5px;
  background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07)));
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));
  color:var(--dsw-alias-label-primary,#1f2328);outline:none;font-family:inherit;
}
.dsh-rcp-input:focus{border-color:var(--dsw-alias-brand-primary,#2f6feb)}
.dsh-rcp-input::placeholder{color:var(--dsw-alias-label-secondary,#8a8f98)}
.dsh-rcp-btn{
  height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));
  background:transparent;color:var(--dsw-alias-label-primary,#1f2328);cursor:pointer;font-size:12.5px;
  font-family:inherit;display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s;
}
.dsh-rcp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09))}
.dsh-rcp-btn.primary{
  background:var(--dsw-alias-brand-primary,#2f6feb);border-color:transparent;
  color:var(--dsw-alias-label-primary-foreground,#fff);
}
.dsh-rcp-btn.primary:hover{filter:brightness(1.06)}
.dsh-rcp-btn.active{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.3))}
.dsh-rcp-btn.ghost{border-color:transparent}
.dsh-rcp-tabs{display:flex;gap:2px;padding:0 20px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}
.dsh-rcp-tab{
  position:relative;padding:9px 10px;border:0;background:transparent;cursor:pointer;font-family:inherit;
  font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7280);display:inline-flex;align-items:center;gap:6px;
}
.dsh-rcp-tab:hover{color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-rcp-tab.on{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
.dsh-rcp-tab.on:after{
  content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;
  background:var(--dsw-alias-brand-primary,#2f6feb);
}
.dsh-rcp-count{
  font-size:10.5px;padding:0 5px;border-radius:20px;line-height:15px;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary,#6b7280);
}
.dsh-rcp-body{padding:16px 20px 28px;max-width:1220px;margin:0 auto;width:100%;box-sizing:border-box}
.dsh-rcp-hero{animation:dsh-rcp-hero-in .26s ease-out}
@keyframes dsh-rcp-hero-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.dsh-rcp-hero{
  position:relative;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0;overflow:hidden;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:linear-gradient(120deg,rgba(255,138,60,.09),rgba(255,86,48,.04) 60%,transparent);
  margin-bottom:18px;min-height:186px;
}
.dsh-rcp-hero-main{padding:20px 22px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.dsh-rcp-eyebrow{
  font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#d9642f;font-weight:600;margin-bottom:8px;
}
.dsh-rcp-hero h2{margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:.2px;line-height:1.25}
.dsh-rcp-hero p{margin:0 0 14px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;max-width:56ch;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-rcp-hero-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);margin-bottom:14px}
.dsh-rcp-hero-meta b{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
.dsh-rcp-hero-actions{display:flex;gap:8px}
.dsh-rcp-hero-art{
  position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:linear-gradient(150deg,rgba(255,138,60,.2),rgba(255,86,48,.1));
}
.dsh-rcp-hero-art img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.dsh-rcp-hero-emoji{font-size:76px;filter:saturate(.95);opacity:.95}
.dsh-rcp-chipbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.dsh-rcp-chip{
  padding:4px 10px;border-radius:20px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);
}
.dsh-rcp-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09));color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-rcp-chip.on{background:var(--dsw-alias-brand-primary,#2f6feb);border-color:transparent;color:#fff}
.dsh-rcp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
.dsh-rcp-card{
  text-align:left;padding:0;border-radius:11px;overflow:hidden;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));
  background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;display:flex;flex-direction:column;
  transition:border-color .15s,transform .15s,box-shadow .15s;
}
.dsh-rcp-card:hover{
  border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.34));
  transform:translateY(-1px);box-shadow:var(--dsw-shadow-lv3,0 8px 22px rgba(0,0,0,.08));
}
.dsh-rcp-cover{position:relative;height:118px;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center}
.dsh-rcp-cover img{width:100%;height:100%;object-fit:cover;display:block}
.dsh-rcp-cover-ph{font-size:34px;opacity:.9}
.dsh-rcp-cover-tag{
  position:absolute;left:8px;top:8px;font-size:10.5px;padding:1px 7px;border-radius:20px;
  background:rgba(0,0,0,.42);color:#fff;backdrop-filter:blur(2px);
}
.dsh-rcp-fav-mark{
  position:absolute;right:8px;top:8px;font-size:12px;width:20px;height:20px;border-radius:50%;
  background:rgba(0,0,0,.4);color:#ffd7c2;display:flex;align-items:center;justify-content:center;
}
.dsh-rcp-card-body{padding:10px 12px 11px;display:flex;flex-direction:column;gap:4px;min-height:0}
.dsh-rcp-card-name{
  font-size:13.5px;font-weight:600;line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;
}
.dsh-rcp-card-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);display:flex;gap:8px;align-items:center}
.dsh-rcp-card-meta .stars{color:#e8a33d;letter-spacing:-1px}
.dsh-rcp-card-ings{
  font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.dsh-rcp-empty{
  margin:26px auto;max-width:420px;text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;
  padding:26px 20px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:12px;
}
.dsh-rcp-empty-emoji{font-size:32px;display:block;margin-bottom:8px;opacity:.8}
.dsh-rcp-section{display:flex;align-items:baseline;gap:10px;margin:22px 0 10px}
.dsh-rcp-section h3{margin:0;font-size:14px;font-weight:600}
.dsh-rcp-section span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
/* detail */
.dsh-rcp-detail{max-width:1080px;margin:0 auto;width:100%}
.dsh-rcp-detail-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.dsh-rcp-detail-title{margin-left:auto;display:flex;gap:8px}
.dsh-rcp-heroimg{
  position:relative;border-radius:12px;overflow:hidden;height:250px;margin-bottom:16px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));
}
.dsh-rcp-heroimg img{width:100%;height:100%;object-fit:cover}
.dsh-rcp-heroimg .ph{font-size:64px}
.dsh-rcp-h1{margin:0 0 8px;font-size:24px;font-weight:650;letter-spacing:.2px}
.dsh-rcp-meta-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.dsh-rcp-pill{
  font-size:11.5px;padding:3px 9px;border-radius:20px;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));
  color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid transparent;
}
.dsh-rcp-pill.warm{background:rgba(232,163,61,.14);color:#a8701c}
.dsh-rcp-pill.green{background:rgba(31,140,90,.12);color:#1f8c5a}
.dsh-rcp-intro{color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px;margin:0 0 18px;max-width:76ch}
.dsh-rcp-cols{display:grid;grid-template-columns:300px minmax(0,1fr);gap:22px;align-items:start}
.dsh-rcp-panel{
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden;
}
.dsh-rcp-panel-head{
  padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12));
  font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary,#6b7280);
  display:flex;align-items:center;justify-content:space-between;
}
.dsh-rcp-ings{list-style:none;margin:0;padding:6px 0}
.dsh-rcp-ing{
  display:grid;grid-template-columns:minmax(4.5em,auto) minmax(0,1fr);align-items:baseline;
  gap:2px 8px;padding:6px 14px;cursor:pointer;font-size:12.5px;
  border-left:2px solid transparent;
}
.dsh-rcp-ing:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.07))}
.dsh-rcp-ing.done{color:var(--dsw-alias-label-secondary,#8a8f98);text-decoration:line-through;border-left-color:var(--dsw-alias-state-success-primary,#1f8c5a)}
.dsh-rcp-ing-name{min-width:4.5em;overflow-wrap:anywhere}
.dsh-rcp-ing-amount{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11.5px;text-align:right;overflow-wrap:anywhere}
.dsh-rcp-ing-amount.vague{color:var(--dsw-alias-label-tertiary,#8a8f98);font-style:italic}
.dsh-rcp-ing-sub{display:block;font-size:10.5px;opacity:.72;letter-spacing:.01em}
.dsh-rcp-ing-note{grid-column:1/-1;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6b7280);opacity:.9}
.dsh-rcp-steps{padding:4px 16px 8px}
.dsh-rcp-step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;padding:10px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(128,128,128,.12))}
.dsh-rcp-step:last-child{border-bottom:0}
.dsh-rcp-step-no{
  width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;
  display:flex;align-items:center;justify-content:center;margin-top:1px;
  background:rgba(255,138,60,.16);color:#c2521f;
}
.dsh-rcp-step-text{font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.dsh-rcp-step-imgs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.dsh-rcp-step-imgs img{max-width:100%;width:230px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));display:block}
.dsh-rcp-tipbox{margin-top:14px}
.dsh-rcp-tipbox ul{margin:0;padding:10px 16px 12px 30px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-rcp-tipbox li{padding:2px 0}
/* pantry */
.dsh-rcp-pantry{max-width:960px;margin:0 auto}
.dsh-rcp-pickbox{
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:14px 16px;margin-bottom:16px;
}
.dsh-rcp-pickbox p{margin:0 0 10px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-rcp-picked{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}
.dsh-rcp-picked .dsh-rcp-chip{background:rgba(255,138,60,.12);border-color:rgba(255,138,60,.28);color:#c2521f}
.dsh-rcp-suggest{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.dsh-rcp-suggest-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-right:4px;align-self:center}
.dsh-rcp-cov{
  font-size:10.5px;padding:1px 7px;border-radius:20px;background:rgba(31,140,90,.12);color:#1f8c5a;
  white-space:nowrap;
}
.dsh-rcp-cov.low{background:rgba(232,163,61,.16);color:#a8701c}
/* tips */
.dsh-rcp-tips{
  max-width:1120px;margin:0 auto;padding:16px 20px 40px;
  display:flex;flex-direction:column;gap:16px;box-sizing:border-box;
}
/* spoon reference card */
.dsh-rcp-spoons{
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:14px 16px 16px;
}
.dsh-rcp-spoons-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.dsh-rcp-spoons-head h3{margin:0;font-size:13.5px;font-weight:700;color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-rcp-spoons-head p{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-rcp-spoons-body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,360px);gap:18px;align-items:start}
.dsh-rcp-spoon-shots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dsh-rcp-spoon-shot{margin:0;display:flex;flex-direction:column;gap:6px}
.dsh-rcp-spoon-shot img{
  width:100%;height:168px;object-fit:contain;border-radius:9px;display:block;padding:6px;box-sizing:border-box;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04));
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12));
}
.dsh-rcp-spoon-shot figcaption{font-size:10.5px;color:var(--dsw-alias-label-secondary,#6b7280);text-align:center;line-height:1.4}
/* toc + article */
.dsh-rcp-tips-grid{display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px;align-items:start}
.dsh-rcp-toc{
  position:sticky;top:0;display:flex;flex-direction:column;gap:2px;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:10px 8px;max-height:70vh;overflow:auto;
}
.dsh-rcp-toc-title{
  font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary,#8a8f98);
  padding:2px 8px 8px;
}
.dsh-rcp-toc-item{
  display:flex;gap:8px;align-items:baseline;text-align:left;width:100%;
  background:none;border:0;border-radius:7px;padding:6px 8px;cursor:pointer;
  font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);line-height:1.4;
}
.dsh-rcp-toc-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
.dsh-rcp-toc-item.active{
  background:rgba(255,138,60,.12);color:#c2521f;font-weight:600;
}
.dsh-rcp-toc-no{font-size:10.5px;font-variant-numeric:tabular-nums;opacity:.7;min-width:1.4em}
.dsh-rcp-toc-label{flex:1}
.dsh-rcp-tipdoc{
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:18px 22px 24px;
  max-width:820px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);
}
.dsh-rcp-tipdoc-title{
  margin:0 0 14px;padding:0 0 10px;font-size:17px;font-weight:700;letter-spacing:.01em;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1));
}
.dsh-rcp-tip-h{
  position:relative;font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#1f2328);
  margin:22px 0 8px;padding-left:10px;letter-spacing:.01em;
}
.dsh-rcp-tip-h::before{
  content:'';position:absolute;left:0;top:.25em;bottom:.2em;width:3px;border-radius:2px;
  background:rgba(255,138,60,.75);
}
.dsh-rcp-tip-h1{font-size:16px;margin-top:26px}
.dsh-rcp-tip-h3{font-size:13px;color:var(--dsw-alias-label-secondary,#4a5260);font-weight:600}
.dsh-rcp-tip-h:first-child{margin-top:2px}
.dsh-rcp-tip-p{margin:0 0 10px;line-height:1.85}
.dsh-rcp-tip-list{margin:2px 0 12px;padding-left:18px;line-height:1.8}
.dsh-rcp-tip-list li{padding:2px 0}
.dsh-rcp-tip-list li::marker{color:var(--dsw-alias-brand-primary,#4f81bd)}
.dsh-rcp-tip-list.ordered li::marker{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}
.dsh-rcp-tip-quote{
  margin:0 0 12px;padding:8px 12px;border-left:3px solid rgba(232,163,61,.7);
  background:rgba(232,163,61,.08);border-radius:0 8px 8px 0;line-height:1.75;
  color:var(--dsw-alias-label-secondary,#4a5260);
}
.dsh-rcp-tip-tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
.dsh-rcp-tip-tag{
  font-size:11.5px;padding:3px 9px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));
  color:var(--dsw-alias-label-secondary,#6b7280);
}
.dsh-rcp-tip-link{color:var(--dsw-alias-brand-primary,#4f81bd);border-bottom:1px dashed currentColor}
.dsh-rcp-tipdoc code{
  font-size:11.5px;padding:1px 5px;border-radius:4px;
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));
}
.dsh-rcp-tip-table-wrap{overflow-x:auto;margin:6px 0 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}
.dsh-rcp-tip-table{width:100%;border-collapse:collapse;font-size:12px}
.dsh-rcp-tip-table th,.dsh-rcp-tip-table td{
  padding:7px 10px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1));
  white-space:nowrap;
}
.dsh-rcp-tip-table th{
  background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));font-weight:600;
  color:var(--dsw-alias-label-secondary,#4a5260);font-size:11px;letter-spacing:.04em;
}
.dsh-rcp-tip-table tbody tr:last-child td{border-bottom:0}
.dsh-rcp-tip-table tbody tr:nth-child(even){background:rgba(128,128,128,.03)}
.dsh-rcp-spoon-table th,.dsh-rcp-spoon-table td{white-space:normal}
@media (max-width:900px){
  .dsh-rcp-spoons-body{grid-template-columns:minmax(0,1fr)}
  .dsh-rcp-tips-grid{grid-template-columns:minmax(0,1fr)}
  .dsh-rcp-toc{position:static;max-height:none;flex-direction:row;flex-wrap:wrap;overflow:visible}
  .dsh-rcp-toc-title{display:none}
  .dsh-rcp-toc-item{width:auto}
}
/* misc */
.dsh-rcp-loading{display:flex;align-items:center;justify-content:center;gap:10px;height:100%;color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px}
.dsh-rcp-spinner{
  width:16px;height:16px;border-radius:50%;border:2px solid rgba(128,128,128,.25);border-top-color:var(--dsw-alias-brand-primary,#2f6feb);
  animation:dsh-rcp-spin .8s linear infinite;
}
@keyframes dsh-rcp-spin{to{transform:rotate(360deg)}}
.dsh-rcp-error{max-width:520px;margin:40px auto;text-align:center;color:var(--dsw-alias-state-error-primary,#c93c3c);font-size:13px}
.dsh-rcp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:940px){
  .dsh-rcp-hero{grid-template-columns:minmax(0,1fr) 220px}
  .dsh-rcp-cols{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:720px){
  .dsh-rcp-hero{grid-template-columns:minmax(0,1fr)}
  .dsh-rcp-hero-art{display:none}
  .dsh-rcp-input{width:150px}
  .dsh-rcp-head{padding:12px 14px 8px;flex-wrap:wrap}
  .dsh-rcp-tabs{padding:0 10px}
  .dsh-rcp-body{padding:14px 12px 24px}
}
`

    // ------------------------------------------------------------------ icons
    function IconSearch() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' },
        h('circle', { cx: 11, cy: 11, r: 7 }),
        h('path', { d: 'M20 20l-3.5-3.5' }),
      )
    }

    function IconPot({ size }) {
      const s = size || 18
      return h(
        'svg',
        {
          width: s,
          height: s,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M4 11h16' }),
        h('path', { d: 'M5.5 11c0 4.2 2.9 7.4 6.5 7.4s6.5-3.2 6.5-7.4' }),
        h('path', { d: 'M9 7.6c0-1.2 1-1.5 1-2.6' }),
        h('path', { d: 'M13 7.6c0-1.2 1-1.5 1-2.6' }),
      )
    }

    // ------------------------------------------------------------------ pieces
    function Cover({ recipe, emojiOnly }) {
      const [broken, setBroken] = React.useState(false)
      const raw = recipe.images && recipe.images.length ? recipe.images[0] : ''
      const hue = hashHue(recipe.name)
      const background = `linear-gradient(135deg, hsl(${hue} 55% 62% / .2), hsl(${(hue + 40) % 360} 50% 45% / .3))`
      if (raw && !broken) {
        return h(
          'div',
          { className: 'dsh-rcp-cover', style: { background } },
          h('img', {
            src: imgUrl(raw),
            alt: recipe.name,
            loading: 'lazy',
            onError: () => setBroken(true),
          }),
        )
      }
      return h(
        'div',
        { className: 'dsh-rcp-cover', style: { background } },
        h(
          'span',
          { className: 'dsh-rcp-cover-ph', title: recipe.name },
          emojiOnly ? CATEGORY_EMOJI[recipe.category] || '🍽️' : CATEGORY_EMOJI[recipe.category] || '🍽️',
        ),
      )
    }

    function Card({ recipe, onOpen, favorite }) {
      const ings = (recipe.ingredients || [])
        .slice(0, 3)
        .map((item) => item.name)
        .join('、')
      return h(
        'button',
        { type: 'button', className: 'dsh-rcp-card', onClick: () => onOpen(recipe.id), title: recipe.name },
        h(
          'div',
          { style: { position: 'relative' } },
          h(Cover, { recipe }),
          h('span', { className: 'dsh-rcp-cover-tag' }, recipe.category),
          favorite ? h('span', { className: 'dsh-rcp-fav-mark' }, '♥') : null,
        ),
        h(
          'div',
          { className: 'dsh-rcp-card-body' },
          h('span', { className: 'dsh-rcp-card-name' }, recipe.name),
          h(
            'span',
            { className: 'dsh-rcp-card-meta' },
            recipe.difficulty
              ? h('span', { className: 'stars' }, stars(recipe.difficulty))
              : null,
            recipe.calories ? h('span', null, `${recipe.calories} 大卡`) : null,
            recipe.ingredients ? h('span', null, `${recipe.ingredients.length} 种原料`) : null,
          ),
          ings ? h('span', { className: 'dsh-rcp-card-ings' }, ings) : null,
        ),
      )
    }

    function Empty({ emoji, title, hint }) {
      return h(
        'div',
        { className: 'dsh-rcp-empty' },
        h('span', { className: 'dsh-rcp-empty-emoji' }, emoji),
        h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary,#1f2328)', marginBottom: 4 } }, title),
        h('div', null, hint),
      )
    }

    function Detail({ recipe, store, state, onBack, onOpen }) {
      const favorite = state.favorites.includes(recipe.id)
      const cooked = state.cooked.includes(recipe.id)
      const [checked, setChecked] = React.useState({})
      React.useEffect(() => setChecked({}), [recipe.id])

      const toggle = (key) => {
        const list = state[key]
        const next = list.includes(recipe.id) ? list.filter((id) => id !== recipe.id) : [...list, recipe.id]
        writeList(key === 'favorites' ? STORE_FAV : STORE_COOKED, next)
        store.set({ [key]: next })
      }

      const steps = recipe.steps || []
      const ingredients = recipe.ingredients || []

      return h(
        'div',
        { className: 'dsh-rcp-detail' },
        h(
          'div',
          { className: 'dsh-rcp-detail-bar' },
          h(
            'button',
            { type: 'button', className: 'dsh-rcp-btn ghost', onClick: onBack },
            '← 返回列表',
          ),
          h(
            'div',
            { className: 'dsh-rcp-detail-title' },
            h(
              'button',
              {
                type: 'button',
                className: `dsh-rcp-btn${favorite ? ' active' : ''}`,
                onClick: () => toggle('favorites'),
                title: favorite ? '取消收藏' : '收藏这道菜',
              },
              favorite ? '♥ 已收藏' : '♡ 收藏',
            ),
            h(
              'button',
              {
                type: 'button',
                className: `dsh-rcp-btn${cooked ? ' active' : ''}`,
                onClick: () => toggle('cooked'),
                title: cooked ? '取消做过标记' : '标记为做过',
              },
              cooked ? '✓ 做过' : '标记做过',
            ),
          ),
        ),

        recipe.images && recipe.images.length
          ? h(
              'div',
              { className: 'dsh-rcp-heroimg' },
              h('img', { src: imgUrl(recipe.images[0], 'hd'), alt: recipe.name }),
            )
          : h(
              'div',
              {
                className: 'dsh-rcp-heroimg',
                style: {
                  background: `linear-gradient(135deg, hsl(${hashHue(recipe.name)} 55% 62% / .2), hsl(${(hashHue(recipe.name) + 40) % 360} 50% 45% / .3))`,
                },
              },
              h('span', { className: 'ph' }, CATEGORY_EMOJI[recipe.category] || '🍽️'),
            ),

        h('h1', { className: 'dsh-rcp-h1' }, recipe.name),
        h(
          'div',
          { className: 'dsh-rcp-meta-row' },
          h('span', { className: 'dsh-rcp-pill' }, recipe.category),
          recipe.difficulty
            ? h('span', { className: 'dsh-rcp-pill warm' }, `难度 ${stars(recipe.difficulty)}`)
            : null,
          recipe.calories ? h('span', { className: 'dsh-rcp-pill' }, `约 ${recipe.calories} 大卡`) : null,
          h('span', { className: 'dsh-rcp-pill green' }, `${ingredients.length} 种原料`),
          h('span', { className: 'dsh-rcp-pill' }, `${steps.length} 步`),
        ),
        recipe.intro ? h('p', { className: 'dsh-rcp-intro' }, recipe.intro) : null,

        h(
          'div',
          { className: 'dsh-rcp-cols' },
          h(
            'div',
            { className: 'dsh-rcp-panel' },
            h(
              'div',
              { className: 'dsh-rcp-panel-head' },
              h('span', null, '原料'),
              h('span', { style: { fontWeight: 400, fontSize: 11 } }, '点击划掉已备好'),
            ),
            h(
              'ul',
              { className: 'dsh-rcp-ings' },
              ingredients.map((item, index) => {
                const human = humanAmount(item.name, item.amount)
                return h(
                  'li',
                  {
                    key: `${item.name}-${index}`,
                    className: `dsh-rcp-ing${checked[index] ? ' done' : ''}`,
                    onClick: () => setChecked((prev) => ({ ...prev, [index]: !prev[index] })),
                  },
                  h('span', { className: 'dsh-rcp-ing-name' }, item.name),
                  h(
                    'span',
                    { className: `dsh-rcp-ing-amount${human.vague ? ' vague' : ''}` },
                    human.main,
                    human.sub ? h('span', { className: 'dsh-rcp-ing-sub' }, human.sub) : null,
                  ),
                  item.note ? h('span', { className: 'dsh-rcp-ing-note' }, item.note) : null,
                )
              }),
            ),
          ),
          h(
            'div',
            null,
            h(
              'div',
              { className: 'dsh-rcp-panel' },
              h('div', { className: 'dsh-rcp-panel-head' }, h('span', null, '做法')),
              h(
                'div',
                { className: 'dsh-rcp-steps' },
                steps.map((step, index) =>
                  h(
                    'div',
                    { key: index, className: 'dsh-rcp-step' },
                    h('span', { className: 'dsh-rcp-step-no' }, index + 1),
                    h(
                      'div',
                      null,
                      h('div', { className: 'dsh-rcp-step-text' }, step.text),
                      step.images && step.images.length
                        ? h(
                            'div',
                            { className: 'dsh-rcp-step-imgs' },
                            step.images.map((src, i) =>
                              h('img', { key: i, src: imgUrl(src), alt: `${recipe.name} 步骤 ${index + 1}`, loading: 'lazy' }),
                            ),
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            ),
            recipe.tips && recipe.tips.length
              ? h(
                  'div',
                  { className: 'dsh-rcp-panel dsh-rcp-tipbox' },
                  h('div', { className: 'dsh-rcp-panel-head' }, h('span', null, '附加内容')),
                  h(
                    'ul',
                    null,
                    recipe.tips.map((tip, index) => h('li', { key: index }, tip)),
                  ),
                )
              : null,
          ),
        ),
      )
    }

    // ------------------------------------------------------------------- panel
    function createPanel(store, actions) {
      function Panel() {
        const state = useStore(store)

        if (state.status === 'loading') {
          return h(
            'div',
            { className: 'dsh-rcp-root' },
            h(
              'div',
              { className: 'dsh-rcp-loading' },
              h('span', { className: 'dsh-rcp-spinner' }),
              h('span', null, '正在加载菜谱…'),
            ),
          )
        }
        if (state.status === 'error') {
          return h(
            'div',
            { className: 'dsh-rcp-root' },
            h(
              'div',
              { className: 'dsh-rcp-error' },
              h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '菜谱数据没能加载'),
              h('div', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, String(state.error || '')),
              h(
                'button',
                { type: 'button', className: 'dsh-rcp-btn primary', style: { marginTop: 14 }, onClick: actions.reload },
                '重试',
              ),
            ),
          )
        }

        const { data, view, query, category, recipeId, favorites, cooked, pantryQuery, pantryPicked, heroId } = state
        const recipes = data.recipes
        const byId = data.byId

        if (recipeId && byId[recipeId]) {
          return h(
            'div',
            { className: 'dsh-rcp-root' },
            h(
              'div',
              { className: 'dsh-rcp-scroll' },
              h(
                'div',
                { className: 'dsh-rcp-body' },
                h(Detail, {
                  recipe: byId[recipeId],
                  store,
                  state,
                  onBack: () => store.set({ recipeId: null }),
                  onOpen: actions.open,
                }),
              ),
            ),
          )
        }

        const tokens = tokenize(query)
        const filtered = recipes.filter((recipe) => {
          if (category && recipe.category !== category) return false
          return matchesQuery(recipe, tokens)
        })

        let list = filtered
        if (view === 'favorites') list = filtered.filter((recipe) => favorites.includes(recipe.id))
        if (view === 'cooked') list = filtered.filter((recipe) => cooked.includes(recipe.id))

        const pantryTokens = pantryPicked.map((item) => normalized(item))
        let pantryHits = []
        if (view === 'pantry' && pantryTokens.length) {
          pantryHits = recipes
            .map((recipe) => ({ recipe, ratio: matchRatio(recipe, pantryTokens) }))
            .filter((entry) => entry.ratio >= 1)
            .sort((a, b) => (a.recipe.difficulty || 0) - (b.recipe.difficulty || 0))
        }
        const pantryLoose = pantryTokens.length
          ? recipes
              .map((recipe) => ({ recipe, ratio: matchRatio(recipe, pantryTokens) }))
              .filter((entry) => entry.ratio > 0 && entry.ratio < 1)
              .sort((a, b) => b.ratio - a.ratio)
              .slice(0, 12)
          : []

        const suggest = pantryQuery
          ? data.ingredients
              .filter((name) => normalized(name).includes(normalized(pantryQuery)))
              .slice(0, 14)
          : []

        // "换一道" swaps this card in place; it never navigates away.
        const hero = (heroId && byId[heroId]) || data.daily

        return h(
          'div',
          { className: 'dsh-rcp-root' },
          h(
            'header',
            { className: 'dsh-rcp-head' },
            h(
              'div',
              { className: 'dsh-rcp-brand' },
              h('div', { className: 'dsh-rcp-logo' }, h(IconPot, { size: 19 })),
              h(
                'div',
                { style: { minWidth: 0 } },
                h('div', { className: 'dsh-rcp-title' }, '菜谱盒子'),
                h(
                  'div',
                  { className: 'dsh-rcp-sub' },
                  `${recipes.length} 道家常菜 · 收藏 ${favorites.length} · 做过 ${cooked.length}`,
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-rcp-head-actions' },
              h(
                'div',
                { className: 'dsh-rcp-search' },
                h(IconSearch),
                h('input', {
                  className: 'dsh-rcp-input',
                  placeholder: '搜菜名、食材，如「番茄」「豆腐」',
                  value: query,
                  onChange: (event) => store.set({ query: event.target.value, view: view === 'favorites' || view === 'cooked' ? view : 'all' }),
                }),
              ),
              h(
                'button',
                { type: 'button', className: 'dsh-rcp-btn', onClick: actions.random, title: '随机来一道' },
                '🎲 随机',
              ),
            ),
          ),
          h(
            'nav',
            { className: 'dsh-rcp-tabs' },
            TABS.map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: `dsh-rcp-tab${view === key ? ' on' : ''}`,
                  onClick: () => store.set({ view: key, recipeId: null }),
                },
                label,
                key === 'favorites' ? h('span', { className: 'dsh-rcp-count' }, favorites.length) : null,
                key === 'cooked' ? h('span', { className: 'dsh-rcp-count' }, cooked.length) : null,
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-rcp-scroll' },
            h(
              'div',
              { className: 'dsh-rcp-body' },
              view === 'all' && !tokens.length && !category
                ? h(
                    'div',
                    { className: 'dsh-rcp-hero', key: hero.id },
                    h(
                      'div',
                      { className: 'dsh-rcp-hero-main' },
                      h('div', { className: 'dsh-rcp-eyebrow' }, heroId ? '随便看看' : '今日推荐'),
                      h('h2', null, hero.name),
                      h('p', null, hero.intro || '跟着步骤做，不会翻车。'),
                      h(
                        'div',
                        { className: 'dsh-rcp-hero-meta' },
                        h('span', null, hero.category),
                        hero.difficulty ? h('span', null, '难度 ', h('b', null, stars(hero.difficulty))) : null,
                        hero.calories ? h('span', null, h('b', null, hero.calories), ' 大卡') : null,
                        hero.ingredients ? h('span', null, h('b', null, hero.ingredients.length), ' 种原料') : null,
                      ),
                      h(
                        'div',
                        { className: 'dsh-rcp-hero-actions' },
                        h(
                          'button',
                          { type: 'button', className: 'dsh-rcp-btn primary', onClick: () => actions.open(hero.id) },
                          '看做法 →',
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-rcp-btn', onClick: actions.shuffleHero, title: '换一道菜，留在本页' },
                          '换一道',
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dsh-rcp-hero-art' },
                      hero.images && hero.images.length
                        ? h('img', { src: imgUrl(hero.images[0]), alt: hero.name })
                        : h('span', { className: 'dsh-rcp-hero-emoji' }, CATEGORY_EMOJI[hero.category] || '🍽️'),
                    ),
                  )
                : null,

              view === 'tips' ? h(TipsPanel, { tips: data.tips }) : view === 'pantry'
                  ? h(
                      'div',
                      { className: 'dsh-rcp-pantry' },
                      h(
                        'div',
                        { className: 'dsh-rcp-pickbox' },
                        h('p', null, '把冰箱里有的一样样加进来，看看今晚能做什么。全部命中会排在前面。'),
                        pantryPicked.length
                          ? h(
                              'div',
                              { className: 'dsh-rcp-picked' },
                              pantryPicked.map((name) =>
                                h(
                                  'button',
                                  {
                                    key: name,
                                    type: 'button',
                                    className: 'dsh-rcp-chip',
                                    title: '移除',
                                    onClick: () => actions.removePantry(name),
                                  },
                                  `${name} ×`,
                                ),
                              ),
                            )
                          : null,
                        h(
                          'div',
                          { className: 'dsh-rcp-search', style: { width: '100%' } },
                          h(IconSearch),
                          h('input', {
                            className: 'dsh-rcp-input',
                            style: { width: '100%' },
                            placeholder: '输入食材，如 鸡蛋 / 番茄 / 土豆',
                            value: pantryQuery,
                            onChange: (event) => store.set({ pantryQuery: event.target.value }),
                          }),
                        ),
                        pantryQuery
                          ? h(
                              'div',
                              { className: 'dsh-rcp-suggest' },
                              suggest
                                .filter((name) => !pantryPicked.includes(name))
                                .map((name) =>
                                  h(
                                    'button',
                                    {
                                      key: name,
                                      type: 'button',
                                      className: 'dsh-rcp-chip',
                                      onClick: () => actions.addPantry(name),
                                    },
                                    `+ ${name}`,
                                  ),
                                ),
                              !suggest.length
                                ? h('span', { className: 'dsh-rcp-suggest-label' }, '没找到这个食材，换个说法试试')
                                : null,
                            )
                          : PANTRY_STAPLES.filter((group) =>
                              group.items.some((name) => !pantryPicked.includes(name)),
                            ).map((group) =>
                              h(
                                'div',
                                { key: group.label, className: 'dsh-rcp-suggest' },
                                h('span', { className: 'dsh-rcp-suggest-label' }, group.label),
                                group.items
                                  .filter((name) => !pantryPicked.includes(name))
                                  .map((name) =>
                                    h(
                                      'button',
                                      {
                                        key: name,
                                        type: 'button',
                                        className: 'dsh-rcp-chip',
                                        onClick: () => actions.addPantry(name),
                                      },
                                      `+ ${name}`,
                                    ),
                                  ),
                              ),
                            ),
                      ),
                      pantryPicked.length
                        ? h(
                            'div',
                            null,
                            h(
                              'div',
                              { className: 'dsh-rcp-section', style: { marginTop: 0 } },
                              h('h3', null, '食材齐了'),
                              h('span', null, pantryHits.length ? `${pantryHits.length} 道` : '暂时没有'),
                            ),
                            pantryHits.length
                              ? h(
                                  'div',
                                  { className: 'dsh-rcp-grid' },
                                  pantryHits.map((entry) =>
                                    h(Card, {
                                      key: entry.recipe.id,
                                      recipe: entry.recipe,
                                      onOpen: actions.open,
                                      favorite: favorites.includes(entry.recipe.id),
                                    }),
                                  ),
                                )
                              : h(Empty, {
                                  emoji: '🧺',
                                  title: '这些食材凑不齐一道菜',
                                  hint: '去掉一两样再试试，或看看下面的「差一点的菜」。',
                                }),
                            pantryLoose.length
                              ? h(
                                  'div',
                                  null,
                                  h(
                                    'div',
                                    { className: 'dsh-rcp-section' },
                                    h('h3', null, '差一点的菜'),
                                    h('span', null, '再买一两样就能做'),
                                  ),
                                  h(
                                    'div',
                                    { className: 'dsh-rcp-grid' },
                                    pantryLoose.map((entry) =>
                                      h(Card, {
                                        key: entry.recipe.id,
                                        recipe: entry.recipe,
                                        onOpen: actions.open,
                                        favorite: favorites.includes(entry.recipe.id),
                                      }),
                                    ),
                                  ),
                                )
                              : null,
                          )
                        : h(Empty, {
                            emoji: '🥕',
                            title: '先加几样食材',
                            hint: '比如鸡蛋、番茄、土豆 —— 选好后这里会列出能做的菜。',
                          }),
                    )
                  : h(
                      'div',
                      null,
                      view !== 'favorites' && view !== 'cooked'
                        ? h(
                            'div',
                            { className: 'dsh-rcp-chipbar' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: `dsh-rcp-chip${!category ? ' on' : ''}`,
                                onClick: () => store.set({ category: '' }),
                              },
                              '全部',
                            ),
                            data.categories.map((item) =>
                              h(
                                'button',
                                {
                                  key: item.name,
                                  type: 'button',
                                  className: `dsh-rcp-chip${category === item.name ? ' on' : ''}`,
                                  onClick: () => store.set({ category: category === item.name ? '' : item.name }),
                                },
                                `${CATEGORY_EMOJI[item.name] || ''} ${item.name}`,
                              ),
                            ),
                          )
                        : null,
                      h(
                        'div',
                        { className: 'dsh-rcp-section', style: { marginTop: view === 'all' ? 4 : 0 } },
                        h(
                          'h3',
                          null,
                          view === 'favorites' ? '我的收藏' : view === 'cooked' ? '做过的菜' : tokens.length || category ? '搜索结果' : '全部菜谱',
                        ),
                        h('span', null, `${list.length} 道`),
                      ),
                      list.length
                        ? h(
                            'div',
                            { className: 'dsh-rcp-grid' },
                            list.map((recipe) =>
                              h(Card, {
                                key: recipe.id,
                                recipe,
                                onOpen: actions.open,
                                favorite: favorites.includes(recipe.id),
                              }),
                            ),
                          )
                        : h(Empty, {
                            emoji: view === 'favorites' ? '♡' : view === 'cooked' ? '🍳' : '🔍',
                            title:
                              view === 'favorites'
                                ? '还没有收藏的菜'
                                : view === 'cooked'
                                  ? '还没有标记做过的菜'
                                  : '没有找到匹配的菜',
                            hint:
                              view === 'favorites'
                                ? '在菜谱详情页点「收藏」，之后从这里快速找到它。'
                                : view === 'cooked'
                                  ? '做完一道就点「标记做过」，攒出你的厨艺记录。'
                                  : '换个短一点的关键词，或清空分类筛选。',
                          }),
                    ),
            ),
          ),
        )
      }
      return Panel
    }

    // -------------------------------------------------------------------- apply
    return {
      name: 'dsh-cookbook/client',
      inject: ['slots'],
      apply(ctx) {
        // ---- style (registered as an effect so the panel leaves no residue)
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-recipe-box', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'recipe-box: styles')

        const favorites = readList(STORE_FAV)
        const cooked = readList(STORE_COOKED)

        const store = makeStore({
          status: 'loading',
          error: '',
          data: null,
          view: 'all',
          query: '',
          category: '',
          recipeId: null,
          favorites,
          cooked,
          pantryQuery: '',
          pantryPicked: [],
        })

        let cancelled = false

        function load() {
          if (cancelled) return
          store.set({ status: 'loading', error: '' })
          fetch(DATA_URL, { cache: 'no-cache' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return response.json()
            })
            .then((dataset) => {
              if (cancelled) return
              const recipes = []
              for (const category of dataset.categories || []) {
                for (const recipe of category.recipes || []) recipes.push(recipe)
              }
              // Keep the original category order for the chip bar.
              const ordered = (dataset.categories || []).map((item) => ({
                name: item.name,
                count: (item.recipes || []).length,
              }))
              const byId = Object.create(null)
              for (const recipe of recipes) byId[recipe.id] = recipe

              const ingredientCounts = new Map()
              for (const recipe of recipes) {
                for (const item of recipe.ingredients || []) {
                  const name = String(item.name || '').trim()
                  if (!name) continue
                  ingredientCounts.set(name, (ingredientCounts.get(name) || 0) + 1)
                }
              }
              const ingredients = [...ingredientCounts.keys()]
              const topIngredients = [...ingredientCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 60)
                .map((entry) => entry[0])

              const day = Math.floor(Date.now() / 86400000)
              const withImage = recipes.filter((recipe) => recipe.images && recipe.images.length)
              const pool = withImage.length > 40 ? withImage : recipes
              const daily = pool[day % pool.length]

              store.set({
                status: 'ready',
                data: { recipes, byId, categories: ordered, ingredients, topIngredients, tips: dataset.tips || [], daily, source: dataset.source },
              })
            })
            .catch((error) => {
              if (cancelled) return
              store.set({ status: 'error', error: error && error.message ? error.message : String(error) })
            })
        }

        const actions = {
          reload: () => load(),
          open: (id) => {
            store.set({ recipeId: id })
            const scroller = document.querySelector('.dsh-rcp-scroll')
            if (scroller) scroller.scrollTop = 0
          },
          shuffleHero: () => {
            const state = store.get()
            const recipes = state.data ? state.data.recipes : []
            if (!recipes.length) return
            const current = (state.heroId && state.data.byId[state.heroId]) || state.data.daily
            const withImage = recipes.filter((recipe) => recipe.images && recipe.images.length)
            const pool = (withImage.length > 40 ? withImage : recipes).filter(
              (recipe) => !current || recipe.id !== current.id,
            )
            const pick = pool[Math.floor(Math.random() * pool.length)] || recipes[0]
            store.set({ heroId: pick.id })
          },
          random: () => {
            const state = store.get()
            const recipes = state.data ? state.data.recipes : []
            if (!recipes.length) return
            const pick = recipes[Math.floor(Math.random() * recipes.length)]
            store.set({ recipeId: pick.id })
          },
          addPantry: (name) => {
            const state = store.get()
            if (state.pantryPicked.includes(name)) return
            // The picked name turns into a chip, so the box that found it is empty again.
            store.set({ pantryPicked: [...state.pantryPicked, name], pantryQuery: '' })
          },
          removePantry: (name) => {
            const state = store.get()
            store.set({ pantryPicked: state.pantryPicked.filter((item) => item !== name) })
          },
        }


        const Panel = createPanel(store, actions)

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_KEY }, Panel),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_KEY, order: 30, label: '菜谱' },
            function RecipeBoxIcon({ size, active }) {
              return h(
                'span',
                {
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: size || 20,
                    height: size || 20,
                    color: active ? 'var(--dsw-alias-label-primary,#1f2328)' : 'inherit',
                  },
                  title: '菜谱盒子',
                },
                h(IconPot, { size: size || 20 }),
              )
            },
          ),
        )

        ctx.effect(() => {
          load()
          return () => {
            cancelled = true
          }
        }, 'recipe-box: data')

        actions.reload = load
      },
    }
  },
})
