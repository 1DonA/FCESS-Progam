/**
 * Part 2, FR-6 (classroom): Room Utilization Report
 * Shows classroom usage statistics per semester.
 */
import { useState, useEffect } from 'react';
import {
    Container, Title, Text, Paper, Group, Stack, Select, Badge,
    Table, ThemeIcon, Box, Skeleton, Alert, Progress
} from '@mantine/core';
import { IconDoor, IconAlertCircle } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';

interface Semester { id: string; name: string; is_active: boolean; }
interface RoomReport {
    room_id: string; room_number: string; building: string;
    type: string; capacity: number; total_sessions: number;
    total_hours_scheduled: number; utilization_pct: number;
}

const ROOM_TYPE_COLORS: Record<string, string> = { LECTURE_HALL: 'blue', LAB: 'orange', SEMINAR: 'teal' };

export function RoomUtilization() {
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
    const [report, setReport] = useState<RoomReport[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        apiClient.get('/scheduling/semesters').then(r => {
            setSemesters(r.data);
            const active = r.data.find((s: Semester) => s.is_active) || r.data[0];
            if (active) setSelectedSemester(active.id);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (selectedSemester) fetchReport();
    }, [selectedSemester]);

    const fetchReport = async () => {
        if (!selectedSemester) return;
        setIsLoading(true);
        try {
            const res = await apiClient.get(`/scheduling/room-utilization/${selectedSemester}`);
            setReport(res.data.rooms);
        } catch { setReport([]); }
        finally { setIsLoading(false); }
    };

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(255,247,237,0.98) 100%)' }}>
                        <Group gap="md" align="center">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'orange', to: 'yellow' }}>
                                <IconDoor size={22} />
                            </ThemeIcon>
                            <Box>
                                <Title order={2}>Classroom Utilization</Title>
                                <Text c="dimmed" size="sm">Room usage statistics per semester — Part 2 classroom scheduling</Text>
                            </Box>
                        </Group>
                    </Paper>

                    <Select
                        label="Semester"
                        placeholder="Select semester..."
                        data={semesters.map(s => ({ value: s.id, label: s.name + (s.is_active ? ' (Active)' : '') }))}
                        value={selectedSemester}
                        onChange={setSelectedSemester}
                        style={{ maxWidth: 360 }}
                    />

                    {isLoading ? (
                        <Stack gap="sm">
                            {[1,2,3,4].map(i => <Skeleton key={i} height={50} radius="md" />)}
                        </Stack>
                    ) : report.length === 0 ? (
                        <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md">
                            No room data found. Add classrooms and generate a schedule first.
                        </Alert>
                    ) : (
                        <Paper p="md" radius="xl" withBorder shadow="sm">
                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Room</Table.Th>
                                        <Table.Th>Building</Table.Th>
                                        <Table.Th>Type</Table.Th>
                                        <Table.Th>Capacity</Table.Th>
                                        <Table.Th>Sessions</Table.Th>
                                        <Table.Th>Hours Scheduled</Table.Th>
                                        <Table.Th style={{ minWidth: 160 }}>Utilization</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {report.sort((a, b) => b.utilization_pct - a.utilization_pct).map(r => (
                                        <Table.Tr key={r.room_id}>
                                            <Table.Td fw={700}>{r.room_number}</Table.Td>
                                            <Table.Td>{r.building}</Table.Td>
                                            <Table.Td>
                                                <Badge color={ROOM_TYPE_COLORS[r.type] || 'gray'} size="sm">{r.type}</Badge>
                                            </Table.Td>
                                            <Table.Td>{r.capacity}</Table.Td>
                                            <Table.Td>{r.total_sessions}</Table.Td>
                                            <Table.Td>{r.total_hours_scheduled}h</Table.Td>
                                            <Table.Td>
                                                <Group gap="xs">
                                                    <Progress
                                                        value={Math.min(r.utilization_pct, 100)}
                                                        color={r.utilization_pct > 80 ? 'red' : r.utilization_pct > 50 ? 'orange' : 'teal'}
                                                        size="sm"
                                                        style={{ flex: 1, minWidth: 80 }}
                                                    />
                                                    <Text size="xs" c="dimmed">{r.utilization_pct}%</Text>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Paper>
                    )}
                </Stack>
            </Container>
        </PageTransition>
    );
}
