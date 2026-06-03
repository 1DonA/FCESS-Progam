/**
 * Unplaced-sessions panel.
 *
 * Shows every section in the active semester that the scheduler could not
 * place, with:
 *   • the reason(s) it failed (no eligible lecturer, no LAB room, etc.)
 *   • suggested-fix buttons that deep-link to the relevant page
 *   • a draggable card so the user can drop it onto any empty cell of WeekView.
 *
 * The actual drop logic lives in the parent because the DndContext is shared
 * with WeekView (see Dashboard.tsx).
 */
import { useMemo, useState } from 'react';
import {
    Badge, Box, Button, Group, Paper, ScrollArea, Stack, Text, ThemeIcon,
    Tooltip, ActionIcon,
} from '@mantine/core';
import {
    IconAlertTriangle, IconArrowRight, IconGripVertical, IconRefresh,
    IconShieldCheck,
} from '@tabler/icons-react';
import { useDraggable } from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';

export interface UnplacedReason { code: string; label: string; }
export interface UnplacedFix { kind: string; label: string; deepLink?: string; }
export interface UnplacedItem {
    section_id: string;
    course_id: string;
    course_code: string;
    course_title: string;
    section_number: string;
    expected_enrollment: number;
    department_id: string;
    lecture_hours: number;
    lab_hours: number;
    total_hours: number;
    eligible_faculty_count: number;
    eligible_faculty_source: string | null;
    reasons: UnplacedReason[];
    suggested_fixes: UnplacedFix[];
}

interface Props {
    items: UnplacedItem[];
    loading?: boolean;
    onRefresh?: () => void;
}

const REASON_COLOR: Record<string, string> = {
    NO_FACULTY:       'red',
    LOAD_CAPPED:      'orange',
    NO_LAB_ROOM:      'grape',
    NO_LECTURE_ROOM:  'grape',
    SLOTS_FULL:       'yellow',
};

/** Single draggable card — only used inside a parent DndContext. */
function UnplacedCard({ item }: { item: UnplacedItem }) {
    const navigate = useNavigate();
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `unplaced-${item.section_id}`,
        data: { kind: 'unplaced', section_id: item.section_id, course_code: item.course_code, total_hours: item.total_hours },
    });
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
                opacity: isDragging ? 0.6 : 1,
            }}
        >
            <Paper p="sm" radius="lg" withBorder
                style={{
                    borderColor: '#fecaca',
                    background: 'linear-gradient(180deg, #fff1f2 0%, #fff7ed 100%)',
                    cursor: 'grab',
                }}>
                <Group justify="space-between" gap={6} wrap="nowrap">
                    <Box style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                            <ActionIcon size="xs" variant="subtle" color="gray" {...listeners} {...attributes}
                                style={{ cursor: 'grab' }} title="Drag onto a free slot in the timetable">
                                <IconGripVertical size={14} />
                            </ActionIcon>
                            <Text fw={700} size="sm" truncate>{item.course_code}</Text>
                            <Badge size="xs" variant="light" color="indigo">{item.total_hours}h</Badge>
                            <Badge size="xs" variant="light" color="gray">§{item.section_number}</Badge>
                        </Group>
                        <Text size="xs" c="dimmed" truncate>{item.course_title}</Text>
                    </Box>
                </Group>

                {/* Reasons */}
                <Stack gap={4} mt={6}>
                    {item.reasons.map((r) => (
                        <Group gap={4} key={r.code} wrap="nowrap">
                            <Badge size="xs" variant="filled" color={REASON_COLOR[r.code] || 'red'}
                                style={{ flexShrink: 0 }}>
                                {r.code.replace(/_/g, ' ')}
                            </Badge>
                            <Text size="xs" c="dimmed">{r.label}</Text>
                        </Group>
                    ))}
                </Stack>

                {/* Suggested fixes */}
                {item.suggested_fixes.length > 0 && (
                    <Stack gap={4} mt={8}>
                        {item.suggested_fixes.map((f, i) => (
                            <Button
                                key={i}
                                size="compact-xs"
                                variant="light"
                                color="teal"
                                radius="lg"
                                leftSection={<IconArrowRight size={12} />}
                                onClick={() => f.deepLink && navigate(f.deepLink)}
                                styles={{ root: { justifyContent: 'flex-start', height: 'auto', padding: '4px 8px' }, label: { whiteSpace: 'normal', textAlign: 'left', fontSize: 11 } }}
                            >
                                {f.label}
                            </Button>
                        ))}
                    </Stack>
                )}
            </Paper>
        </div>
    );
}

export function UnplacedPanel({ items, loading, onRefresh }: Props) {
    const [collapsed, setCollapsed] = useState(false);
    const count = items?.length || 0;
    const grouped = useMemo(() => items || [], [items]);

    return (
        <Paper p="md" radius="xl" withBorder shadow="sm"
            style={{ borderColor: count > 0 ? '#fecaca' : 'rgba(16,185,129,0.35)' }}>
            <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap">
                    <ThemeIcon size={32} radius="xl"
                        color={count > 0 ? 'red' : 'teal'}
                        variant="light">
                        {count > 0 ? <IconAlertTriangle size={16} /> : <IconShieldCheck size={16} />}
                    </ThemeIcon>
                    <Box>
                        <Text fw={700} size="sm">
                            {count > 0
                                ? `${count} unplaced section${count === 1 ? '' : 's'}`
                                : 'All sections are scheduled'}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {count > 0
                                ? 'Drag a card onto an empty cell in the timetable, or apply a suggested fix.'
                                : 'Nothing to do — every section has at least one session.'}
                        </Text>
                    </Box>
                </Group>
                <Group gap={6} wrap="nowrap">
                    {onRefresh && (
                        <Tooltip label="Re-scan for unplaced sections">
                            <ActionIcon variant="subtle" color="gray" onClick={onRefresh} loading={loading}>
                                <IconRefresh size={15} />
                            </ActionIcon>
                        </Tooltip>
                    )}
                    {count > 0 && (
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setCollapsed((c) => !c)}>
                            {collapsed ? 'Show' : 'Hide'}
                        </Button>
                    )}
                </Group>
            </Group>

            {count > 0 && !collapsed && (
                <ScrollArea h={Math.min(420, 80 + count * 110)}>
                    <Stack gap="sm">
                        {grouped.map((it) => <UnplacedCard key={it.section_id} item={it} />)}
                    </Stack>
                </ScrollArea>
            )}
        </Paper>
    );
}
