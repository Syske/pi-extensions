# pi-safety-guard 设计文档

## 概述

Pi 全局扩展，在风险操作（修改、编辑、删除、启动 subagent）前强制输出变更计划 + 按风险等级授权。跨项目生效，所有会话自动加载。

## 风险等级

| 等级 | 标识 | 工具 | 授权规则 |
|------|------|------|---------|
| 🔴 高风险 | `high` | `delete`, bash 高危模式 | 每次操作单独拦截；必须输出完整变更分析 + 影响评估 + 回滚方案；用户显式输入 `y`/`n` |
| 🟡 中风险 | `medium` | `write`, `edit`, bash 中等模式 | 首次操作目标文件时拦截；输出计划后批准；同一文件后续操作自动通过（session 级缓存） |
| 🟢 低风险 | `low` | `read`, bash 安全模式 | 不拦截，透传 |

## 架构

### 模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `index.ts` | 注册 `tool_call`、`before_agent_start` hooks；注册 `/safety` 命令 |
| System Prompt 注入 | `system-prompt.ts` | `before_agent_start` 事件：注入风险等级说明 + 变更计划模板 + 授权流程规则 |
| Tool Call 门卫 | `tool-gate.ts` | `tool_call` 事件：分类风险 → 查 Scope Cache → 决定 BLOCK / ALLOW |
| Bash 风险分析 | `bash-analyzer.ts` | 基于正则/命令列表将 bash 命令归入 high / medium / low |
| Scope 缓存 | `scope-cache.ts` | 内存 Map：`<string, {risk, approved, timestamp}>` |
| 安全命令 | `safety-command.ts` | `/safety status / revoke / reset / config` |
| 类型定义 | `types.ts` | RiskLevel, CacheEntry, SafetyConfig 等 |

### 数据流

```
tool_call
  ─→ tool-gate.ts
      ├─→ bash-analyzer.ts (仅 bash 工具)
      └─→ scope-cache.ts: lookup(key)
           ├─ 命中 + 已批准 → ALLOW
           ├─ 命中 + 未批准 → BLOCK
           └─ 未命中 → 查风险等级
                ├─ LOW → ALLOW + 不缓存
                ├─ MEDIUM → BLOCK + 缓存 {approved: false}
                └─ HIGH → BLOCK + 不缓存
```

## Scope Cache 实现

```typescript
interface CacheEntry {
  risk: RiskLevel;
  approved: boolean;
  approvedAt?: number;
  turnId?: string;
  toolName?: string;
}

class ScopeCache {
  private store: Map<string, CacheEntry>;
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  approve(key: string): void;
  revoke(key: string): void;
  reset(): void;
  entries(): [string, CacheEntry][];
}
```

## Bash 风险分类规则

| 风险 | 命令/模式 |
|------|-----------|
| HIGH | `rm -rf`, `del /f /s`, `rd /s /q`, `git push --force`, `format`, `diskpart` |
| MEDIUM | `mv`, `cp`, `chmod`, `npm install`, `pip install`, `git add`, `git commit`, `git push` (无 force), `git reset` |
| LOW | `ls`, `cat`, `grep`, `find`, `head`, `tail`, `echo`, `git status`, `git diff`, `git log`, `pwd`, `which`, `dir` |

## Subagent 拦截

| 场景 | 机制 | 说明 |
|------|------|------|
| LLM 通过工具调用启动 | `launch_subagent` 自定义工具 → `tool_call` 拦截 | 归入 🟡 中风险 |
| pi-ai-system 编排启动 | 工作流内部调用，不走工具层 | 非本扩展职责 |

## 命令接口

```
/safety status       — 查看批准的 scope 列表 + 拦截统计
/safety revoke <key> — 撤销特定文件/命令的批准
/safety reset        — 清空所有缓存
/safety config       — 查看/修改风险阈值
```
