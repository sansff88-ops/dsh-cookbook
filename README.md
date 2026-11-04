# 菜谱盒子 · dsh-cookbook

给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 加一个菜谱库：**373 道家常菜谱**，以中式家常为主，也收了西式、日韩菜式（如牛排、意面、披萨饼皮、咖喱、司康、提拉米苏、韩式拌饭）。菜单、步骤、用料与 346 张步骤图全部**随插件分发**，不热链、不联网也能用。

> **数据来源（上游项目）**
> 本插件的全部菜谱文字与图片来自 GitHub 上的开源项目
> **[Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook)**（<https://github.com/Anduin2017/HowToCook>），
> 该项目以 **Unlicense** 释出、进入公有领域。
> 本仓库是它的**衍生作品**：只做抓取、清洗、单位修正、重排与打包，不改写菜谱内容；与上游作者无隶属关系，也不代表其背书。

## 功能

- **浏览**：按 10 个分类（素菜 65 / 荤菜 111 / 水产 28 / 主食 59 / 汤与粥 24 / 早餐 25 / 甜品 19 / 饮料 23 / 半成品加工 10 / 酱料与其它 9）翻看，卡片带难度与热量。
- **搜索**：菜名、食材、口味关键词都能搜。
- **按食材找**：填手头有的几样东西，按匹配度排序推荐「能做什么」。
- **每日推荐**：随机一道，不想选的时候直接照做。
- **收藏 / 做过**：标记做过哪道、收藏想做的，存在浏览器本地。
- **详情页**：原料（含勺/杯换算）、分步操作、附加提示、原图。
- **聊天里的 `recipe_*` 工具**：`recipe_search`、`recipe_get`、`recipe_random`、`recipe_tips`，让 agent 直接查菜谱。
- **厨房技巧**：来自 HowToCook 的 tips 目录，翻到「厨房技巧」页签。

## 数据是怎么来的

| 项目 | 说明 |
|---|---|
| 上游仓库 | [Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook)（GitHub） |
| 上游许可证 | **Unlicense**（公有领域；上游 `LICENSE` 原文） |
| 快照方式 | 构建时从 `raw.githubusercontent.com` 抓取上游 `dishes/` 与 `tips/` 目录 |
| 收录范围 | 373 道菜 + 厨房技巧，按上游目录结构归为 10 个分类 |
| 每条记录的溯源 | 保留上游 markdown 路径（`id`、`path`）与 GitHub 原文链接（`url`，形如 `https://github.com/Anduin2017/HowToCook/blob/master/dishes/...`），373 条记录全部带 `url` |
| 图片 | 346 张上游菜品图重新编码为 WebP 两档：`data/images/`（640px，q72，列表与卡片，共 350 个文件）、`data/images-hd/`（1200px，q70，详情页，共 347 个）；103 MB 原图压到约 30 MB。另含 1 张上游外链图（清炒土豆，单独下载打包，1 张外链图上游已 404 故丢弃）与 3 张厨房技巧的勺量对照图（仅 640px） |
| 我们做的改动 | 数据清洗、单位修正、勺/杯量换算、按分类重排、搜索与「按食材找」索引；**未改写任何菜谱正文** |
| 构建脚本 | 独立脚本，未随本仓库分发；数据产物 `data/recipes.json` 与图片已直接提交 |

完整的来源与改动说明见 [NOTICE.md](NOTICE.md)。

## 安装

```bash
dsh plugin --profile web add dsh-cookbook
# 或直接从 GitHub
dsh plugin --profile web add github:YOUR-GITHUB-NAME/dsh-cookbook
```

装完重启 `dsh web`，侧栏会出现「菜谱盒子」入口。

## 开发

```bash
git clone https://github.com/YOUR-GITHUB-NAME/dsh-cookbook
cd dsh-cookbook
dsh plugin --profile web add link:$(pwd)
```

- `index.js`：host 半边——`/recipe-box` 路由（数据集、图片代理）与 `recipe_*` 工具。
- `client.js`：浏览器半边——侧栏入口与菜谱面板。
- `cordis.patch.yml`：bundle patch，往 web profile 名册里插一行。
- `data/recipes.json` + `data/images*`：打包好的数据集。

## 结构

```
index.js            host: route + tools
client.js           web: sidebar panel
cordis.patch.yml    bundle patch
locale/{zh,en}.json UI 文案
data/recipes.json   373 道菜（含用料、步骤、提示）
data/images/        640px WebP（列表与卡片）
data/images-hd/     1200px WebP（详情页）
```

## 许可

- **代码**：MIT，见 [LICENSE](LICENSE)。
- **菜谱数据与图片**：来自 [Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook)，**Unlicense**（公有领域），派生与再分发均无附加条件；来源说明见 [NOTICE.md](NOTICE.md)。

## 致谢

全部菜谱内容与图片由 [HowToCook](https://github.com/Anduin2017/HowToCook) 项目及其贡献者创作。本项目仅做整理与呈现，与上游无隶属关系，也不代表其背书；上游项目名称与 Logo 未用作本项目品牌。
