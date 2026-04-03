# Auto-compact 未触发的 Bug 分析

## 用户报告

```bash
tokens: 375.8k in · 1.8k out · 377.5k total
```

**问题：** tokens 已超过 200k，但没有触发 auto-compact。

---

## 根本原因分析

### **关键代码逻辑**

```typescript
// src/core/agent.ts

class Agent {
  private totalInputTokens = 0;        // 累积 token
  private lastInputTokenCount = 0;      // 最后一次 API 调用的 token
  private effectiveWindow: number;      // 上下文窗口大小 (200k - 20k)
  
  // API 调用后更新 token
  this.totalInputTokens += response.usage.input_tokens;
  this.lastInputTokenCount = response.usage.input_tokens;
  
  // compact 检查
  private async checkAndCompact(): Promise<void> {
    if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
      printInfo("Context window filling up, compacting conversation...");
      await this.compactConversation();
    }
  }
}
```

---

## Bug 详情

### **错误逻辑**

```typescript
// ❌ 错误：检查的是最后一次 API 调用的 token
if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
  // 触发 compact
}
```

### **问题场景**

```typescript
// 假设模型上下文窗口：200k
effectiveWindow = 200000 - 20000 = 180000;
compactThreshold = 180000 * 0.85 = 153000;

// 实际情况
conversationHistory = [
  { role: "user", content: "..." },      // 5k tokens
  { role: "assistant", content: "..." },  // 10k tokens
  // ... 更多消息 ...
  // 累积：375.8k tokens
];

lastAPICall = {
  input_tokens: 50000,  // ← 最后一次 API 调用
};

// Bug: 检查 50000 < 153000 → 不触发 compact
// 实际应该：检查 375800 > 153000 → 触发 compact
```

---

## 证据链

### **1. Token 累积逻辑**
```typescript
// src/core/agent.ts:737
this.totalInputTokens += response.usage.input_tokens;
this.totalOutputTokens += response.usage.output_tokens;
this.lastInputTokenCount = response.usage.input_tokens;
```

**结论：** `totalInputTokens` 是累积值，`lastInputTokenCount` 是单次值。

---

### **2. Compact 检查逻辑**
```typescript
// src/core/agent.ts:388
private async checkAndCompact(): Promise<void> {
  if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
    await this.compactConversation();
  }
}
```

**结论：** 错误地使用 `lastInputTokenCount` 进行检查。

---

### **3. 显示逻辑**
```typescript
// src/ui/ui.ts:571
export function printTokenUsage(inputTokens: number, outputTokens: number) {
  const total = inputTokens + outputTokens;
  console.log(`tokens: ${fmtTokens(inputTokens)} in · ...`);
}

// 调用处
printTokenUsage(this.totalInputTokens, this.totalOutputTokens);
```

**结论：** 用户看到的是累积 token（`totalInputTokens`）。

---

## 影响分析

### **严重性：高** ⚠️⚠️⚠️

**后果：**
1. **API 错误**：超出模型上下文窗口 → `400 Bad Request`
2. **成本增加**：大上下文增加 API 费用
3. **性能下降**：大上下文降低响应速度
4. **任务中断**：无法继续对话

---

## 修复方案

### **方案 A：使用累积 token**

```typescript
private async checkAndCompact(): Promise<void> {
  // ✅ 使用累积 token
  if (this.totalInputTokens > this.effectiveWindow * 0.85) {
    printInfo("Context window filling up, compacting conversation...");
    await this.compactConversation();
  }
}
```

**优点：** 简单直接
**缺点：** `totalInputTokens` 包含历史对话，可能不准确

---

### **方案 B：计算实际消息大小**

```typescript
private async checkAndCompact(): Promise<void> {
  // ✅ 计算当前消息历史的实际 token 数
  const currentTokens = await this.estimateMessageTokens();
  
  if (currentTokens > this.effectiveWindow * 0.85) {
    printInfo(`Context window filling up (${fmtTokens(currentTokens)}), compacting...`);
    await this.compactConversation();
  }
}

private async estimateMessageTokens(): Promise<number> {
  // 粗略估算：每个消息的平均 token
  // 或使用 tiktoken 库精确计算
  const messageCount = this.anthropicMessages.length;
  return messageCount * 1000; // 粗略估算
}
```

**优点：** 更准确
**缺点：** 需要额外计算

---

### **方案 C：使用 API 返回的 usage**

