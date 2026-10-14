# 拆画

by cryozerolabs · [X](https://x.com/cryozerolabs) · [GitHub](https://github.com/cryozerolabs/chaihua)

输入需求生成图片，或拖入已有图片；拆分后直接编辑图层组，导出 PNG、PSD 或独立素材。支持多张图片、平移、缩放、撤销和重做。

## 界面预览

以下是「双11零食囤货节」案例的实际画布截图。原图由内置生图工具生成后导入，图层素材由 Ming Layer 拆分。此例经过追加拆分，整理为主标题、优惠贴纸、薄荷绿坚果罐、奶油白曲奇盒、黄色薯片袋和背景六层。

### 原图与图层组对照

左侧为原图，右侧为六个像素图层的合成预览。两者保持相同画幅，文字保留为图片图层。

![双11海报的原图与六层合成预览](docs/screenshots/canvas-overview.jpg)

### 独立编辑商品图层

选中坚果罐后，画布显示该素材的移动与缩放边框，右侧列表同步选中。图层列表提供层级拖动、锁定、显隐和单层素材下载；图层组工具栏提供 PNG、PSD 导出。

![选中坚果罐进行图层编辑，右侧显示图层列表和素材下载入口](docs/screenshots/layer-editing.jpg)

## 启动

需要 Node.js 22.12 或更新版本。

```sh
npm install
cp .env.example .env
```

在 `.env` 中填写自己的 `API_KEY`，然后启动：

```sh
npm run dev
```

打开 http://127.0.0.1:5173 。API 默认运行在 http://127.0.0.1:3001 。供应商、API 地址、密钥和三个模型 ID 都在项目根目录 `.env` 中配置：

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
```

密钥只在后端读取。模型 ID 不再在代码中设置默认值。修改配置后重启服务；完整模板见 `.env.example`。缺失配置时会给出具体错误。如果平台为 API key 设置了模型白名单，需要放行配置中的三个模型；未放行时会显示 403 权限错误。

`API_KEY` 始终是当前平台的密钥，变量名不绑定供应商。`MODEL_PROVIDER` 用于日志和错误显示，可填写其他平台名称。OpenAI 兼容的生图协议使用 `IMAGE_API_FORMAT=openai`，OpenRouter 原生 Image API 使用 `openrouter`。接口路径也可在 `.env` 覆盖；切换这些兼容平台只需修改配置并重启服务，无需修改源码或重新构建。OpenAI 图片编辑默认以 `multipart` 上传原图；支持 JSON 引用图的服务可设置 `IMAGE_EDIT_ENCODING=json`。

## 编辑和导出

1. 输入需求点击“生成图片”，或拖入 PNG/JPG/WebP，也可以点击“上传图片”。
2. 点击原图的“拆分图层”直接提交任务，无需弹窗或填写层数。后台由 `.env` 中的视觉模型（默认 Qwen3-VL-Plus）看图，确定独立图层的数量、名称和内容，再交给 Ming Layer 拆分。历史按描述拆分任务仍可按原要求重试。
3. 点击图层组或直接拖动其中的素材即可编辑；拉动四角等比缩放。拖动标题栏移动整个对象。
4. 右侧图层列表查看素材，支持选择、隐藏、锁定和解锁图层。拖动列表项或左侧把手调整层级，上方图层显示在前面；也可聚焦把手后按 Alt+↑/↓ 调整。层级改动支持撤销、重做和刷新恢复，并同步用于 PNG、PSD 导出。背景默认锁定，文字保持图片图层。
5. “导出 PNG”合成当前可见图层，保持图层组原有画幅和透明区域；“导出 PSD”保留独立像素图层、名称、透明度、位置、顺序、隐藏和锁定状态，缩放应用到图层像素，画布外内容保留。
6. 图层列表每项的下载按钮导出原始尺寸的素材 PNG，不应用当前移动或缩放。

滚轮缩放；拖动空白处、按住空格或使用鼠标中键平移。⌘Z / Ctrl+Z 撤销，⇧⌘Z / Ctrl+Shift+Z 重做，Esc 清除选择。左下角可放大、缩小或适合全部内容。

生成占位自动避开已有卡片和正在生成的任务，并预留成品位置。选中原图、图层组或旧画板后，可点击“删除”或按 Delete / Backspace；支持撤销恢复，原始素材文件保留。

素材、来源关系、图层编辑与视口保存在 `.data/`，刷新后恢复。旧版多尺寸画板保留，并支持同样的编辑与导出；历史重排任务保留在存储中，界面不再展示或执行它们。

任务面板展示生成、拆层进度及失败重试，重试会沿用原来的拆分方式和描述。上游限流时按 `Retry-After` 或 15 / 30 / 60 / 60 秒间隔自动重试。错误详情保存在 `.data/debug/`。

## 模型与本地处理

- `inclusionai/ming-image-0.1-design`：根据用户需求生成图片。
- `inclusionai/ming-image-0.1-design-layer`：原图拆解为 RGBA 图层。
- `qwen/qwen3-vl-plus`：看图制定拆层方案；返回数量与方案不符时核对实际素材。
- Konva、sharp、ag-psd：图层编辑、合成、素材 PNG 与 PSD 输出。

ZenMux 生图使用 `POST /images/generations`；带参考图的拆层使用 `POST /images/edits`，以 `multipart/form-data` 的 `image` 文件字段上传原图；VL 使用 `POST /chat/completions`。实测 Ming Layer 的 JSON 引用图方式返回 500，文件上传方式可返回多张图层。OpenRouter 保留独立适配，使用其 `/images` 与 `input_references` 格式。不传显式尺寸参数，拆层完成后沿用原图画幅。

VL 规划不设固定前景层数上限，Ming Layer 接收明确的层数和每层内容。素材板按独立对象规划，附属细节保留在所属对象内。返回数量不符时，VL 逐张标注实际素材，识别额外合成图，不按数量猜测该丢弃哪张图片。背景默认锁定。

没有透明间隔二次切分或针对某张图片的切分规则。模型实际合并的对象会保留为同一个素材；本地代码只裁去图层外围的透明空白，并保留原始位置。VL 输出被截断或字段不正确时给出具体原因；上游限流或暂时不可用时自动重试，不强制使用固定供应商。

## 检查与接口

```sh
npm test
npm run build
npm start
```

生产构建后，http://127.0.0.1:3001 同时提供网页与 API。

上传：`POST /api/upload`。生图、拆层：`POST /api/generate`、`POST /api/decompose`，返回任务 ID。查询、重试：`GET /api/jobs/:id`、`POST /api/jobs/:id/retry`。项目读写：`GET/PUT /api/project`。

组合导出：`GET /api/export/:id?format=png|psd`，省略格式默认为 PNG。单个素材：`GET /api/export/:id/layers/:layerId`。原图只提供 PNG；缺失对象、无效格式和导出失败返回明确错误。
