import type { TableData, CellValue } from './types';
import { cloneTable } from './types';

/** 模拟“脏数据”：有空值、重复、空格、大小写不一等 */
export const sampleDirtyTable: TableData = {
  columns: ['姓名', '部门', '邮箱', '电话', '入职日期'],
  rows: [
    { '姓名': ' 张三 ', '部门': '技术部', '邮箱': 'zhangsan@company.com', '电话': '13800138001', '入职日期': '2022-01-15' },
    { '姓名': '李四', '部门': '产品部', '邮箱': null, '电话': '13800138002', '入职日期': '2022-03-20' },
    { '姓名': '王五', '部门': '技术部', '邮箱': 'wangwu@company.com', '电话': '', '入职日期': '2021-11-01' },
    { '姓名': ' 张三 ', '部门': '技术部', '邮箱': 'zhangsan@company.com', '电话': '13800138001', '入职日期': '2022-01-15' },
    { '姓名': '赵六', '部门': '运营部', '邮箱': 'zhaoliu@company.com', '电话': '13800138004', '入职日期': null },
    { '姓名': '钱七', '部门': 'HR', '邮箱': 'qianqi@company.com', '电话': '13800138005', '入职日期': '2023-02-10' },
    { '姓名': '孙八', '部门': '技术部', '邮箱': 'sunba@company.com', '电话': '13800138006', '入职日期': '2022-06-15' },
    { '姓名': ' 张三 ', '部门': '技术部', '邮箱': 'zhangsan@company.com', '电话': '13800138001', '入职日期': '2022-01-15' },
  ],
};

/** 第二张表：部门预算（可与主表按「部门」做 Join） */
export const sampleDeptBudgetTable: TableData = {
  columns: ['部门', '预算(万)', '负责人'],
  rows: [
    { '部门': '技术部', '预算(万)': 500, '负责人': '陈总' },
    { '部门': '产品部', '预算(万)': 200, '负责人': '林总' },
    { '部门': '运营部', '预算(万)': 150, '负责人': '周总' },
    { '部门': 'HR', '预算(万)': 80, '负责人': '吴总' },
    { '部门': '市场部', '预算(万)': 300, '负责人': '郑总' },
  ],
};

/** 第三张表：同结构追加用（用于 Union 演示） */
export const sampleExtraEmployees: TableData = {
  columns: ['姓名', '部门', '邮箱', '电话', '入职日期'],
  rows: [
    { '姓名': '周九', '部门': '市场部', '邮箱': 'zhoujiu@company.com', '电话': '13800138009', '入职日期': '2023-05-01' },
    { '姓名': '吴十', '部门': '技术部', '邮箱': 'wushi@company.com', '电话': '13800138010', '入职日期': '2023-06-15' },
  ],
};

/**
 * 带公式的合并表示例：销售明细（A=产品, B=单价, C=数量, D=小计 公式）
 * 公式使用 A1 风格：小计 = 单价*数量，即 B*C
 */
export const sampleTableWithFormulas: TableData = {
  columns: ['产品', '单价', '数量', '小计'],
  rows: [
    { '产品': '笔记本', '单价': 4999, '数量': 2, '小计': { t: 'formula', expr: 'B1*C1' } as CellValue },
    { '产品': '鼠标', '单价': 89, '数量': 10, '小计': { t: 'formula', expr: 'B2*C2' } as CellValue },
    { '产品': '键盘', '单价': 299, '数量': 5, '小计': { t: 'formula', expr: 'B3*C3' } as CellValue },
    { '产品': '显示器', '单价': 1299, '数量': 1, '小计': { t: 'formula', expr: 'B4*C4' } as CellValue },
  ],
};

/** 获取可合并的示例表列表（供 UI 选择） */
export function getSampleTablesForMerge(): { id: string; name: string; data: TableData }[] {
  return [
    { id: 'dept_budget', name: '部门预算表', data: cloneTable(sampleDeptBudgetTable) },
    { id: 'extra_employees', name: '追加员工表(Union)', data: cloneTable(sampleExtraEmployees) },
    { id: 'with_formulas', name: '销售表(含公式)', data: cloneTable(sampleTableWithFormulas) },
  ];
}
