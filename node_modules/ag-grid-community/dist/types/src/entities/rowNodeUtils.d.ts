import type { BeanCollection } from '../context/context';
import type { AgEventType } from '../eventTypes';
import type { RowEvent } from '../events';
import type { GridOptionsService } from '../gridOptionsService';
import type { IRowModel } from '../interfaces/iRowModel';
import type { IRowNode } from '../interfaces/iRowNode';
import { RowNode } from './rowNode';
export declare function _createGlobalRowEvent<T extends AgEventType>(rowNode: RowNode, gos: GridOptionsService, type: T): RowEvent<T>;
export declare const _createRowNodeSibling: (rowNode: RowNode, beans: BeanCollection) => RowNode;
/** When dragging multiple rows, we want the user to be able to drag to the prev or next in the group if dragging on one of the selected rows. */
export declare const _prevOrNextDisplayedRow: (rowModel: IRowModel, direction: -1 | 1, initial: IRowNode | null | undefined) => RowNode | undefined;
