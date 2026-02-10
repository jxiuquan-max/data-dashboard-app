# 表格数据清洗 · AI 还原演示

模拟 **AI 如何真实还原用户对表格数据清洗的全过程** 的演示系统。

## 功能说明

1. **上传表格**：页面顶部支持上传本地表格文件（.csv、.xlsx、.xls），解析后加载为当前表，便于用真实数据做验证。
2. **用户清洗流程**：在左侧对表格执行各类清洗操作（删除行、填充空值、去重、重命名列、去除空格、过滤、替换等），每一步都会记录到「操作历史」。
3. **AI 还原**：
   - **逐步回放**：从初始脏数据开始，AI 按历史步骤一步一步执行，可点击「执行下一步」观察每一步效果。
   - **AI 一键还原**：AI 一次性按全部历史步骤还原数据，展示完整清洗流水线。

## 使用方式

**ECONNREFUSED 127.0.0.1:5001 表示后端未启动**，需先启动后端再使用录入功能。

**1. 启动后端（必须先做，否则录入会报 ECONNREFUSED）**

在项目根目录**新开一个终端**，执行：

```bash
# 若使用虚拟环境，先激活
source .venv/bin/activate   # macOS/Linux
# 或  .venv\Scripts\activate   # Windows

# 安装依赖（首次）
pip install -r requirements-api.txt

# 启动后端（保持此终端不要关）
npm run backend
```

或直接：`uvicorn main:app --reload --host 0.0.0.0 --port 5001`

确认成功：浏览器打开 http://127.0.0.1:5001/health 应看到 `{"status":"ok","port":5001}`。

**若端口 5001 被占用**（启动时报 `Address already in use`）：

- **macOS / Linux**：在终端执行  
  `lsof -ti:5001 | xargs kill -9`  
  或先查进程 `lsof -i:5001`，再 `kill -9 <PID>`。
- **Windows**：  
  `netstat -ano | findstr :5001` 得到 PID，再 `taskkill /PID <PID> /F`。

**2. 启动前端**

再开一个终端：

```bash
npm install
npm run dev
```

浏览器打开提示的本地地址。录入页下方会显示「后端已连接」后再上传 CSV。

## 技术栈

- React 18 + TypeScript
- Vite 5
- xlsx（解析 Excel）

## 项目结构

- `src/types.ts`：表格数据、清洗操作类型、步骤应用逻辑
- `src/useCleanState.ts`：表格状态、历史记录、回放逻辑
- `src/sampleData.ts`：示例脏数据（空值、重复、空格等）
- `src/parseTableFile.ts`：上传文件解析（CSV / Excel → TableData）
- `src/UploadTable.tsx`：上传区域 UI 与校验提示
- `src/DataTable.tsx`：表格展示
- `src/OperationPanel.tsx`：清洗操作面板
- `src/HistoryPanel.tsx`：操作历史与回放入口
- `src/ReplayPanel.tsx`：AI 还原过程日志展示
