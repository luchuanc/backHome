# UI 美术生成记录

生成方式：内置 `image_gen.imagegen`，未使用 CLI、Python 绘图、抠图或后期重绘。源 PNG 原样复制到本目录；代码按图集格子裁切，保留原 alpha。

## 已验证素材

| 文件 | 源尺寸 | 透明 | 格式与观测 |
|---|---|---|---|
| `tech.png` | 1254 × 1254 | 是 | 4 × 4；按下方提示逐行排列，实际图标约占单格 85–95%，比提示的 65% 更满。全格裁切，勿进一步裁边。 |
| `interface.png` | 1254 × 1254 | 是 | 4 × 4；所有符号顺序正确，非线框网站图标。 |
| `evolutions.png` | 1254 × 1254 | 否 | 2 × 2；左上金属风暴、右上雷暴核心、左下碎冰连爆、右下引力绞盘。 |
| `panel.png` | 1254 × 1254 | 否 | 窄直角金属框、铆钉、黄铜角板、平整深青中心。实际框边约 60 px、角板延伸到 72 px；建议九宫格 `border-image-slice: 72 fill`，显示边宽由布局决定。 |

提示中的 1024 是期望值，生成器实际返回 1254。消费者必须根据 `naturalWidth / 4` 或 `/ 2` 求源格宽，不可硬编码 256。4 × 4 格宽为 313.5，2 × 2 格宽为 627。

## 原始生成文件

- tech: `/Users/lcc/.codex/generated_images/01a0c818-a50e-73f3-9ca5-fa2025ac94d9/exec-85ede176-5bc7-40ac-922d-12b9d9948cf3.png`
- interface: `/Users/lcc/.codex/generated_images/01a0c818-a50e-73f3-9ca5-fa2025ac94d9/exec-0fa24a36-f759-4fbf-a0f2-04530d9de86c.png`
- evolutions: `/Users/lcc/.codex/generated_images/01a0c818-a50e-73f3-9ca5-fa2025ac94d9/exec-60df9b0d-d7af-4a66-8768-da241191ff00.png`
- panel: `/Users/lcc/.codex/generated_images/01a0c818-a50e-73f3-9ca5-fa2025ac94d9/exec-5843ba8d-c4d4-4d81-8920-33f571b943b7.png`

首次 panel 调用长时间无输出，确认生成目录不存在对应结果后终止等待，仅补生成该缺失项；三张已完成图集没有重做。

`ui-art.js` 包含四张完整 PNG 的 base64 数据，字段为 `window.Scrap.uiArt.tech`、`interface`、`panel`、`evolutions`，用于源码版及单文件离线版。所有最终文件均已用 `view_image` 看图；尺寸与 alpha 由 `sips` 检查，内嵌脚本已通过 `node --check`。

## 完整提示词

### tech

```text
Use case: stylized-concept.
Asset type: production video-game transparent sprite atlas for a gritty post-apocalyptic scavenging game, NOT a UI screenshot.
Generate exactly one square 1024x1024 image with a truly transparent alpha background. Divide conceptually into a STRICT 4 columns x 4 rows equal-cell grid, each cell 256x256; do NOT draw any grid lines or cell backgrounds. Exactly 16 isolated hand-painted game item icons, each centered in its equal cell and fitting within the central 65 percent of that cell, no cropping, generous identical transparent padding. No labels, letters, numbers, text, frames, badges, panels or watermarks.
ROW 1 LEFT TO RIGHT: a tungsten bullet punching through an armor plate (damage); an orange glowing mechanical overclock trigger assembly (haste); chunky yellow hydraulic speed boots (speed); heavy composite green body armor vest (hull).
ROW 2 LEFT TO RIGHT: a powerful electromagnetic copper coil with cyan field (magnet); one long sharp armor-piercing dart (pierce); an orange fragmentation grenade with three distinct fragments (ricochet); a blue electrical capacitor throwing short cyan arcs (chain).
ROW 3 LEFT TO RIGHT: a small orbital satellite carrying a circular saw blade (orbit); a steel wrench dismantling rusty gears (salvage); a green repair nanobot cluster around a tiny damaged metal plate (regen); a crimson targeting optic scope lens (crit).
ROW 4 LEFT TO RIGHT: a compact jet thruster ejecting amber flame (dash); an icy cyan cryogenic vial with frost crystals (freeze); a high-voltage electrical pulse battery (capacitor); a crimson salvage energy siphon with red fluid glowing inside (leech).
Style: high quality hand-painted 2D game inventory art, chunky industrial silhouettes, subtle three-quarter perspective, worn metal, teal deep shadows, amber brass edges, cyan or green luminous rare materials, strong readable small-scale contrast, compact controlled glow that does not spill outside the icon. All sixteen icons equally polished and visually cohesive. Truly transparent empty space, not a checkerboard illustration, no floor, no display stand.
```

### interface

