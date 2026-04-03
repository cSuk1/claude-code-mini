# Custom Agents

创建自定义 sub-agent，用于特定任务场景。

## 创建方法

创建 `<name>.md` 文件，使用 YAML frontmatter：

```markdown
---
name: test-writer
description: 编写单元测试的 agent
allowed-tools: read_file,write_file,grep_search
model: lite
---

你是一个专门的测试编写 agent。你的任务是：

1. 阅读源代码理解功能
2. 为每个函数编写单元测试
3. 使用项目配置的测试框架

输出简洁、可维护的测试代码。
```

## 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 否 | Agent 名称，默认为文件名 |
| `description` | 是 | 简短描述，显示在帮助中 |
| `allowed-tools` | 否 | 逗号分隔的工具列表，默认全部工具 |
| `model` | 否 | 模型层级 (pro/lite/mini) 或具体模型名 |

## 使用方式

在对话中请求启动 sub-agent 时指定类型：

```
用 test-writer agent 为 src/utils.ts 编写测试
```

或通过工具调用：
```json
{
  "type": "test-writer",
  "prompt": "为 src/utils.ts 编写测试"
}
```
