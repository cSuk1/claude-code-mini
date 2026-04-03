# list_files vs GlobTool 对比分析

## 当前实现 (list_files)

```typescript
// src/tools/executors.ts:181-197
async function listFiles(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  try {
    const files = await glob(input.pattern, {
      cwd: input.path || process.cwd(),
      nodir: true,
      ignore: ["node_modules/**", ".git/**"],
    });
    if (files.length === 0) return "No files found matching the pattern.";
    return files.slice(0, MAX_FILE_LIST_RESULTS).join("\n") +
      (files.length > MAX_FILE_LIST_RESULTS ? `\n... and ${files.length - MAX_FILE_LIST_RESULTS} more` : "");
  } catch (e: any) {
    return `Error listing files: ${e.message}`;
  }
}
```

**底层依赖：** `glob` (Node.js 包)

---

## GlobTool 实现 (Claude Code 官方)

```typescript
// 使用 ripgrep --files
const args = [
  '--files',              // 列出文件
  '--glob', searchPattern,  // 按模式过滤
  '--sort=modified',      // 按修改时间排序 ⭐
  '--no-ignore',          // 不尊重 .gitignore
  '--hidden',             // 包含隐藏文件
];

const allPaths = await ripGrep(args, searchDir, abortSignal);
```

**底层依赖：** `ripgrep` (复用 GrepTool 基础设施)

---

## 关键差异对比

| 特性 | list_files (当前) | GlobTool (官方) |
|------|------------------|----------------|
| **底层实现** | Node.js `glob` 包 | ripgrep `--files` |
| **性能** | 中等 | 快 2-3x ⚡ |
| **排序** | ❌ 无排序 | ✅ 按修改时间 ⭐ |
| **中断支持** | ❌ 无 | ✅ AbortSignal |
| **隐藏文件** | ❌ 默认排除 | ✅ 可配置包含 |
| **Gitignore** | ✅ 默认排除 | ⚙️ 可配置 |
| **结果限制** | 200 文件 | 100 文件 |
| **代码复用** | 独立实现 | 复用 ripgrep ⭐ |
| **依赖** | 需 `glob` 包 | 需 `ripgrep` |

---

## 性能对比（预估）

```bash
# 大型项目 (50k 文件)
Node glob:    ~1.2s
ripgrep:      ~0.4s  (3x 快)

# 小型项目 (1k 文件) 
Node glob:    ~0.1s
ripgrep:      ~0.05s (2x 快)
```

**ripgrep 更快的原因：**
1. Rust 并行实现
2. 更高效的文件系统遍历
3. 复用 GrepTool 的基础设施

---

## 设计哲学差异

### **list_files: 简单实用**
```typescript
// ✅ 优点：无外部依赖
// ✅ 优点：Node.js 原生支持
// ⚠️ 缺点：性能中等
// ⚠️ 缺点：无排序
```

### **GlobTool: 性能优先**
```typescript
// ✅ 优点：性能优异
// ✅ 优点：按修改时间排序（最新优先）⭐
// ✅ 优点：复用 ripgrep 基础设施
// ⚠️ 缺点：依赖 ripgrep
```

---

## 排序的重要性

**GlobTool 的杀手锏：按修改时间排序**

```bash
# 用户执行：list_files("**/*.ts")

# list_files (无排序)
src/utils/helper1.ts
src/utils/helper2.ts
src/components/Button.ts
src/App.ts  # ← 最新修改的文件在最后

# GlobTool (按修改时间)
src/App.ts                    # ← 最新修改，最可能相关 ⭐
src/components/Button.ts      # ← 最近修改
src/utils/helper2.ts
src/utils/helper1.ts
```

**AI Agent 场景：**
- ✅ 最新修改的文件通常最相关
- ✅ 减少 token 消耗（优先处理相关文件）
- ✅ 提升任务效率

---

## 改进建议

### **Priority 1: 使用 ripgrep (可选) **

```typescript
async function listFiles(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  // 复用 grepSearch 的降级策略
  const hasRg = checkCommandAvailable("rg");
  
  if (hasRg) {
    return listFilesWithRipgrep(input);
  }
  
  // Fallback to Node glob
  return listFilesWithGlob(input);
}

async function listFilesWithRipgrep(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  const args = [
    '--files',
    '--glob', input.pattern,
    '--sort=modified',  // ⭐ 按修改时间排序
    '--no-ignore',      // 可配置
    '--hidden',         // 可配置
  ];
  
  const result = execFileSync('rg', args, {
    cwd: input.path || process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
  
  const files = result.split('\n').filter(Boolean);
  return files.slice(0, MAX_FILE_LIST_RESULTS).join('\n') +
    (files.length > MAX_FILE_LIST_RESULTS ? `\n... and ${files.length - MAX_FILE_LIST_RESULTS} more` : '');
}
```

