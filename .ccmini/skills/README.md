# Custom Skills

创建可复用的提示词模板 (skills)。

## 创建方法

创建 `skills/<name>/SKILL.md` 文件：

```markdown
---
name: commit
description: 生成 Git commit 消息
mode: inline
---

根据当前的 git diff，生成一个简洁的 commit 消息。

格式要求：
- 第一行：简短摘要 (<50字符)
- 空行
- 详细描述变更内容

Git diff:
{{diff}}
```

## 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 否 | Skill 名称，默认为目录名 |
| `description` | 是 | 简短描述 |
| `mode` | 否 | 执行模式，默认 `inline` |

## 执行模式

| 模式 | 行为 |
|------|------|
| `inline` | 提示词注入到当前对话 |
| `fork` | 启动独立 sub-agent 执行 |

## 使用方式

在对话中调用：

```
/commit
```

或请求时提及：

```
用 commit skill 生成提交消息
```

## 模板变量

可在提示词中使用 `{{var}}` 格式的变量，调用时传入：

```json
{
  "skill_name": "commit",
  "args": "diff= staged"
}
```
