/**
 * FR-25, FR-26: Faculty Personal Schedule
 * Shows a week-view schedule for a selected faculty member,
 * respecting combined lecture/lab sessions and the "one day off" rule.
 */
import { useState, useEffect, useMemo } from 'react';
import {
    Container, Title, Text, Paper, Group, Stack, Select, Badge,
    Table, ThemeIcon, Box, Skeleton, Alert, SimpleGrid, SegmentedControl,
} from '@mantine/core';
import {
    IconUser, IconAlertCircle, IconCheck, IconCalendarTime, IconLayoutGrid, IconList,
    IconMapPin, IconClock,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { WeekView } from '../components/Calendar/WeekView';

interface FacultyItem { id: string; first_name: string; last_name: string; rank: string; department_id: string; }
interface Semester { id: string; name: string; is_active: boolean; }
interface ScheduleItem {
    id: string; day: number; dayName: string; startSlot: string;
    duration: number; courseCode: string; courseTitle: string;
    type: string; room: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TYPE_COLORS: Record<string, string> = { LECTURE: 'blue', LAB: 'orange', COMBINED: 'teal' };

export function FacultySchedule() {
    const [faculty, setFaculty] = useState<FacultyItem[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null);
    const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
    const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInit, setIsInit] = useState(true);
    // Persist the user's preferred view mode across reloads.
    const [view, setView] = useState<'calendar' | 'grid' | 'list'>(
        (typeof localStorage !== 'undefined' && (localStorage.getItem('fs.view') as any)) || 'calendar'
    );
    useEffect(() => { try { localStorage.setItem('fs.view', view); } catch {} }, [view]);

    useEffect(() => {
        const init = async () => {
            try {
                const [fRes, sRes] = await Promise.all([
                    apiClient.get('/catalog/faculty'),
                    apiClient.get('/scheduling/semesters'),
                ]);
                setFaculty(fRes.data);
                setSemesters(sRes.data);
                const active = sRes.data.find((s: Semester) => s.is_active) || sRes.data[0];
                if (active) setSelectedSemester(active.id);
            } catch { }
            finally { setIsInit(false); }
        };
        init();
    }, []);

    useEffect(() => {
        if (selectedFaculty && selectedSemester) fetchSchedule();
    }, [selectedFaculty, selectedSemester]);

    const fetchSchedule = async () => {
        if (!selectedFaculty || !selectedSemester) return;
        setIsLoading(true);
        try {
            const res = await apiClient.get(`/scheduling/faculty-schedule/${selectedFaculty}/${selectedSemester}`);
            setSchedule(res.data);
        } catch { setSchedule([]); }
        finally { setIsLoading(false); }
    };

    // Group by day
    const byDay: Record<number, ScheduleItem[]> = {};
    for (const item of schedule) {
        if (!byDay[item.day]) byDay[item.day] = [];
        byDay[item.day].push(item);
    }

    const scheduledDays = Object.keys(byDay).map(Number);
    const daysOff = DAYS.filter((_, i) => !scheduledDays.includes(i));
    const selectedFacultyObj = faculty.find(f => f.id === selectedFaculty);
    const facultyName = selectedFacultyObj
        ? `${selectedFacultyObj.first_name} ${selectedFacultyObj.last_name}`
        : '';

    // Reshape into the format WeekView wants for the Calendar view.
    const calendarEvents = useMemo(() => schedule.map(s => ({
        id: s.id,
        day: s.day,
        startSlot: s.startSlot,
        duration: s.duration,
        courseCode: s.courseCode,
        type: (s.type === 'LECTURE' || s.type === 'LAB' || s.type === 'COMBINED' ? s.type : 'LECTURE') as 'LECTURE' | 'LAB' | 'COMBINED',
        room: s.room,
        faculty: facultyName,
        roomType: '',
    })), [schedule, facultyName]);

    // Sorted-by-time list of every session, for the Grid + List views.
    const sortedAll = useMemo(() => [...schedule].sort((a, b) =>
        a.day - b.day || a.startSlot.localeCompare(b.startSlot)
    ), [schedule]);

    // Total weekly minutes — handy stat for the header.
    const totalMinutes = schedule.reduce((s, x) => s + (x.duration || 0), 0);

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group gap="md" align="center">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                <IconUser size={22} />
                            </ThemeIcon>
                            <Box>
                                <Title order={2}>Faculty Personal Schedule</Title>
                                <Text c="dimmed" size="sm">View the personal teaching schedule for each instructor (FR-25, FR-26)</Text>
                            </Box>
                        </Group>
                    </Paper>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Select
                            label="Select Faculty Member"
                            placeholder="Choose a faculty member..."
                            data={faculty.map(f => ({ value: f.id, label: `${f.first_name} ${f.last_name} (${f.rank})` }))}
                            value={selectedFaculty}
                            onChange={setSelectedFaculty}
                            searchable
                            disabled={isInit}
                        />
                        <Select
                            label="Select Semester"
                            placeholder="Choose a semester..."
                            data={semesters.map(s => ({ value: s.id, label: s.name + (s.is_active ? ' (Active)' : '') }))}
                            value={selectedSemester}
                            onChange={setSelectedSemester}
                            disabled={isInit}
                        />
                    </SimpleGrid>

                    {selectedFaculty && selectedSemester && (
                        <>
                            {/* Summary strip */}
                            {!isLoading && schedule.length > 0 && (
                                <Paper p="md" radius="xl" withBorder shadow="sm">
                                    <Group justify="space-between" wrap="wrap">
                                        <Group gap="lg" wrap="wrap">
                                            <Stat label="Sessions" value={String(schedule.length)} />
                                            <Stat label="Weekly hours" value={`${(totalMinutes / 60).toFixed(1)}h`} />
                                            <Stat label="Teaching days" value={`${scheduledDays.length} / 5`} />
                                            <Stat label="Day(s) off" value={daysOff.length ? daysOff.join(', ') : '—'} />
                                        </Group>
                                        <Group gap="sm">
                                            <IconCheck size={16} color={daysOff.length ? '#16a34a' : '#f97316'} />
                                            <Text size="sm" fw={600} c={daysOff.length ? 'teal' : 'orange'}>
                                                {daysOff.length ? 'FR-22 satisfied' : 'No day off — review!'}
                                            </Text>
                                        </Group>
                                    </Group>
                                </Paper>
                            )}

                            {/* View toggle */}
                            <Group justify="space-between" wrap="wrap">
                                <Text size="sm" c="dimmed">
                                    Showing {schedule.length} session{schedule.length === 1 ? '' : 's'} for{' '}
                                    <strong>{facultyName}</strong>.
                                </Text>
                                <SegmentedControl
                                    value={view}
                                    onChange={(v) => setView(v as any)}
                                    radius="lg"
                                    data={[
                                        { value: 'calendar', label: (
                                            <Group gap={4} wrap="nowrap"><IconCalendarTime size={14} /><span>Calendar</span></Group>
                                        ) },
                                        { value: 'grid', label: (
                                            <Group gap={4} wrap="nowrap"><IconLayoutGrid size={14} /><span>Grid</span></Group>
                                        ) },
                                        { value: 'list', label: (
                                            <Group gap={4} wrap="nowrap"><IconList size={14} /><span>List</span></Group>
                                        ) },
                                    ]}
                                />
                            </Group>

                            {isLoading ? (
                                <Stack gap="sm">
                                    {[1,2,3].map(i => <Skeleton key={i} height={60} radius="md" />)}
                                </Stack>
                            ) : schedule.length === 0 ? (
                                <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md">
                                    No sessions scheduled for this faculty member in the selected semester.
                                </Alert>
                            ) : view === 'calendar' ? (
                                // ── Calendar view: drop-into-WeekView, read-only ─────────────
                                <Paper p="lg" radius="xl" withBorder shadow="sm">
                                    <WeekView events={calendarEvents} />
                                </Paper>
                            ) : view === 'grid' ? (
                                // ── Grid view: one card per session ──────────────────────────
                                <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
                                    {sortedAll.map(s => (
                                        <Paper key={s.id} p="md" radius="xl" withBorder shadow="sm"
                                            style={{ borderLeft: `4px solid ${
                                                s.type === 'LAB' ? '#12b886' :
                                                s.type === 'COMBINED' ? '#fab005' : '#4c6ef5'
                                            }`}}>
                                            <Group justify="space-between" mb={4}>
                                                <Text fw={800} size="lg">{s.courseCode}</Text>
                                                <Badge color={TYPE_COLORS[s.type] || 'gray'} variant="light" size="sm">
                                                    {s.type}
                                                </Badge>
                                            </Group>
                                            <Text size="xs" c="dimmed" lineClamp={1}>{s.courseTitle}</Text>
                                            <Group gap={6} mt="sm">
                                                <IconCalendarTime size={14} color="#475569" />
                                                <Text size="sm" fw={600}>{DAYS[s.day]}</Text>
                                                <Text size="sm" c="dimmed">·</Text>
                                                <Text size="sm" fw={600}>{s.startSlot.slice(0,5)}</Text>
                                            </Group>
                                            <Group gap={6} mt={4}>
                                                <IconClock size={13} color="#475569" />
                                                <Text size="xs" c="dimmed">
                                                    {s.duration >= 60
                                                        ? `${Math.floor(s.duration/60)}h${s.duration%60 ? ` ${s.duration%60}m` : ''}`
                                                        : `${s.duration}m`}
                                                </Text>
                                            </Group>
                                            <Group gap={6} mt={4}>
                                                <IconMapPin size={13} color="#475569" />
                                                <Text size="xs" c="dimmed" truncate>{s.room}</Text>
                                            </Group>
                                        </Paper>
                                    ))}
                                </SimpleGrid>
                            ) : (
                                // ── List view: single sortable table, all days at once ───────
                                <Paper p="md" radius="xl" withBorder shadow="sm">
                                    <Table striped highlightOnHover>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Day</Table.Th>
                                                <Table.Th>Time</Table.Th>
                                                <Table.Th>Course</Table.Th>
                                                <Table.Th>Title</Table.Th>
                                                <Table.Th>Type</Table.Th>
                                                <Table.Th>Room</Table.Th>
                                                <Table.Th>Duration</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {sortedAll.map(s => (
                                                <Table.Tr key={s.id}>
                                                    <Table.Td fw={600}>{DAYS[s.day]}</Table.Td>
                                                    <Table.Td fw={600}>{s.startSlot.slice(0, 5)}</Table.Td>
                                                    <Table.Td fw={700}>{s.courseCode}</Table.Td>
                                                    <Table.Td c="dimmed">{s.courseTitle}</Table.Td>
                                                    <Table.Td>
                                                        <Badge color={TYPE_COLORS[s.type] || 'gray'} size="sm">{s.type}</Badge>
                                                    </Table.Td>
                                                    <Table.Td>{s.room}</Table.Td>
                                                    <Table.Td>{s.duration} min</Table.Td>
                                                </Table.Tr>
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                </Paper>
                            )}
                        </>
                    )}
                </Stack>
            </Container>
        </PageTransition>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
            <Text fw={600}>{value}</Text>
        </Box>
    );
}
