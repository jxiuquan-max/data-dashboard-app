import { AgTabGuardFeature } from '../agStack/focus/agTabGuardFeature';
import type { TabGuardCtrlParams } from '../agStack/focus/tabGuardCtrl';
import { AgTabGuardCtrl } from '../agStack/focus/tabGuardCtrl';
import type { BeanCollection } from '../context/context';
import type { AgEventTypeParams } from '../events';
import type { GridOptionsWithDefaults } from '../gridOptionsDefault';
import type { GridOptionsService } from '../gridOptionsService';
import type { AgGridCommon } from '../interfaces/iCommon';
import type { Component } from './component';
export declare class TabGuardCtrl extends AgTabGuardCtrl<BeanCollection, GridOptionsWithDefaults, AgEventTypeParams, AgGridCommon<any, any>, GridOptionsService> {
    constructor(params: TabGuardCtrlParams);
}
export declare class TabGuardFeature extends AgTabGuardFeature<BeanCollection, GridOptionsWithDefaults, AgEventTypeParams, AgGridCommon<any, any>, GridOptionsService> {
    constructor(comp: Component<any>);
}
