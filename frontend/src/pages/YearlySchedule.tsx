/**
 * FR-15, FR-16, FR-17: Yearly Schedule
 * Shows courses for both semesters, grouped by curriculum year,
 * with a global yearly view.
 */
import { useState, useEffect } from 'react';
import {
    Container, Title, Text, Paper, Group, Stack, Select, Badge,
    Table, ThemeIcon, Box, Skeleton, Alert, Tabs, Accordion
} from '@mantine/core';
import { IconCalendarTime, IconAlertCircle } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';

interface Department { id: string; code: string; name: string; }
interface SessionItem {
    id: string; day: number; startSlot: string; duration: number;
    courseCode: string; courseTitle: string; curriculumYear: number;
    type: string; room: string; faculty: string;
}
interface SemesterGroup {
    semester_id: string; semester_name: string;
    by_year: Record<number, SessionItem[]>;
}
interface YearlyData { department_id: string; semesters: SemesterGroup[]; }

// const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
// const TYPE_COLORS: Record<string, string> = { LECTURE: 'blue', LAB: 'orange', COMBINED: 'teal' };

export function YearlySchedule() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [selectedDept, setSelectedDept] = useState<string | null>(null);
    const [data, setData] = useState<YearlyData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        apiClient.get('/catalog/departments').then(r => {
            setDepartments(r.data);
            if (r.data.length > 0) setSelectedDept(r.data[0].id);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (selectedDept) fetchYearly();
    }, [selectedDept]);

    const fetchYearly = async () => {
        if (!selectedDept) return;
        setIsLoading(true);
        try {
            const res = await apiClient.get(`/scheduling/yearly-schedule/${selectedDept}`);
            setData(res.data);
        } catch { setData(null); }
        finally { setIsLoading(false); }
    };

    const allYears = data
        ? [...new Set(data.semesters.flatMap(s => Object.keys(s.by_year).map(Number)))].sort()
        : [];

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group gap="md" align="center">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'grape', to: 'violet' }}>
                                <IconCalendarTime size={22} />
                            </ThemeIcon>
                            <Box>
                                <Title order={2}>Yearly Schedule</Title>
                                <Text c="dimmed" size="sm">Academic year view — both semesters grouped by curriculum year (FR-15, FR-16, FR-17)</Text>
                            </Box>
                        </Group>
                    </Paper>

                    <Select
                        label="Department"
                        placeholder="Select department..."
                        data={departments.map(d => ({ value: d.id, label: d.name }))}
                        value={selectedDept}
                        onChange={setSelectedDept}
                        style={{ maxWidth: 360 }}
                    />

                    {isLoading ? (
                        <Stack gap="sm">
                            {[1,2,3].map(i => <Skeleton key={i} height={80} radius="md" />)}
                        </Stack>
                    ) : !data || data.semesters.length === 0 ? (
                        <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md">
                            No schedule data found for this department. Generate a schedule first.
                        </Alert>
                    ) : (
                        <Tabs defaultValue={String(allYears[0] ?? 1)} variant="outline" radius="md">
                            <Tabs.List mb="md">
                                {allYears.map(yr => (
                                    <Tabs.Tab key={yr} value={String(yr)}>
                                        Year {yr}
                                    </Tabs.Tab>
                                ))}
                                <Tabs.Tab value="all">All Years</Tabs.Tab>
                            </Tabs.List>

                            {allYears.map(yr => (
                                <Tabs.Panel key={yr} value={String(yr)}>
                                    <Stack gap="md">
                                        {data.semesters.map(sem => {
                                            const sessions = sem.by_year[yr] || [];
                                            return (
                                                <Paper key={sem.semester_id} p="md" radius="xl" withBorder>
                                                    <Text fw={700} mb="sm">{sem.semester_name}</Text>
                                                    {sessions.length === 0 ? (
                                                        <Text c="dimmed" size="sm">No sessions for Year {yr} in this semester.</Text>
                                                    ) : (
                                                        <SessionTable sessions={sessions} />
                                                    )}
                                                </Paper>
                                            );
                                        })}
                                    </Stack>
                                </Tabs.Panel>
                            ))}

                            <Tabs.Panel value="all">
                                <Accordion variant="separated">
                                    {data.semesters.map(sem => (
                                        <Accordion.Item key={sem.semester_id} value={sem.semester_id}>
                                            <Accordion.Control>
                                                <Text fw={700}>{sem.semester_name}</Text>
                                            </Accordion.Control>
                                            <Accordion.Panel>
                                                {Object.entries(sem.by_year).sort(([a],[b]) => Number(a)-Number(b)).map(([yr, sessions]) => (
                                                    <Box key={yr} mb="md">
                                                        <Badge mb="sm" size="lg" variant="light" color="grape">Year {yr}</Badge>
                                                        <SessionTable sessions={sessions} />
                                                    </Box>
                                                ))}
                                            </Accordion.Panel>
                                        </Accordion.Item>
                                    ))}
                                </Accordion>
                            </Tabs.Panel>
                        </Tabs>
                    )}
                </Stack>
            </Container>
        </PageTransition>
    );
}

function SessionTable({ sessions }: { sessions: SessionItem[] }) {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const TYPE_COLORS: Record<string, string> = { LECTURE: 'blue', LAB: 'orange', COMBINED: 'teal' };
    const sorted = [...sessions].sort((a, b) => a.day - b.day || a.startSlot.localeCompare(b.startSlot));
    return (
        <Table striped highlightOnHover withTableBorder={false} fz="sm">
            <Table.Thead>
                <Table.Tr>
                    <Table.Th>Day</Table.Th>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Course</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Room</Table.Th>
                    <Table.Th>Faculty</Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {sorted.map(s => (
                    <Table.Tr key={s.id}>
                        <Table.Td>{DAYS[s.day]}</Table.Td>
                        <Table.Td fw={600}>{s.startSlot.slice(0, 5)}</Table.Td>
                        <Table.Td fw={700}>{s.courseCode}</Table.Td>
                        <Table.Td c="dimmed">{s.courseTitle}</Table.Td>
                        <Table.Td><Badge color={TYPE_COLORS[s.type] || 'gray'} size="xs">{s.type}</Badge></Table.Td>
                        <Table.Td>{s.room}</Table.Td>
                        <Table.Td>{s.faculty}</Table.Td>
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}
