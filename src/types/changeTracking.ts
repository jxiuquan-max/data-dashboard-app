/**
 * 数据变更检测：新增、变化、删除
 */

export interface ChangeReport {
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  /** 新增：商品名称列表 */
  addedProducts: string[];
  /** 变化：{ productName, baseRowIndex, changes: [{ col, oldVal, newVal }] } */
  modifiedRows: Array<{
    productName: string;
    baseRowIndex: number;
    changes: Array<{ col: string; oldVal: string | null; newVal: string | null }>;
  }>;
  /** 删除：商品名称列表（底表有、新表无） */
  deletedProducts: string[];
}
