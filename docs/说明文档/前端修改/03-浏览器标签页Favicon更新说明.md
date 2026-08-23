# 浏览器标签页 Favicon 更新说明文档

## 1. 更新背景

用户反馈浏览器标签页显示的仍然是小鲸鱼图标，需要将其替换为小菠萝图标，以保持品牌一致性。

## 2. 更新目标

将浏览器标签页（Tab）上的 favicon 从 DeepSeek 小鲸鱼图标替换为 SmartBoBo 小菠萝图标。

## 3. 修改内容

### 3.1 Favicon 文件

**文件位置**: `BoBo/dsh/apps/web/public/favicon.svg`

**修改内容**：已将 favicon.svg 替换为小菠萝轮廓图标：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <style>
    @media (prefers-color-scheme: dark) {
      svg { stroke: #fff; }
    }
  </style>
  <!-- Pineapple leaves (crown) -->
  <path d="M25 22 Q24 12 22 5 Q21.5 1 20 3" stroke-width="2.8" />
  <path d="M25 22 Q27 10 31 4 Q33 1 31 4" stroke-width="2.8" />
  <path d="M25 22 Q18 15 11 9 Q9 7 10 10" stroke-width="2.5" />
  <path d="M25 22 Q32 15 39 9 Q41 7 40 10" stroke-width="2.5" />
  <path d="M25 22 Q17 17 9 13" stroke-width="2.2" />
  <path d="M25 22 Q33 17 41 13" stroke-width="2.2" />
  <!-- Pineapple body -->
  <path d="M25 24 Q8 24 7.5 37 Q7.2 44 17 48 Q22.5 50 25 50 Q27.5 50 33 48 Q42.8 44 42.5 37 Q42 24 25 24 Z" stroke-width="3.5" fill="none" />
  <!-- Cross-hatch grid lines -->
  <path d="M17.5 29 L12.5 49" stroke-width="1.2" fill="none" />
  <path d="M25 27 L25 50" stroke-width="1.2" fill="none" />
  <path d="M32.5 29 L37.5 49" stroke-width="1.2" fill="none" />
  <path d="M8 32 L42 32" stroke-width="1.2" fill="none" />
  <path d="M7.5 39 L42.5 39" stroke-width="1.2" fill="none" />
  <path d="M8.5 46 L41.5 46" stroke-width="1.2" fill="none" />
</svg>
```

### 3.2 HTML 引用

**文件位置**: `BoBo/dsh/apps/web/index.html`

**引用方式**：
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

### 3.3 PWA 清单

**文件位置**: `BoBo/dsh/apps/web/public/manifest.webmanifest`

**配置内容**：
```json
{
  "icons": [
    {
      "src": "/favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

## 4. 图标特性

### 4.1 设计特点

- **轮廓风格**：仅使用描边（stroke），不填充背景
- **主题兼容**：支持深色/浅色主题自动切换
- **currentColor**：使用当前颜色，与页面主题保持一致

### 4.2 主题适配

```css
@media (prefers-color-scheme: dark) {
  svg { stroke: #fff; }
}
```

- 浅色模式：黑色轮廓
- 深色模式：白色轮廓

## 5. 问题排查

### 5.1 浏览器缓存问题

如果浏览器仍然显示旧图标，可能是缓存问题。解决方法：

1. **硬刷新页面**：
   - Windows/Linux: `Ctrl + Shift + R` 或 `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **清除浏览器缓存**：
   - Chrome: 设置 → 隐私和安全 → 清除浏览数据
   - Firefox: 选项 → 隐私与安全 → 清除数据
   - Edge: 设置 → 隐私、搜索和服务 → 清除浏览数据

3. **开发者工具禁用缓存**：
   - 打开开发者工具（F12）
   - 在 Network 面板勾选 "Disable cache"
   - 刷新页面

### 5.2 构建问题

如果图标未更新，可能需要重新构建前端：

```bash
cd E:/SmartBoBo/BoBo/dsh
pnpm run build:lib:host
```

然后重启服务：

```bash
pnpm bobo
```

## 6. 验证方法

### 6.1 直接访问验证

在浏览器中直接访问 favicon 文件：
```
http://127.0.0.1:7070/favicon.svg
```

应该看到小菠萝图标。

### 6.2 标签页验证

1. 打开 SmartBoBo 网页端
2. 查看浏览器标签页
3. 确认显示小菠萝图标

### 6.3 PWA 验证

如果安装了 PWA 应用：
1. 查看应用图标
2. 确认显示小菠萝图标

## 7. 相关文件

- `BoBo/dsh/apps/web/public/favicon.svg` - Favicon 图标文件
- `BoBo/dsh/apps/web/index.html` - HTML 引用
- `BoBo/dsh/apps/web/public/manifest.webmanifest` - PWA 清单配置

## 8. 后续优化建议

### 8.1 多尺寸支持

如果需要支持更多尺寸，可以添加：
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png`

### 8.2 ICO 格式支持

对于不支持 SVG 的旧浏览器，可以添加 ICO 格式：
```html
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

### 8.3 品牌一致性

确保所有品牌触点使用统一的小菠萝图标：
- 浏览器标签页 favicon
- PWA 应用图标
- 书签图标
- 历史记录图标