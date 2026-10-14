# 拆画

by cryozerolabs · [X](https://x.com/cryozerolabs) · [GitHub](https://github.com/cryozerolabs/chaihua)

**把成品图片拆成可编辑的图层，调整画面，提取素材。**

AI 生成的图片、下载的海报，拿到手时往往只有一张 PNG 或 JPG。商品、标题、优惠标签和背景已经合在一起，想移动一个商品、提取一枚贴纸，通常需要重新抠图、修补背景，或者再生成一次。做下一张图时，这些工作还可能重复一遍。

拆画把生图、上传、拆层、编辑和导出放在同一张画布上。输入需求生成图片，或拖入已有图片；由 AI 制定拆层方案并生成图层，再直接移动、缩放和调整层级。编辑后的画面可以导出 PNG 或 PSD，独立素材可以下载为透明 PNG。

```text
输入需求 / 拖入图片 → 自动拆分图层 → 在画布上编辑 → 导出成品或素材
```

## 一张双11海报，拆开后怎么用

以「双11零食囤货节」为例，一张组合海报里包含主标题、优惠贴纸、薯片袋、坚果罐、曲奇盒和背景。拆成图层后，可以调整商品位置和大小，隐藏暂时不需要的优惠信息，也可以提取商品包装，作为单品介绍或下一张促销图的素材。

下面是实际画布截图。演示原图生成后导入画布，图层素材由 Ming Layer 拆分；此例经过追加拆分，整理为六层。

### 原图与图层组

左侧是原图，右侧是图层的合成预览。两者保持相同画幅，文字保留为图片图层。

![双11海报的原图与六层合成预览](docs/screenshots/canvas-overview.jpg)

### 直接编辑商品素材

选中坚果罐后，可在画面中移动或等比缩放。右侧列表同步选中对应图层，并提供层级调整、锁定、显隐和单个素材下载。

![选中坚果罐进行图层编辑，右侧显示图层列表和素材下载入口](docs/screenshots/layer-editing.jpg)

## 怎么使用

1. **获得原图**：在底部输入需求，点击“生成图片”；也可以上传或拖入 PNG、JPG、WebP。画布支持同时放置多张图片，拖入时保留宽高比例。
2. **自动拆层**：选中原图，点击“拆分图层”。系统看图确定图层的数量、名称和内容，用户无需先猜层数。任务完成后，在原图旁边新增图层组。
3. **直接编辑**：点击图层组，在合成预览中选择和拖动素材，拉动四角等比缩放。拖动标题栏移动整个对象；右侧列表可拖动调整层级，上方图层显示在前面。背景默认锁定，可解锁，也可隐藏其他图层。
4. **导出结果**：使用图层组工具栏导出 PNG 或 PSD；使用列表项的下载按钮提取单个素材。原图也有独立的 PNG 下载入口。

编辑支持撤销、重做和自动保存，刷新后恢复项目。选中的原图、图层组可以删除，并通过撤销恢复。生成中的占位会避开已有对象，完成后将图片放入预留位置。

### 选择哪种导出

| 导出方式 | 适合用途 | 保留内容 |
| --- | --- | --- |
| PNG | 使用或分享当前画面 | 按原有画幅合成可见图层，应用当前移动与缩放，保留透明区域 |
| PSD | 在支持 PSD 的工具中继续编辑 | 独立像素图层、名称、位置、叠放顺序、透明像素、隐藏和锁定状态；缩放应用到像素，画布外内容保留 |
| 单个素材 PNG | 提取商品、标题或装饰素材 | 原始素材尺寸与 Alpha，不应用画布中的移动和缩放 |

导出前会等待编辑保存完成；导出失败时显示原因，可以重新导出。

### 画布操作

| 操作 | 鼠标或快捷键 |
| --- | --- |
| 缩放画布 | 滚轮，或左下角的缩放按钮 |
| 平移画布 | 拖动空白处、按住空格拖动，或鼠标中键拖动 |
| 查看全部对象 | 左下角“适合全部内容” |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z；Windows、Linux 使用 Ctrl+Z / Ctrl+Shift+Z |
| 删除选中对象 | Delete / Backspace，或工具栏“删除” |
| 清除选择 | Esc |
| 调整图层顺序 | 拖动列表项或左侧把手；聚焦把手后按 Alt+↑ / Alt+↓ |
| 提交生图需求 / 换行 | Enter / Shift+Enter |

## 当前的拆分能力

拆画适合尝试拆分电商海报、活动宣传图和包含多个独立对象的素材板。视觉模型按画面内容规划图层，商品包装上的印刷、角色的五官等附属细节会要求保留在所属对象内。

实际拆分粒度取决于模型输出。部分对象可能仍合在同一层，背景补全和边缘也可能与原图有差异。文字继续作为图片处理，PSD 导出的是像素图层，不包含可编辑字体、矢量或智能对象，也无法恢复原图的历史 PSD 结构。

## 本地启动

需要 **Node.js 22.12 或更新版本**，以及能够调用配置中模型的 API key。项目可以在本地运行，模型调用的费用和服务可用性由供应商决定。

```sh
git clone https://github.com/cryozerolabs/chaihua.git
cd chaihua
npm install
cp .env.example .env
```

在 `.env` 中填写自己的 `API_KEY`。当前模板使用 ZenMux，配置如下：

```dotenv
MODEL_PROVIDER=zenmux
MODEL_BASE_URL=https://zenmux.ai/api/v1
API_KEY=your_api_key
IMAGE_API_FORMAT=openai
IMAGE_EDIT_ENCODING=multipart
IMAGE_GENERATION_PATH=/images/generations
IMAGE_EDIT_PATH=/images/edits
VISION_API_PATH=/chat/completions
DESIGN_MODEL=inclusionai/ming-image-0.1-design
LAYER_MODEL=inclusionai/ming-image-0.1-design-layer
VISION_MODEL=qwen/qwen3-vl-plus
PORT=3001
```

如果 API key 设置了模型白名单，需要放行 `DESIGN_MODEL`、`LAYER_MODEL` 和 `VISION_MODEL` 对应的三个模型。然后启动：

```sh
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。API 默认运行在 [http://127.0.0.1:3001](http://127.0.0.1:3001)。

### 切换供应商或模型

供应商、API 地址、密钥、模型 ID 和接口路径均通过 `.env` 配置。修改后重启服务；完整模板见 [.env.example](.env.example)。

- `API_KEY` 始终表示当前平台的密钥，变量名不绑定供应商。密钥只在后端读取，`.env` 已被 Git 忽略。
- `MODEL_PROVIDER` 用于日志和错误显示，`MODEL_BASE_URL` 指定实际请求地址。三个模型 ID 从配置读取，代码不设置默认模型。
- OpenAI 兼容的图片协议使用 `IMAGE_API_FORMAT=openai`；图片编辑默认以 `multipart` 上传原图。支持 JSON 引用图的服务可设置 `IMAGE_EDIT_ENCODING=json`。
- OpenRouter 原生图片协议使用 `IMAGE_API_FORMAT=openrouter`，生图和拆层路径设置为 `/images`；模板附有配置示例。

切换到支持相应模型与接口的兼容平台，只需修改配置并重启服务，无需修改源码或重新构建。具体模型是否有可用线路，需要确认供应商的服务状态。

## 模型分工与本地处理

| 环节 | 当前默认配置 | 职责 |
| --- | --- | --- |
| 生图 | `inclusionai/ming-image-0.1-design` | 根据输入需求生成原图 |
| 看图规划 | `qwen/qwen3-vl-plus` | 决定拆层内容、名称、数量与叠放顺序 |
| 拆层 | `inclusionai/ming-image-0.1-design-layer` | 根据原图和方案生成 RGBA 图层 |
| 编辑与导出 | Konva、sharp、ag-psd | 保存图层变换，渲染画布，合成 PNG 和输出 PSD |

视觉模型规划不设固定前景层数上限，Ming Layer 接收明确的层数和每层内容。当返回图片数量与方案不符时，视觉模型会核对实际素材，标注内容并识别额外合成图。模型合并的对象会保留为同一份素材；本地代码仅裁去图层外围的透明空白，保留原始位置，不按透明间隔二次切分对象。

前端使用 React、TypeScript、Vite 和 react-konva；后端使用 Node.js、Express、sharp 和 ag-psd。默认配置下，生图调用 `/images/generations`，拆层调用 `/images/edits`，视觉规划调用 `/chat/completions`。

## 项目保存与任务排错

素材、来源关系、图层编辑和画布视口保存在本地 `.data/`，可通过 `DATA_DIR` 更改目录。生图与拆层会请求配置的模型服务，原图或预览图会发送给相应服务。已有的旧版多尺寸画板仍可编辑和导出。

耗时操作返回任务 ID，前端查询进度和结果。任务面板显示失败原因，支持重试对应步骤；重试沿用原来的拆分方式和描述。

- **401**：检查 API key 是否有效、是否属于配置的平台。
- **403**：检查 key 的调用权限与模型白名单。
- **404 / 没有可用线路**：检查模型 ID，以及供应商是否提供该模型服务。
- **429、502、503、504**：优先按 `Retry-After` 自动重试；没有该字段时按 15 / 30 / 60 / 60 秒间隔，最多重试四次。
- **规划输出被截断、字段错误或其他服务错误**：根据任务提示重试。详细错误记录在 `.data/debug/`。

## 构建与接口

```sh
npm test
npm run build
npm start
```

生产构建后，默认由 [http://127.0.0.1:3001](http://127.0.0.1:3001) 同时提供网页与 API。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 检查服务与模型配置状态，不返回密钥 |
| GET / PUT | `/api/project` | 读取项目或保存编辑 |
| POST | `/api/upload` | 上传原图 |
| POST | `/api/generate` | 提交生图任务 |
| POST | `/api/decompose` | 提交拆层任务 |
| GET | `/api/jobs` | 查询最近任务 |
| GET | `/api/jobs/:id` | 查询任务进度与结果 |
| POST | `/api/jobs/:id/retry` | 重试失败任务 |
| GET | `/api/export/:id?format=<format>` | 导出当前图层合成或 PSD；format 为 png 或 psd，默认 PNG |
| GET | `/api/export/:id/layers/:layerId` | 下载原始尺寸的单个素材 PNG |

原图仅支持 PNG 下载；PSD 导出需要先拆成图层组。