```text
Use case: stylized-concept.
Asset type: production transparent video-game functional icon atlas for a gritty post-apocalyptic scavenging game, NOT website iconography and NOT an interface screenshot.
Exactly one square 1024x1024 PNG image with a genuinely transparent alpha background. Strict exactly 4 columns x 4 rows equal-cell arrangement (each cell 256x256). Each icon centered precisely in its own equal cell occupying only the central 65 percent; equal transparent gaps. No actual grid lines, no backplates, no circles, no text, no letters, no numbers, no watermark, no UI mockup.
ROW 1 LEFT TO RIGHT: a small shelter house built of salvaged industrial metal; a thick weathered brass settings cog; a chunky physical loudspeaker with two small sound waves; a similar speaker with one clear diagonal metal slash for mute.
ROW 2 LEFT TO RIGHT: two parallel chunky metal bars making the pause symbol; a folded illustrated wasteland paper map with tiny route marks but NO lettering; a weathered leather journal book with metal clasp; a heavy brass padlock.
ROW 3 LEFT TO RIGHT: a thick amber metal arrow pointing RIGHT; a clear metal X for close; a green enamel industrial checkmark; a cyan metal download arrow pointing down into a shallow industrial tray.
ROW 4 LEFT TO RIGHT: a tall small signal antenna beacon with amber lamp; a workbench and substantial wrench for workshop; a wooden reinforced warehouse supply crate; a green glowing three-dimensional medical cross made of painted industrial metal.
Style: cohesive high-end hand-painted 2D industrial game icons; teal shadows, weathered brass, amber edge lights, pale cyan and green luminous accents. Tangible detailed objects and bold readable silhouettes with depth, not flat vector symbols, not website thin line icons. Controlled highlights and minimal tight contact shadow within each icon. Preserve genuinely transparent empty space; do not render a checkerboard, floor or stand.
```

### panel

```text
Use case: stylized-concept.
Asset type: production game HUD inventory panel texture, a single nine-slice source image, NOT a UI mockup and NOT a webpage.
Create one exact square 1024x1024 texture of a rugged industrial inventory panel viewed straight-on orthographically. It fills the canvas. Perfectly square corners and straight uniform edges. The outer frame is ONLY 40 pixels wide on every side, constructed of worn dark teal steel and restrained warm brass corner plates with small rivets and minor scratches. All four sides must have identical frame width, with a narrow warm amber inner rim. Strong tactile high-end hand-painted game interface craftsmanship.
The remaining central 944x944 area must be entirely uninterrupted, FLAT dark nearly-black blue-green leather or fine painted metal, with only very subtle low-contrast grain suitable behind small readable text. Center has no objects, no embossing, no ornaments, no bright patches, no heavy gradients. Border details and rivets stay entirely within 40 pixels from edges to permit CSS border-image nine-slicing.
Colors: near-black teal interior, worn dark steel border, sparing aged bronze and amber lighting. Subtle depth via beveled edges only. Entire image opaque. No text, letters, numbers, icons, buttons, labels, slots, diagrams, content, character, scene, watermark, rounded corners or website-style cards.
```

### evolutions

```text
Use case: stylized-concept.
Asset type: four evolution illustrations in a production sprite atlas for a gritty post-apocalyptic top-down action roguelike game. This is painted game art, NOT a website UI or screenshot.
Exactly one square 1024x1024 image, precisely 2 columns x 2 rows equal square cells, each cell 512x512. Four separate opaque square illustrations each with a dark nearly-black teal background, no gutters, no frame, no text, no letters, no numbers, no badges, no watermark. Keep the main object within each cell's central 75 percent and all energy effects within that cell. Each illustration has strong depth, a bold readable silhouette, crisp hand-painted metal details, atmospheric action energy and restrained gritty industrial texture.
TOP LEFT: METAL STORM. A savage multi-barrel salvaged industrial machine gun angled dynamically in three-quarter view, weathered teal steel and brass, erupts with a sweeping golden bullet barrage and fiery amber muzzle flashes, powerful golden kinetic energy.
TOP RIGHT: THUNDER CORE. A bulky industrial electromagnet coil core made of copper and dark teal steel, releasing brilliant cyan branching chain lightning arcs around it, an intensely bright cyan energy heart.
BOTTOM LEFT: SHATTERFROST DETONATION. A cryogenic mechanical core splitting apart into sharp brilliant icy blue crystals and a circular explosive ice shock wave, frosted metal, energetic explosion, cold white-cyan light.
BOTTOM RIGHT: GRAVITY WINCH. An ominous violet gravitational vortex centered in a salvaged industrial mechanical winch, multiple sharp circular saw blades orbit the swirling purple singularity, violet energy trails and worn steel depth.
All four cells painted as a cohesive polished game evolution illustration set. Ensure strict cell alignment and independent compositions with no crossing between quadrants. No photos, no flat vector symbols, no interface elements.
```
