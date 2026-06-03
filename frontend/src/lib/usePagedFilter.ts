/**
 * Reusable pagination + filtering hook.
 *
 *   const list = usePagedFilter(items, {
 *     search,                           // free-text query string
 *     searchFields: ['code', 'name'],   // which item fields to match
 *     extraFilter: (it) => true,        // optional custom predicate
 *   });
 *
 *   list.visible       — current page slice to render
 *   list.totalFiltered — how many items match the filter
 *   list.totalRaw      — original length before filtering
 *   list.page / list.setPage
 *   list.pageSize / list.setPageSize
 *   list.totalPages
 *
 * On filter/search change, the page automatically resets to 1.
 */
import { useEffect, useMemo, useState } from 'react';

interface Options<T> {
    search?: string;
    searchFields?: (keyof T | string)[];
    extraFilter?: (item: T) => boolean;
    defaultPageSize?: number;
}

export function usePagedFilter<T>(items: T[], opts: Options<T> = {}) {
    const {
        search = '',
        searchFields = [],
        extraFilter,
        defaultPageSize = 10,
    } = opts;

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    // 1. apply search + extraFilter
    const filtered = useMemo(() => {
        const q = (search || '').trim().toLowerCase();
        return (items || []).filter((it) => {
            if (extraFilter && !extraFilter(it)) return false;
            if (!q) return true;
            for (const f of searchFields) {
                const v = (it as any)?.[f as any];
                if (v != null && String(v).toLowerCase().includes(q)) return true;
            }
            return false;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, search, JSON.stringify(searchFields), extraFilter]);

    // 2. reset to page 1 when filter changes
    useEffect(() => { setPage(1); }, [search, items.length, extraFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const visible = filtered.slice(start, start + pageSize);

    return {
        visible,
        totalFiltered: filtered.length,
        totalRaw: items?.length ?? 0,
        page: safePage,
        setPage,
        pageSize,
        setPageSize,
        totalPages,
    };
}
