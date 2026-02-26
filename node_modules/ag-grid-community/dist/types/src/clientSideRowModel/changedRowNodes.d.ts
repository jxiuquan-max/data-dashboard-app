import type { RowNode } from '../entities/rowNode';
export declare class ChangedRowNodes<TData = any> {
    reordered: boolean;
    readonly removals: RowNode<TData>[];
    readonly updates: Set<RowNode<TData>>;
    readonly adds: Set<RowNode<TData>>;
}
