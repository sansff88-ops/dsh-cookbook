# 菜谱盒子 · dsh-cookbook

给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 加一个菜谱库：**373 道家常菜谱**，以中式家常为主，也收了西式、日韩菜式（如牛排、意面、披萨饼皮、咖喱、司康、提拉米苏、韩式拌饭）。菜单、步骤、用料与 346 张步骤图全部**随插件分发**，不热链、不联网也能用。

## 功能

- **浏览**：按 10 个分类（素菜 65 / 荤菜 111 / 水产 28 / 主食 59 / 汤与粥 24 / 早餐 25 / 甜品 19 / 饮料 23 / 半成品加工 10 / 酱料与其它 9）翻看，卡片带难度与热量。
- **搜索**：菜名、食材、口味关键词都能搜。
- **按食材找**：填手头有的几样东西，按匹配度排序推荐「能做什么」。
- **每日推荐**：随机一道，不想选的时候直接照做。
- **收藏 / 做过**：标记做过哪道、收藏想做的，存在浏览器本地。
- **详情页**：原料（含勺/杯换算）、分步操作、附加提示、原图。
- **聊天里的 `recipe_*` 工具**：`recipe_search`、`recipe_get`、`recipe_random`、`recipe_tips`，让 agent 直接查菜谱。
- **厨房技巧**：来自 HowToCook 的 tips 目录，翻到「厨房技巧」页签。

## 安装

```bash
dsh plugin --profile web add dsh-cookbook
# 或直接从 GitHub
dsh plugin --profile web add github:YOUR-GITHUB-NAME/dsh-cookbook
```

装完重启 `dsh web`，侧栏会出现「菜谱盒子」入口。

## 数据来源与许可

- 菜谱数据取自开源项目 [Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook)，其内容以 **Unlicense** 进入公有领域。
- 本插件对数据做了清洗、单位修正、勺量换算、排版与搜索增强，并把 346 张图片重新编码为 640px / 1200px 两档 WebP（约 30 MB）。
- 代码以 **MIT** 许可发布；数据部分的来源与改动说明见 [NOTICE.md](NOTICE.md)。

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

## 致谢

数据来自 [HowToCook](https://github.com/Anduin2017/HowToCook) 及其贡献者。本项目与其无隶属关系，也不代表其背书。
