// Recipe Box — host half.
//
// Two responsibilities:
//   1. serve the bundled HowToCook dataset (and proxy its images) to the Web
//      GUI client through a single webServer prefix route;
//   2. expose recipe_* tools so the agent can look recipes up in chat.
//
// Data: Anduin2017/HowToCook, Unlicense. See NOTICE.md.

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const inject = ['tools', 'webServer']

const ROUTE = '/recipe-box'
// Pictures ship inside the bundle as 900px WebP, so most requests never touch
// the network at all.
const IMAGES_ROOT = fileURLToPath(new URL('./data/images/', import.meta.url))
// Detail pages pull the 1200px tier; cards and lists stay on the 640px one.
const IMAGES_HD_ROOT = fileURLToPath(new URL('./data/images-hd/', import.meta.url))
const UPSTREAM = 'https://raw.githubusercontent.com/Anduin2017/HowToCook/master/'
// cdn.jsdelivr.net 301s to raw.githubusercontent.com, which stalls from Node, so
// the Fastly edge (which serves the file directly) leads and Gcore backs it up.
const CDN_MIRRORS = [
  'https://gcore.jsdelivr.net/gh/Anduin2017/HowToCook@master/',
  'https://fastly.jsdelivr.net/gh/Anduin2017/HowToCook@master/',
]
const FALLBACK_CDN = CDN_MIRRORS[0]
const MAX_CACHE = 120

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

function extensionOf(pathname) {
  const match = /\.([a-z0-9]+)$/i.exec(pathname)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function isSafeRelative(pathname) {
  if (!pathname || pathname.startsWith('/') || pathname.includes('\0')) return false
  const segments = pathname.split('/')
  return segments.every((segment) => segment !== '..' && segment !== '' && segment !== '.')
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-·、，,。.（）()：:]/g, '')
}

function stars(count) {
  const n = Math.max(0, Math.min(5, Number(count) || 0))
  return '★'.repeat(n)
}

// Home cooks measure with spoons: 1 小勺 (茶匙) = 5 ml, 1 汤匙 (大勺) = 15 ml,
// 1 碗 ≈ 250 ml. Kept in step with humanAmount() in client.js.
const LIQUID_INGREDIENT =
  /(酱油|生抽|老抽|豉油|醋|料酒|黄酒|米酒|油|香油|蚝油|蜂蜜|糖浆|水|高汤|牛奶|奶油|椰浆|汁|酒|ml|毫升)/
const GRAM_AMOUNT = /^(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)$/i
const roundHalf = (value) => Math.round(value * 2) / 2

function humanAmount(name, amount) {
  const raw = String(amount || '').trim()
  if (!raw) return '适量'
  const match = GRAM_AMOUNT.exec(raw)
  if (!match) return raw
  const value = Number.parseFloat(match[1])
  const liquid = /ml|毫升/i.test(match[2]) || LIQUID_INGREDIENT.test(name)
  let main
  if (value < 2.5) main = '半小勺'
  else if (value < 12) main = `约 ${roundHalf(value / 5)} 小勺`
  else if (liquid && value >= 180) main = `约 ${roundHalf(value / 250)} 碗`
  else if (!liquid && value > 40) return raw
  else main = `约 ${roundHalf(value / 15)} 汤匙`
  return `${main}（${raw}）`
}

