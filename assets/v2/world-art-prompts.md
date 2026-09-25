# 世界战斗图集生成提示

这两张图集由内置 imagegen 分别生成，再以原始 RGBA PNG 保留透明通道。每张图为 4×4 严格等格布局；renderer 按 `naturalWidth / 4` 与 `naturalHeight / 4` 动态裁切，不能把实际输出尺寸写死。

## `combat.png`

```text
Transparent 4x4 sprite atlas, strict equal cells, every object centered inside its own cell with at least 20 percent transparent margin. Fine hand-painted industrial pixel art, top-down or very slight top-down view matching a dark teal-gray post-apocalyptic salvage game, crisp readable silhouettes, warm yellow friendly accents and coral-red enemy accents, no UI, no labels, no border, no shared shadow crossing cell boundaries. Row 1: yellow-coat salvage player facing up with helmet backpack and rivet gun; red mechanical crawler beetle; red runner robot hound; purple spitter turret robot. Row 2: large crimson armored brute; massive red warden boss; teal companion drone; yellow rivet gun. Row 3: shotgun; teal arc emitter; circular saw launcher; scrap metal pickup. Row 4: circuit board pickup; cyan energy core pickup; purple XP crystal; green medkit pickup. Keep all sprites fully inside their own cell and preserve transparent alpha around transparent objects. Square 4x4 atlas, no background, no text.
```

## `environment.png`

```text
Transparent 4x4 sprite atlas, strict equal cells, hand-painted industrial pixel art in a dark teal-gray post-apocalyptic salvage game, slight top-down view, crisp pixel edges, no UI, no labels, no border, each object centered with at least 20 percent transparent margin and no large black backdrop. Row 1: wide warehouse roof; tall warehouse roof; wrecked car; rusty barrel. Row 2: scrap pile; wooden supply crate; gold rare supply case; medical chest with a readable green cross. Row 3: offline relay tower; active cyan relay tower; extraction platform; street lamp. Row 4: cracked asphalt tile filling the entire square and opaque; paved-road tile filling the entire square and opaque; grass rubble decal; metal floor tile filling the entire square and opaque. Transparent objects keep alpha; only the four floor tiles are fully opaque. Exact 4x4 grid.
```

