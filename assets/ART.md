# 营地场景素材

使用 OpenAI 内置 imagegen 工具生成，2026-09-22。未使用 frontend-skill。

- 原始生成文件：`/Users/lcc/.codex/generated_images/01a0c7eb-5db5-7220-bd25-10574c8230a6/exec-f9de9b4c-83bc-422e-823d-86367247faaf.png`
- 项目素材：`assets/camp.png`
- 离线内嵌版本：`assets/camp-art.js`，注入 `window.Scrap.campArt`。
- 已通过 view_image 检查：场景完整，设施可辨，无文字、按钮或网页边框。

## 主要设施坐标

坐标为图片左上角起算的归一化中心点（x, y），可用作热点与导航参考：

| 设施 | 中心坐标 | 大致可点击范围 x/y |
|---|---|---|
| 通讯灯塔 | (0.128, 0.226) | x 0.086–0.170，y 0.035–0.417 |
| 武器工作间 | (0.468, 0.320) | x 0.289–0.632，y 0.165–0.475 |
| 医疗站 | (0.147, 0.520) | x 0.055–0.246，y 0.410–0.624 |
| 资源仓库 | (0.832, 0.476) | x 0.689–0.978，y 0.305–0.657 |
| 营火/拾荒者 | (0.455, 0.710) | x 0.396–0.525，y 0.641–0.787 |
| 小无人机 | (0.404, 0.606) | x 0.388–0.421，y 0.579–0.643 |

## 生成提示词

```text
Use case: stylized-concept
Asset type: production background scene for a playable 2D survival scavenging game's camp hub, 16:9 widescreen.
Primary request: a beautiful richly detailed 32-bit pixel art camp named conceptually The Last Recycling Station (do not render any words), inhabited and warm amidst a ruined post-apocalyptic world. It must feel like an actual premium indie survival video game scene, not an illustration banner or a webpage.
Scene/backdrop: deep teal blue night with distant ruined city silhouettes. A small fenced recycling compound viewed from a lightly isometric overhead camera. Worn concrete paths, weeds, reclaimed metal walls, old engine and scrap piles, cables, tiny steam vents and storage crates make a coherent inhabited place.
Composition: complete scene fills the entire frame. On the upper left, a tall repairable communication beacon mast with a visible amber signal light. Upper center a large main workshop with its front open showing a bright weapon workbench, tools, pegboard and machines. On the mid-left, a small medical shed with a glowing cross sign and cot visible. On the right, a large resource warehouse beside a scrap lifting crane. Lower center, a small glowing campfire with a lone scavenger wearing a yellow raincoat and mechanical backpack seated nearby, and a small hovering utility drone. The workshop, medical shed, warehouse, and communication beacon are individually clear and spatially separated, easily recognizable as game interaction destinations. Keep the bottommost 12 percent slightly simpler dirt and concrete ground for a future external game control overlay but no large blank space.
Style: exceptionally polished 32-bit pixel art, discrete pixel clusters, crisp deliberate silhouettes, carefully controlled textures, detailed hand crafted environment, coherent scale, strong depth from occlusion and pools of light. Slight top-down isometric perspective, not a flat side view.
Lighting/mood: moody dark blue teal ambient nighttime with warm amber workshop windows and campfire. Cozy refuge in dangerous ruins. Good legibility of buildings, not excessively dark.
Constraints: no letters, no text, no numbers, no logo, no watermark, no borders, no UI elements, no buttons, no webpage, no cards, no blank white margins. Scene only. Landscape 16:9.
```

