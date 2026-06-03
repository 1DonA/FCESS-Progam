/**
 * Pagination + page-size footer shared by every list page.
 *
 *   <PagedFooter
 *     page={list.page}
 *     totalPages={list.totalPages}
 *     pageSize={list.pageSize}
 *     totalFiltered={list.totalFiltered}
 *     totalRaw={list.totalRaw}
 *     onPageChange={list.setPage}
 *     onPageSizeChange={list.setPageSize}
 *   />
 */
import { Group, Pagination, Select, Text } from '@mantine/core';

interface Props {
    page: number;
    totalPages: number;
    pageSize: number;
    totalFiltered: number;
    totalRaw: number;
    onPageChange: (p: number) => void;
    onPageSizeChange: (n: number) => void;
}

export function PagedFooter({
    page, totalPages, pageSize, totalFiltered, totalRaw,
    onPageChange, onPageSizeChange,
}: Props) {
    if (totalFiltered === 0) return null;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalFiltered);
    return (
        <Group justify="space-between" mt="md" wrap="wrap">
            <Text size="xs" c="dimmed">
                Showing {start}–{end} of {totalFiltered}
                {totalFiltered !== totalRaw && (
                    <> · filtered from {totalRaw}</>
                )}
            </Text>
            <Group gap="sm">
                <Select
                    size="xs"
                    radius="lg"
                    style={{ width: 110 }}
                    data={['10', '25', '50', '100'].map((n) => ({ value: n, label: `${n} / page` }))}
                    value={String(pageSize)}
                    onChange={(v) => onPageSizeChange(Number(v) || 10)}
                    allowDeselect={false}
                />
                <Pagination
                    value={page}
                    onChange={onPageChange}
                    total={totalPages}
                    size="sm"
                    radius="lg"
                    siblings={1}
                />
            </Group>
        </Group>
    );
}