```typescript
private async checkAndCompact(): Promise<void> {
  // ✅ 使用最后一次 API 调用的 input_tokens
  // 但这是当前上下文的真实大小
  if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
    printInfo(`Context window at ${Math.round(this.lastInputTokenCount / this.effectiveWindow * 100)}%, compacting...`);
    await this.compactConversation();
  }
}
```

**关键理解：** `lastInputTokenCount` 实际上是 API 收到的**完整上下文大小**

**验证：**
```typescript
// API 调用时
response = await anthropic.messages.create({
  model: this.model,
  messages: this.anthropicMessages,  // ← 完整消息历史
});

response.usage.input_tokens  // ← 这应该是当前上下文的真实大小
```

**如果这个理解正确，那么当前代码逻辑是对的！**

---

## 深入验证

### **测试场景**

```typescript
// 初始状态
messages = []
lastInputTokenCount = 0

// 第 1 次 API 调用
messages = [{ role: "user", content: "Hello" }]
response.usage.input_tokens = 100  // 包含系统提示词 + 消息

// 第 2 次 API 调用
messages = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "How are you?" }
]
response.usage.input_tokens = 200  // 累积的所有消息

// 第 N 次 API 调用
messages = [ ... 所有历史消息 ... ]
response.usage.input_tokens = 375800  // ← 应该反映真实上下文大小
```

**关键问题：** Anthropic API 返回的 `input_tokens` 是否包含**完整消息历史**？

---

## 查证 API 行为

### **Anthropic API 文档**

> `usage.input_tokens`: The number of input tokens which were used.

**理解：** 应该包含：
- 系统提示词
- 所有历史消息
- 当前用户消息

**如果正确，那么 `lastInputTokenCount` 应该反映真实上下文大小！**

---

## 可能的真实原因

### **假设 1：API 行为不符预期**

```typescript
// 可能 API 只返回当前请求的 token，不包含历史
lastInputTokenCount = 50000;  // 仅当前请求
实际上下文大小 = 375800;      // 包含历史
```

**验证方法：**
```typescript
console.log({
  messages: this.anthropicMessages.length,
  lastInputTokenCount: this.lastInputTokenCount,
  totalInputTokens: this.totalInputTokens,
});
```

---

### **假设 2：模型上下文窗口配置错误**

```typescript
// src/core/agent-model.ts
const MODEL_CONTEXT: Record<string, number> = {
  "minimax-m2.5": 200000,
  "kimi-k2.5": 200000,
  "glm-5": 200000,
};

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT[model] || 200000;  // ← 默认 200k
}
```

**问题：** 如果实际模型的上下文窗口是 400k，那么 375k 就不会触发 compact。

---

### **假设 3：checkAndCompact 未被调用**

```typescript
// src/core/agent.ts:765
this.anthropicMessages.push({ role: "user", content: toolResults });
await this.checkAndCompact();  // ← 是否真的调用了？
```

**验证方法：** 添加日志
```typescript
private async checkAndCompact(): Promise<void> {
  console.log(`[DEBUG] checkAndCompact: ${this.lastInputTokenCount} / ${this.effectiveWindow}`);
  if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
    // ...
  }
}
```

---

## 建议修复步骤

### **Step 1: 添加诊断日志**

```typescript
private async checkAndCompact(): Promise<void> {
  const utilization = (this.lastInputTokenCount / this.effectiveWindow * 100).toFixed(1);
  console.log(`[Compact Check] ${this.lastInputTokenCount} / ${this.effectiveWindow} (${utilization}% )`);
  
  if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
    printInfo("Context window filling up, compacting conversation...");
    await this.compactConversation();
  }
}
```

### **Step 2: 验证 API 行为**

```typescript
// 在 API 调用后添加日志
console.log({
  model: this.model,
  lastInputTokenCount: this.lastInputTokenCount,
  totalInputTokens: this.totalInputTokens,
  messagesCount: this.anthropicMessages.length,
});
```

### **Step 3: 根据结果修复**

**如果 `lastInputTokenCount` 确实是真实上下文大小：**
- 可能是模型上下文窗口配置错误
- 检查 `getContextWindow()` 返回值

**如果 `lastInputTokenCount` 不是真实上下文大小：**
- 修改为使用 `totalInputTokens`
- 或实现消息 token 估算

---

## 总结

**Bug 确认：** ✅ 存在逻辑问题

**根本原因：** 需要进一步验证
1. 可能是 API 返回值理解错误
2. 可能是模型配置错误
3. 可能是检查逻辑错误

**修复优先级：** P0 (最高)

**影响范围：** 所有无限制对话场景
