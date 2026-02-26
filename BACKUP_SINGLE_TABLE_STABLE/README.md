# 单表合并与智能纠错 - 稳定版快照

> 备份时间：准备进入多表流水线开发前
> 用途：多表链式合并开发时，可随时回滚至此版本

## 包含文件

- **App.tsx** - 主应用与 Agent 流程
- **main.py** - 后端 API（skills、merge-and-scan、ai-task 等）
- **AgentSidebar.tsx** - 合并、审计、Skill 进化交互
- **DataCanvas.tsx** - 画布与数据展示
- **FileDropzone.tsx** - 上传与结构分析
- **skill.ts / agentTask.ts / changeTracking.ts / schemaReport.ts** - 类型定义
- **validateData.ts / diffUtils.ts / parseCsv.ts** - 审计与合并工具
- **defaultData.ts** - 默认底表
- **SYSTEM_RULES.md** - 系统开发准则
