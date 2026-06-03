import { Paper, Text, Group, Badge, ThemeIcon } from '@mantine/core';
import { IconMapPin, IconUser, IconClock } from '@tabler/icons-react';
import { motion } from 'framer-motion';

/** "90 min" → "1h 30m"  ·  "60 min" → "1h"  ·  "45 min" → "45m" */
function fmtDuration(min: number): string {
    if (!min || min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}

interface SessionCardProps {
    id?: string;
    courseCode: string;
    type: 'LECTURE' | 'LAB' | 'COMBINED';
    room: string;
    faculty: string;
    duration: number;
    color?: string;
}

const TYPE_COLORS = {
    LECTURE: '#4c6ef5',
    LAB: '#12b886',
    COMBINED: '#fab005',
};

// A small, well-distributed palette. We hash the department prefix to one of these
// so every session of a department renders in the same colour, deterministically.
const DEPT_PALETTE = [
    '#4c6ef5', '#fa5252', '#12b886', '#fab005', '#7950f2', '#e64980',
    '#15aabf', '#fd7e14', '#82c91e', '#228be6', '#be4bdb', '#40c057',
    '#f06595', '#5c7cfa', '#20c997', '#ff922b', '#845ef7',
];

function deptColor(courseCode: string): string {
    const prefix = (courseCode.match(/^[A-Z]+/)?.[0] ?? courseCode).toUpperCase();
    let h = 0;
    for (const ch of prefix) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return DEPT_PALETTE[h % DEPT_PALETTE.length];
}

function hexToRgba(hex: string, alpha: number): string {
    const m = hex.replace('#', '');
    const n = parseInt(m, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

export function SessionCard({ id, courseCode, type, room, faculty, duration }: SessionCardProps) {
    const isSmall = duration <= 60;
    const dept = deptColor(courseCode);
    const accent = TYPE_COLORS[type] || dept;

    return (
        <motion.div
            layoutId={id}
            whileHover={{ scale: 1.02, y: -1 }}
            transition={{ duration: 0.15 }}
            style={{ height: '100%' }}
        >
            <Paper
                p="xs"
                shadow="xs"
                radius="md"
                withBorder
                style={{
                    height: '100%',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    borderLeft: `4px solid ${accent}`,
                    backgroundImage: `linear-gradient(135deg, ${hexToRgba(dept, 0.08)} 0%, ${hexToRgba(dept, 0.02)} 100%)`,
                    backgroundColor: '#fff',
                    cursor: 'grab',
                }}
            >
                <Group justify="space-between" align="start" gap={4} wrap="nowrap">
                    <Text fw={700} size="sm" style={{ lineHeight: 1.2, color: dept }}>
                        {courseCode}
                    </Text>
                    <Group gap={3} wrap="nowrap">
                        <Badge
                            size="xs"
                            variant="light"
                            color={type === 'LAB' ? 'teal' : type === 'COMBINED' ? 'yellow' : 'indigo'}
                        >
                            {type.substring(0, 3)}
                        </Badge>
                        <Badge size="xs" variant="filled" color="gray"
                            leftSection={<IconClock size={9} stroke={2.5} />}
                            title={`${duration} minutes`}
                            style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmtDuration(duration)}
                        </Badge>
                    </Group>
                </Group>

                {!isSmall && (
                    <div style={{ marginTop: 'auto' }}>
                        <Group gap={4} wrap="nowrap">
                            <ThemeIcon size="xs" variant="transparent" color="gray">
                                <IconMapPin size={12} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" truncate>{room}</Text>
                        </Group>
                        <Group gap={4} wrap="nowrap" mt={2}>
                            <ThemeIcon size="xs" variant="transparent" color="gray">
                                <IconUser size={12} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" truncate>{faculty}</Text>
                        </Group>
                    </div>
                )}
            </Paper>
        </motion.div>
    );
}