---

### **Priority 2: 添加排序支持**

```typescript
// 如果继续使用 Node glob，可以手动排序
import { statSync } from 'fs';

async function listFiles(input: {
  pattern: string;
  path?: string;
  sort?: 'modified' | 'name';  // 新增排序选项
}): Promise<string> {
  const files = await glob(input.pattern, {
    cwd: input.path || process.cwd(),
    nodir: true,
  ignore: ["node_modules/**", ".git/**"],
  });
  
  // 按修改时间排序
  if (input.sort === 'modified') {
    files.sort((a, b) => {
      const statA = statSync(join(input.path || '.', a));
      const statB = statSync(join(input.path || '.', b));
      return statB.mtimeMs - statA.mtimeMs;  // 最新优先
    });
  }
  
  // ...
}
```

**权衡：**
- ✅ 无需 ripgrep
- ⚠️ statSync 调用会降低性能
- ⚠️ 不如 ripgrep 的 `--sort=modified` 高效

---

### **Priority 3: 中断支持**

```typescript
// 当前实现：无法中断
const files = await glob(input.pattern, { ... });

// 改进：使用 AbortSignal
const abortController = new AbortController();
const files = await glob(input.pattern, {
  signal: abortController.signal,
  // ...
});
```

---

## 迁移影响

### **使用 ripgrep 的优势**
```typescript
// 1. 与 grepSearch 共享降级策略
const hasRg = checkCommandAvailable("rg");

// 2. 统一底层实现
// grepSearch → ripgrep
// listFiles → ripgrep --files

// 3. 性能提升
// Node glob → ripgrep: 2-3x 快
```

### **向后兼容**
```typescript
// 保持接口不变
interface ListFilesInput {
  pattern: string;
  path?: string;
}

// 内部降级逻辑
if (hasRg) {
  return listFilesWithRipgrep(input);
}
return listFilesWithGlob(input);
```

---

## 测试对比

### **功能测试**
```bash
# 基础匹配
list_files("**/*.ts")
# ✅ list_files: 返回文件列表
# ✅ GlobTool:   返回文件列表（按修改时间排序）

# 隐藏文件
list_files("**/.*")
# ⚠️ list_files: 不包含隐藏文件
# ✅ GlobTool:   包含隐藏文件（可配置）

# Gitignored 文件
list_files("**/node_modules/**")
# ⚠️ list_files: 已排除
# ⚙️ GlobTool:   可配置是否排除
```

---

## 实施建议

### **方案 A：渐进式迁移**
```typescript
// Phase 1: 添加降级支持（保留 Node glob）
async function listFiles(input) {
  const hasRg = checkCommandAvailable("rg");
  if (hasRg) {
    return listFilesWithRipgrep(input);  // 优先
  }
  return listFilesWithGlob(input);  // Fallback
}

// Phase 2: 添加排序选项
interface ListFilesInput {
  pattern: string;
  path?: string;
  sort?: 'modified' | 'name';
}

// Phase 3: 移除 glob 依赖（可选）
// 完全依赖 ripgrep
```

### **方案 B：保持现状**
```typescript
// 理由：
// 1. Node glob 已足够好（小型项目差异小）
// 2. 无外部依赖（Windows 友好）
// 3. 稳定性优先
```

---

## 总结

| 维度 | list_files | GlobTool | 建议 |
|------|-----------|----------|------|
| **性能** | ⚡⚡ | ⚡⚡⚡ | 改用 ripgrep |
| **排序** | ❌ | ✅ ⭐ | **必须添加** |
| **中断** | ❌ | ✅ | 可选添加 |
| **依赖** | Node.js | ripgrep | 看场景 |
| **复杂度** | 低 | 中 | 可接受 |

**推荐方案：**
- ✅ **优先实现排序功能**（即使使用 Node glob）
- ✅ 考虑使用 ripgrep（与 grepSearch 一致）
- ✅ 添加降级策略（保持健壮性）

**评分：**
- list_files: ⭐⭐⭐☆☆ (3/5)
- GlobTool:   ⭐⭐⭐⭐⭐ (5/5)

**核心差距：** 排序功能 ⭐
