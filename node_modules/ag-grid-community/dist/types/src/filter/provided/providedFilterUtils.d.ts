import type { LocaleTextFunc } from '../../agStack/interfaces/iLocaleService';
import type { FilterWrapperParams } from '../../interfaces/iFilter';
import type { FilterLocaleTextKey } from '../filterLocaleText';
import type { IProvidedFilterParams } from './iProvidedFilter';
import type { FilterPlaceholderFunction, ISimpleFilterModelType } from './iSimpleFilter';
export declare function getDebounceMs(params: IProvidedFilterParams, debounceDefault: number): number;
export declare function _isUseApplyButton(params: FilterWrapperParams): boolean;
export declare function getPlaceholderText(bean: {
    getLocaleTextFunc(): LocaleTextFunc;
}, filterPlaceholder: string | FilterPlaceholderFunction | undefined, defaultPlaceholder: FilterLocaleTextKey, filterOptionKey: ISimpleFilterModelType): string;
