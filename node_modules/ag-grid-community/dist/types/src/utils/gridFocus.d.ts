import type { BeanCollection } from '../context/context';
import type { CellPosition } from '../interfaces/iCellPosition';
import type { Component } from '../widgets/component';
export declare function _addFocusableContainerListener(beans: BeanCollection, comp: Component, eGui: HTMLElement): void;
export declare function _focusGridInnerElement(beans: BeanCollection, fromBottom?: boolean): boolean;
export declare function _isHeaderFocusSuppressed(beans: BeanCollection): boolean;
export declare function _isCellFocusSuppressed(beans: BeanCollection): boolean;
export declare function _focusNextGridCoreContainer(beans: BeanCollection, backwards: boolean, forceOut?: boolean): boolean;
export declare function _attemptToRestoreCellFocus(beans: BeanCollection, focusedCell: CellPosition | null): void;
