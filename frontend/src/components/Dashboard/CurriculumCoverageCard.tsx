import { useEffect, useState } from 'react';
import {
    Badge, Box, Button, Group, Paper, Skeleton, Stack, Text, ThemeIcon, Title,
} from '@mantine/core';
import { IconBookmark, IconCheck, IconAlertCircle, IconChevronDown } from '@tabler/icons-react';
import { apiClient } from '../../api/client';

interface CoverageRow {
    course_id: string;
    code: string;
    title: string;
    curriculum_year: number;
    section_count: number;
    scheduled_sections: number;
    fully_scheduled: boolean;
    is_unscheduled: boolean;
}

interface Props {
    semesterId: string;
    refreshKey?: number;
}

/** FR-14: per curriculum year, which courses are fully / partly / not yet scheduled. */
export function CurriculumCoverageCard({ semesterId, refreshKey = 0 }: Props) {
    const [rows, setRows] = useState<CoverageRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const PREVIEW_COURSES = 18;

    useEffect(() => {
        if (!semesterId) return;
        setLoading(true);
        apiClient
            .get<CoverageRow[]>(`/scheduling/curriculum-coverage/${semesterId}`)
            .then((r) => setRows(r.data || []))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, [semesterId, refreshKey]);

    const byYear: Record<number, CoverageRow[]> = {};
    rows.forEach((r) => {
        const y = r.curriculum_year || 0;
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(r);
    });
    const totalCourses = rows.length;
    const fullyScheduled = rows.filter((r) => r.fully_scheduled).length;
    const unscheduled = rows.filter((r) => r.is_unscheduled).length;

    return (
        <Paper p="lg" radius="xl" withBorder shadow="sm">
            <Group justify="space-between" align="center" mb="md" wrap="wrap">
                <Group gap="md">
                    <ThemeIcon size={36} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                        <IconBookmark size={18} />
                    </ThemeIcon>
                    <Box>
                        <Title order={4}>Curriculum Coverage</Title>
                        <Text size="xs" c="dimmed">
                            {totalCourses === 0
                                ? 'Add courses to see coverage.'
                                : `${fullyScheduled}/${totalCourses} fully scheduled · ${unscheduled} not yet scheduled`}
                        </Text>
                    </Box>
                </Group>
                {unscheduled > 0 && (
                    <Badge color="red" variant="light" size="lg" leftSection={<IconAlertCircle size={12} />}>
                        {unscheduled} missing
                    </Badge>
                )}
            </Group>

            {loading ? (
                <Stack gap="xs">{[1, 2, 3].map((i) => <Skeleton key={i} height={48} radius="md" />)}</Stack>
            ) : totalCourses === 0 ? (
                <Text c="dimmed" ta="center" py="md" size="sm">No active courses defined yet.</Text>
            ) : (
                <Stack gap="xs">
                    {(() => {
                        const yearKeys = Object.keys(byYear).map((y) => Number(y)).sort((a, b) => a - b);
                        const blocks: { year: number; list: typeof rows }[] = [];
                        let shown = 0;
                        let truncated = false;
                        for (const year of yearKeys) {
                            const list = byYear[year];
                            if (!expanded && shown + list.length > PREVIEW_COURSES && blocks.length > 0) {
                                truncated = true;
                                break;
                            }
                            if (!expanded && list.length > PREVIEW_COURSES) {
                                blocks.push({ year, list: list.slice(0, PREVIEW_COURSES) });
                                truncated = true;
                                shown += PREVIEW_COURSES;
                                break;
                            }
                            blocks.push({ year, list });
                            shown += list.length;
                        }
                        return (
                            <>
                                {blocks.map(({ year, list }) => (
                                <Box key={year}>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
                                        Year {year} · {list.length} course{list.length === 1 ? '' : 's'}
                                    </Text>
                                    <Group gap={6} wrap="wrap">
                                        {list.map((c) => {
                                            const color = c.fully_scheduled
                                                ? 'teal'
                                                : c.is_unscheduled
                                                  ? 'red'
                                                  : 'orange';
                                            const Icon = c.fully_scheduled ? IconCheck : IconAlertCircle;
                                            return (
                                                <Badge
                                                    key={c.course_id}
                                                    color={color}
                                                    variant="light"
                                                    size="md"
                                                    leftSection={<Icon size={12} />}
                                                    title={`${c.title} — ${c.scheduled_sections}/${c.section_count} section(s) scheduled`}
                                                >
                                                    {c.code}
                                                </Badge>
                                            );
                                        })}
                                    </Group>
                                </Box>
                                ))}
                                {(truncated || expanded) && rows.length > PREVIEW_COURSES && (
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
                                            ? `Show preview only`
                                            : `View all ${rows.length} courses across ${Object.keys(byYear).length} year(s)`}
                                    </Button>
                                )}
                            </>
                        );
                    })()}
                </Stack>
            )}
        </Paper>
    );
}