export function apply(ctx) {
  const dataPath = fileURLToPath(new URL('./data/recipes.json', import.meta.url))
  const raw = readFileSync(dataPath, 'utf8')
  const dataset = JSON.parse(raw)
  const recipeJson = JSON.stringify(dataset)

  const recipes = []
  for (const category of dataset.categories || []) {
    for (const recipe of category.recipes || []) {
      recipes.push(recipe)
    }
  }

// Chinese ingredient synonyms. Without this a pantry of 西红柿 never satisfies a
// recipe that asks for 番茄, which hides the most obvious match in the library.
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
  const name = normalize(value)
  return SYNONYM.get(name) || name
}

  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const byNormalizedName = new Map()
  for (const recipe of recipes) {
    const key = normalize(recipe.name)
    if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, recipe)
  }
  const tips = dataset.tips || []

  // ---------------------------------------------------------------- web route
  const imageCache = new Map()
  // Pictures that no mirror could serve are remembered so a page full of them
  // does not pay the timeout again on every reload.
  const missingImages = new Set()

  function localImagePath(relative, size) {
    if (!relative || relative.startsWith('http')) return ''
    // data/images (640px) and data/images-hd (1200px) mirror the repo layout,
    // with the extension swapped to .webp.
    const slash = relative.lastIndexOf('/')
    const dot = relative.lastIndexOf('.')
    const base = dot > slash ? relative.slice(0, dot) : relative
    return `${size === 'hd' ? IMAGES_HD_ROOT : IMAGES_ROOT}${base}.webp`
  }

  async function proxyImage(res, relative, size) {
    const key = `${size === 'hd' ? 'hd' : 'std'}|${relative}`
    const cached = imageCache.get(key)
    if (cached) {
      res.writeHead(200, {
        'content-type': cached.type,
        'cache-control': 'public, max-age=86400',
      })
      res.end(cached.body)
      return
    }
    // Clients may hand us an already-encoded path (%E6%8B%94...); files on disk
    // use the decoded form, so both spellings have to resolve.
    let localRelative = relative
    try {
      localRelative = decodeURIComponent(relative)
    } catch {}
    // A missing HD file falls back to the card tier rather than to the network.
    const localCandidates = size === 'hd' ? [localImagePath(localRelative, 'hd'), localImagePath(localRelative, 'std')] : [localImagePath(localRelative, 'std')]
    for (const local of localCandidates) {
      if (!local) continue
      try {
        const body = await readFile(local)
        if (imageCache.size >= MAX_CACHE) imageCache.delete(imageCache.keys().next().value)
        imageCache.set(key, { body, type: 'image/webp' })
        res.writeHead(200, {
          'content-type': 'image/webp',
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(body)
        return
      } catch {}
    }
    if (missingImages.has(relative)) {
      // A redirect here would be cached and would send the browser to a CDN that
      // may be unreachable; a plain 404 keeps the failure local and retryable.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('image not found')
      return
    }

    // Both jsDelivr edges answer in 1-3s from here while the raw host stalls, but
    // either edge can go silent for tens of seconds. Racing them keeps one slow
    // edge from costing the whole picture.
    const candidates = localRelative.startsWith('http')
      ? [localRelative]
      : [...CDN_MIRRORS.map((mirror) => mirror + encodeURI(localRelative)), UPSTREAM + encodeURI(localRelative)]
    try {
      let result = null
      const attempt = async (upstream) => {
        const response = await fetch(upstream, {
          signal: AbortSignal.timeout(6000),
          headers: { 'user-agent': 'dsh-cookbook/1.0.2' },
        })
        if (!response.ok) throw new Error(`upstream ${response.status}`)
        const body = Buffer.from(await response.arrayBuffer())
        const type =
          response.headers.get('content-type')?.split(';')[0]?.trim() ||
          CONTENT_TYPES[extensionOf(relative)] ||
          'application/octet-stream'
        return { body, type }
      }
      try {
        result = await Promise.any(candidates.map(attempt))
      } catch {
        result = null
      }
      if (!result) {
        if (missingImages.size > 400) missingImages.clear()
        missingImages.add(relative)
        throw new Error('all upstreams failed')
      }
      const { body, type } = result
      if (imageCache.size >= MAX_CACHE) {
        imageCache.delete(imageCache.keys().next().value)
      }
      imageCache.set(relative, { body, type })
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'public, max-age=86400',
      })
      res.end(body)
    } catch {
      // Never break a card over one picture: bounce the browser to the CDN.
      res.writeHead(302, {
        location: localRelative.startsWith('http') ? localRelative : FALLBACK_CDN + encodeURI(localRelative),
      })
      res.end()
    }
  }

  async function handleRoute(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname
    if (pathname === `${ROUTE}/data.json`) {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(recipeJson)
      return
    }
    if (pathname.startsWith(`${ROUTE}/img/`)) {
      let relative = ''
      try {
        relative = decodeURIComponent(pathname.slice(`${ROUTE}/img/`.length))
      } catch {
        relative = ''
      }
      if (!isSafeRelative(relative)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad image path')
        return
      }
      await proxyImage(res, relative, url.searchParams.get('size'))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  // ------------------------------------------------------------------- helpers
  function recipeCard(recipe, index) {
    const parts = [
      `${index != null ? `${index + 1}. ` : ''}${recipe.name}`,
      `（${recipe.category}${recipe.difficulty ? ` · ${stars(recipe.difficulty)}` : ''}${
        recipe.calories ? ` · ${recipe.calories} 大卡` : ''
      }）`,
    ]
    if (recipe.intro) parts.push(` — ${recipe.intro.slice(0, 70)}`)
    if (recipe.ingredients?.length) {
      parts.push(`\n   食材：${recipe.ingredients.map((i) => i.name).slice(0, 8).join('、')}`)
    }
    return parts.join('')
  }

  function recipeDetail(recipe) {
    const lines = [`# ${recipe.name}（${recipe.category}）`]
    const meta = []
    if (recipe.difficulty) meta.push(`难度 ${stars(recipe.difficulty)}`)
    if (recipe.calories) meta.push(`${recipe.calories} 大卡`)
    meta.push(`${recipe.ingredients?.length || 0} 种原料`)
    lines.push(meta.join(' · '))
    if (recipe.intro) lines.push('', recipe.intro)
    if (recipe.ingredients?.length) {
      lines.push('', '## 原料')
      for (const item of recipe.ingredients) {
        lines.push(`- ${item.name} ${humanAmount(item.name, item.amount)}`)
      }
    }
    if (recipe.steps?.length) {
      lines.push('', '## 步骤')
      recipe.steps.forEach((step, i) => {
        lines.push(`${i + 1}. ${step.text}`)
      })
    }
    if (recipe.tips?.length) {
      lines.push('', '## 附加内容')
      for (const tip of recipe.tips) lines.push(`- ${tip}`)
    }
    return lines.join('\n')
  }

  function tokens(query) {
    return String(query || '')
      .split(/[\s,，、]+/)
      .map((token) => normalize(token))
      .filter(Boolean)
  }

  function matches(recipe, keyword) {
    if (!keyword) return true
    if (normalize(recipe.name).includes(keyword)) return true
    if (normalize(recipe.category).includes(keyword)) return true
    if (recipe.intro && normalize(recipe.intro).includes(keyword)) return true
    const wanted = canonical(keyword)
  return (recipe.ingredients || []).some((item) => {
    const name = canonical(item.name)
    return name.includes(wanted) || wanted.includes(name)
  })
  }

  // Exact ingredient names count fully; "番茄" against "番茄酱" is a partial
  // credit only, so a pantry lookup does not claim a dish is makeable.
  function coverage(recipe, wanted) {
    if (!wanted.length) return 1
    const names = (recipe.ingredients || []).map((item) => canonical(item.name))
    let score = 0
    for (const raw of wanted) {
      const want = canonical(raw)
      if (names.some((name) => name === want)) score += 1
      else if (names.some((name) => name.includes(want) || want.includes(name))) score += 0.5
    }
    return score / wanted.length
  }

  function resolveRecipe(args) {
    const id = String(args?.id || '').trim()
    if (id && byId.has(id)) return byId.get(id)
    const name = String(args?.name || '').trim()
    if (!name) return undefined
    const exact = byNormalizedName.get(normalize(name))
    if (exact) return exact
    const key = normalize(name)
    const candidates = recipes.filter(
      (recipe) => normalize(recipe.name).includes(key) || key.includes(normalize(recipe.name)),
    )
    if (!candidates.length) return undefined
    candidates.sort((a, b) => normalize(a.name).length - normalize(b.name).length)
    return candidates[0]
  }

  const textRender = (_args, value) => [{ type: 'text', text: String(value) }]

  // --------------------------------------------------------------- tool schemas
  const searchTool = {
    name: 'recipe_search',
    description:
      '搜索中文家常菜菜谱（来源 HowToCook，373 道）。可按菜名/食材关键词、分类过滤，也可传入手头已有的食材按匹配度排序。返回菜名、分类、难度、热量与主要原料；要完整做法再用 recipe_get。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词：菜名、食材或做法相关词，如「番茄」「红烧」「面」' },
        category: {
          type: 'string',
          description: '分类过滤：素菜 / 荤菜 / 水产 / 主食 / 汤与粥 / 早餐 / 甜品 / 饮料 / 半成品加工 / 酱料和其它材料',
        },
        ingredients: {
          type: 'array',
          items: { type: 'string' },
          description: '手头已有的食材，如 ["鸡蛋","番茄"]；结果按这些食材的覆盖率排序',
        },
        limit: { type: 'integer', description: '返回条数，1-20，默认 8' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const queryTokens = tokens(args?.query)
      const category = String(args?.category || '').trim()
      const wanted = (args?.ingredients || []).map((item) => normalize(item)).filter(Boolean)
      const limit = Math.max(1, Math.min(20, Number(args?.limit) || 8))

      let pool = recipes
      if (category) {
        pool = pool.filter(
          (recipe) =>
            normalize(recipe.category) === normalize(category) ||
            normalize(recipe.category).includes(normalize(category)),
        )
      }
      if (queryTokens.length) {
        pool = pool.filter((recipe) => queryTokens.every((token) => matches(recipe, token)))
      }
      const scored = pool.map((recipe) => ({
        recipe,
        score: wanted.length ? coverage(recipe, wanted) : 1,
      }))
      if (wanted.length) {
        // Among equally matching dishes prefer the one that needs the fewest
        // extra ingredients: that is the dish you can actually cook right now.
        const size = (entry) => (entry.recipe.ingredients || []).length || 99
        scored.sort(
          (a, b) => b.score - a.score || size(a) - size(b) || (a.recipe.difficulty || 0) - (b.recipe.difficulty || 0),
        )
        const usable = scored.filter((entry) => entry.score > 0)
        if (!usable.length) {
          return `没有找到同时用到这些食材的菜：${wanted.join('、')}。可以改用 recipe_search 的 query 或 category 检索。`
        }
        const picked = usable.slice(0, limit)
        return [
          `按食材匹配度（命中 ${wanted.length} 种中的比例）找到 ${usable.length} 道菜：`,
          '',
          ...picked.map(
            (entry, i) =>
              `${recipeCard(entry.recipe, i)}  · 匹配 ${Math.round(entry.score * 100)}%`,
          ),
          '',
          '要完整做法，用 recipe_get 传菜名。',
        ].join('\n')
      }
      if (!scored.length) {
        return `没有找到匹配的菜。可尝试更短的关键词，或省略分类。现有分类：${(dataset.categories || [])
          .map((c) => c.name)
          .join(' / ')}`
      }
      const picked = scored.slice(0, limit)
      return [
        `找到 ${scored.length} 道${category ? `「${category}」` : ''}菜，显示前 ${picked.length} 道：`,
        '',
        ...picked.map((entry, i) => recipeCard(entry.recipe, i)),
        '',
        '要完整做法，用 recipe_get 传菜名。',
      ].join('\n')
    },
  }

  const getTool = {
    name: 'recipe_get',
    description:
      '取一道菜谱的完整做法：原料清单（含勺量换算）、分步操作与附加提示。传菜名（可模糊）或 id。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '菜名，如「西红柿炒鸡蛋」，可模糊匹配' },
        id: { type: 'string', description: '菜谱 id（即 HowToCook 仓库内 md 路径），与 name 二选一' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const recipe = resolveRecipe(args)
      if (!recipe) {
        const hint = args?.name
          ? `没有「${args.name}」这道菜。先用 recipe_search 找一下相似菜名。`
          : '请提供 name 或 id。'
        return hint
      }
      return `${recipeDetail(recipe)}\n\n（可在侧栏「菜谱盒子」里查看带图版本）`
    },
  }

  const randomTool = {
    name: 'recipe_random',
    description: '随机推荐一道菜（可限定分类），返回完整做法。用于「今天吃什么」「随便来一道」。',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: '限定分类：素菜 / 荤菜 / 水产 / 主食 / 汤与粥 / 早餐 / 甜品 / 饮料 / 半成品加工 / 酱料和其它材料',
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: '要排除的菜名（避免连续推荐同一道）',
        },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const category = String(args?.category || '').trim()
      const excluded = new Set((args?.exclude || []).map((name) => normalize(name)))
      let pool = recipes
      if (category) {
        pool = pool.filter((recipe) => normalize(recipe.category).includes(normalize(category)))
      }
      pool = pool.filter((recipe) => !excluded.has(normalize(recipe.name)))
      if (!pool.length) return '没有符合条件的菜，换个分类试试。'
      const recipe = pool[Math.floor(Math.random() * pool.length)]
      return recipeDetail(recipe)
    },
  }

  const tipsTool = {
    name: 'recipe_tips',
    description: '厨房基础技巧（HowToCook 的 tips 目录）：厨房准备、洗碗、各类烹饪技巧。不传参数返回目录，传 title 返回对应全文。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '技巧标题关键词，如「洗碗」「刀工」' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: textRender },
    async execute(args) {
      const title = String(args?.title || '').trim()
      if (!title) {
        return ['厨房技巧目录：', ...tips.map((tip, i) => `${i + 1}. ${tip.title}`)].join('\n')
      }
      const key = normalize(title)
      const tip =
        tips.find((entry) => normalize(entry.title) === key) ||
        tips.find((entry) => normalize(entry.title).includes(key))
      if (!tip) return `没有找到「${title}」相关的技巧。目录：${tips.map((t) => t.title).join(' / ')}`
      return [`# ${tip.title}`, '', ...(tip.paragraphs || [])].join('\n')
    },
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: handleRoute,
    })
    return () => disposeRoute()
  }, 'recipe-box: web route')

  const disposeTools = [searchTool, getTool, randomTool, tipsTool].map((tool) =>
    ctx.tools.register(tool),
  )
  ctx.effect(
    () => () => {
      for (const dispose of disposeTools) dispose?.()
    },
    'recipe-box: tools',
  )
}
