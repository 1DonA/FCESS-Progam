import { useEffect, useState } from 'react';
import {
    Box, Button, Group, Paper, Progress, Skeleton, Stack, Text, ThemeIcon, Title,
    TextInput, Badge,
} from '@mantine/core';
import { IconUsers, IconSearch, IconChevronDown } from '@tabler/icons-react';
import { apiClient } from '../../api/client';

interface LoadEntry {
    faculty_id: string;
    name: string;
    rank: string;
    max_load_hours: number;
    current_load_hours: number;
    sessions_count: number;
    is_overloaded: boolean;
    utilization_pct: number;
}

interface Props {
    semesterId: string;
    /** bumped by the parent after the schedule changes — forces a refetch */
    refreshKey?: number;
}

/** Horizontal bar chart of each lecturer's current vs max teaching load. */
export function FacultyLoadCard({ semesterId, refreshKey = 0 }: Props) {
    const [data, setData] = useState<LoadEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [expanded, setExpanded] = useState(false);
    const PREVIEW_COUNT = 6;

    useEffect(() => {
        if (!semesterId) return;
        setLoading(true);
        apiClient
            .get<LoadEntry[]>(`/scheduling/faculty-load/${semesterId}`)
            .then((r) => setData(r.data || []))
            .catch(() => setData([]))
            .finally(() => setLoading(false));
    }, [semesterId, refreshKey]);

    const rows = data
        .filter((r) =>
            !filter ? true : (r.name + ' ' + r.rank).toLowerCase().includes(filter.toLowerCase()),
        )
        // sort: overloaded first, then by utilisation desc
        .sort((a, b) =>
            (b.is_overloaded ? 1 : 0) - (a.is_overloaded ? 1 : 0) ||
            b.utilization_pct - a.utilization_pct,
        );

    const overloaded = rows.filter((r) => r.is_overloaded).length;
    const summary =
        rows.length === 0
            ? 'No teaching load data yet.'
            : `${rows.length} lecturer${rows.length === 1 ? '' : 's'} · ${overloaded} overloaded`;

    return (
        <Paper p="lg" radius="xl" withBorder shadow="sm">
            <Group justify="space-between" align="center" mb="md" wrap="wrap">
                <Group gap="md">
                    <ThemeIcon size={36} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                        <IconUsers size={18} />
                    </ThemeIcon>
                    <Box>
                        <Title order={4}>Faculty Load</Title>
                        <Text size="xs" c="dimmed">{summary}</Text>
                    </Box>
                </Group>
                <TextInput
                    placeholder="Filter lecturers…"
                    leftSection={<IconSearch size={14} />}
                    value={filter}
                    onChange={(e) => setFilter(e.currentTarget.value)}
                    radius="lg"
                    size="xs"
                    style={{ width: 220 }}
                />
            </Group>

            {loading ? (
                <Stack gap="sm">{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={28} radius="md" />)}</Stack>
            ) : rows.length === 0 ? (
                <Text c="dimmed" ta="center" py="md" size="sm">
                    {filter ? 'No lecturers match your filter.' : 'No lecturers loaded for this semester yet — run Auto-Generate Schedule to populate.'}
                </Text>
            ) : (
                <Stack gap="xs">
                    {(expanded ? rows : rows.slice(0, PREVIEW_COUNT)).map((r) => {
                        const pct = Math.min(150, r.utilization_pct);
                        const barColor = r.is_overloaded
                            ? 'red'
                            : pct > 80 ? 'orange'
                            : pct > 50 ? 'teal'
                            : 'blue';
                        return (
                            <Box key={r.faculty_id}>
                                <Group justify="space-between" gap="xs" mb={2}>
                                    <Group gap={6}>
                                        <Text size="sm" fw={600}>{r.name}</Text>
                                        <Badge size="xs" variant="light" color="gray">{r.rank}</Badge>
                                        {r.is_overloaded && (
                                            <Badge size="xs" color="red" variant="filled">OVERLOADED</Badge>
                                        )}
                                    </Group>
                                    <Text size="xs" c="dimmed" fw={500}>
                                        {r.current_load_hours}h / {r.max_load_hours}h
                                        {' '}({Math.round(r.utilization_pct)}%) · {r.sessions_count} sess.
                                    </Text>
                                </Group>
                                <Progress.Root size="md" radius="xl">
                                    <Progress.Section value={Math.min(100, pct)} color={barColor} />
                                    {pct > 100 && (
                                        <Progress.Section
                                            value={Math.min(50, pct - 100)}
                                            color="red"
                                            striped
                                            animated
                                        />
                                    )}
                                </Progress.Root>
                            </Box>
                        );
                    })}
                    {rows.length > PREVIEW_COUNT && (
                        <Button
                            variant="subtle"
                            color="brand"
                            size="xs"
                            radius="lg"
                            onClick={() => setExpanded((v) => !v)}
                            rightSection={
                                <IconChevronDown
                                    size={14}
                                    style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                                />
                            }
                            style={{ alignSelf: 'flex-start' }}
                        >
                            {expanded
                                ? `Show top ${PREVIEW_COUNT} only`
                                : `View all ${rows.length} lecturers`}
                        </Button>
                    )}
                </Stack>
            )}
        </Paper>
    );
}
