# 后续重构方向

本文档记录项目的技术债务和未来重构方向。

## P1 高优先级

### 1. 工具执行器拆分

**问题**: `tools/executors.ts` (517行) 所有工具实现堆在一起

**方案**: 按功能分组到独立模块

```
src/tools/handlers/
├── file.ts      # read_file, write_file, edit_file
├── shell.ts     # run_shell
├── search.ts   # grep_search, list_files
├── web.ts      # web_search
└── agent.ts    # agent, skill, ask_user
```

### 2. 子代理配置外置

**问题**: `extensions/subagent.ts` (225行) 硬编码配置

**方案**: YAML 配置文件 + 运行时加载

```yaml
# config/sub-agents.yaml
explore:
  model: glm-4-flash
  systemPrompt: "You are a code explorer..."
  tools: [read_file, list_files, grep_search]
```

### 3. 模型配置抽离

**问题**: `core/agent-model.ts` 硬编码上下文窗口和能力

**方案**: YAML 配置 + 环境变量覆盖

```yaml
# config/models.yaml
glm-4:
  contextWindow: 128000
  supportsThinking: false
  supportsAdaptiveThinking: false
```

---

## P2 中优先级

### 4. REPL 状态机

**问题**: 当前简单事件驱动，无法处理复杂交互状态

**现状**: `src/cli/repl.ts` - `"line"` 事件 + SIGINT 处理

**方案**: 引入状态机

```typescript
type REPLState = "idle" | "processing" | "waiting_confirm" | "waiting_input";

class REPLController {
  private state: REPLState;
  private transitions: Map<REPLState, TransitionRule[]>;
}
```

### 5. 记忆系统完善

**问题**: `recallMemories()` 已定义但未使用，模型只能手动读取

**方案**: 
- 添加 `recall_memory` 工具
- 或在系统提示中自动注入相关记忆

### 6. 流式工具并行执行

**问题**: 当前串行执行，读操作无谓等待

**现状**: `agent.ts` 中 `for await` 循环

**方案**: Claude Code 模式

```typescript
// 流式期间并行执行
const pending = new Map<number, Promise<ToolResult>>();

for await (const chunk of stream) {
  if (toolCallComplete) {
    pending.set(index, executeToolAsync(tc));
  }
}

// 流结束后等待所有结果
const results = await Promise.all(pending.values());
```

---

## P3 低优先级

### 7. 测试框架

**问题**: 无测试框架

**方案**: 引入 Vitest

```bash
npm init vitest@latest
```

### 8. 插件系统

**目标**: 允许第三方扩展工具

**设计**:
```typescript
interface Plugin {
  name: string;
  tools?: ToolDef[];
  hooks?: Hooks;
}
```

### 9. 配置持久化

**问题**: 纯环境变量，用户每次需重新设置

**方案**: `~/.ccmini/config.json`

```json
{
  "model": "glm-4",
  "apiBase": "https://open.bigmodel.cn/api/paic/v1",
  "permissionMode": "default"
}
```

---

## 优先级矩阵

| 优先级 | 任务 | 收益 | 难度 |
|--------|------|------|------|
| P1 | 工具handlers拆分 | 可维护性 | 低 |
| P1 | 子代理配置外置 | 可配置性 | 中 |
| P1 | 模型配置抽离 | 可配置性 | 低 |
| P2 | REPL状态机 | 健壮性 | 高 |
| P2 | 记忆系统 | 智能化 | 中 |
| P2 | 工具并行 | 性能 | 中 |
| P3 | 测试框架 | 质量保证 | 中 |
| P3 | 插件系统 | 扩展性 | 高 |
| P3 | 配置持久化 | 易用性 | 低 |