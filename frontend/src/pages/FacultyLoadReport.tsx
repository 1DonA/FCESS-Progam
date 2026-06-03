/**
 * FR-6, FR-13: Faculty Load Report
 * Shows teaching load per faculty, highlights overloads,
 * filterable by department and semester.
 */
import { useState, useEffect } from 'react';
import {
    Container, Title, Text, Paper, Group, Stack, Select, Badge,
    Table, ThemeIcon, Box, Skeleton, Progress, Alert, SimpleGrid
} from '@mantine/core';
import { IconUsers, IconAlertTriangle, IconAlertCircle } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';

interface Department { id: string; code: string; name: string; }
interface Semester { id: string; name: string; is_active: boolean; }
interface LoadEntry {
    faculty_id: string; name: string; rank: string; department_id: string;
    max_load_hours: number; current_load_hours: number; sessions_count: number;
    is_overloaded: boolean; utilization_pct: number;
}

export function FacultyLoadReport() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedDept, setSelectedDept] = useState<string | null>(null);
    const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
    const [report, setReport] = useState<LoadEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInit, setIsInit] = useState(true);

    useEffect(() => {
        const init = async () => {
            try {
                const [dRes, sRes] = await Promise.all([
                    apiClient.get('/catalog/departments'),
                    apiClient.get('/scheduling/semesters'),
                ]);
                setDepartments(dRes.data);
                setSemesters(sRes.data);
                const active = sRes.data.find((s: Semester) => s.is_active) || sRes.data[0];
                if (active) setSelectedSemester(active.id);
            } catch { }
            finally { setIsInit(false); }
        };
        init();
    }, []);

    useEffect(() => {
        if (selectedSemester) fetchReport();
    }, [selectedSemester, selectedDept]);

    const fetchReport = async () => {
        if (!selectedSemester) return;
        setIsLoading(true);
        try {
            const params = selectedDept ? `?department_id=${selectedDept}` : '';
            const res = await apiClient.get(`/scheduling/faculty-load/${selectedSemester}${params}`);
            setReport(res.data);
        } catch { setReport([]); }
        finally { setIsLoading(false); }
    };

    const overloadedCount = report.filter(r => r.is_overloaded).length;

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group gap="md" align="center">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'teal', to: 'cyan' }}>
                                <IconUsers size={22} />
                            </ThemeIcon>
                            <Box>
                                <Title order={2}>Faculty Load Report</Title>
                                <Text c="dimmed" size="sm">Track teaching loads and detect overloads (FR-6, FR-13)</Text>
                            </Box>
                        </Group>
                    </Paper>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Select
                            label="Semester"
                            placeholder="Select semester..."
                            data={semesters.map(s => ({ value: s.id, label: s.name + (s.is_active ? ' (Active)' : '') }))}
                            value={selectedSemester}
                            onChange={setSelectedSemester}
                            disabled={isInit}
                        />
                        <Select
                            label="Department (optional)"
                            placeholder="All departments"
                            data={[{ value: '', label: 'All Departments' }, ...departments.map(d => ({ value: d.id, label: d.name }))]}
                            value={selectedDept ?? ''}
                            onChange={v => setSelectedDept(v || null)}
                            disabled={isInit}
                            clearable
                        />
                    </SimpleGrid>

                    {overloadedCount > 0 && (
                        <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md" title="Overload Warning">
                            {overloadedCount} faculty member{overloadedCount > 1 ? 's are' : ' is'} assigned beyond their maximum teaching load.
                        </Alert>
                    )}

                    {isLoading ? (
                        <Stack gap="sm">
                            {[1,2,3,4,5].map(i => <Skeleton key={i} height={50} radius="md" />)}
                        </Stack>
                    ) : report.length === 0 ? (
                        <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md">
                            No faculty data found for the selected filters.
                        </Alert>
                    ) : (
                        <Paper p="md" radius="xl" withBorder shadow="sm">
                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Faculty</Table.Th>
                                        <Table.Th>Rank</Table.Th>
                                        <Table.Th>Sessions</Table.Th>
                                        <Table.Th>Load (hrs)</Table.Th>
                                        <Table.Th>Max (hrs)</Table.Th>
                                        <Table.Th style={{ minWidth: 140 }}>Utilization</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {report.map(r => (
                                        <Table.Tr key={r.faculty_id} style={r.is_overloaded ? { background: 'rgba(239,68,68,0.06)' } : {}}>
                                            <Table.Td fw={600}>{r.name}</Table.Td>
                                            <Table.Td><Badge variant="outline" size="sm">{r.rank}</Badge></Table.Td>
                                            <Table.Td>{r.sessions_count}</Table.Td>
                                            <Table.Td>{r.current_load_hours.toFixed(1)}</Table.Td>
                                            <Table.Td>{r.max_load_hours.toFixed(1)}</Table.Td>
                                            <Table.Td>
                                                <Group gap="xs">
                                                    <Progress
                                                        value={Math.min(r.utilization_pct, 100)}
                                                        color={r.is_overloaded ? 'red' : r.utilization_pct > 80 ? 'orange' : 'teal'}
                                                        size="sm"
                                                        style={{ flex: 1, minWidth: 80 }}
                                                    />
                                                    <Text size="xs" c="dimmed">{r.utilization_pct}%</Text>
                                                </Group>
                                            </Table.Td>
                                            <Table.Td>
                                                {r.is_overloaded ? (
                                                    <Badge color="red" size="sm">Overloaded</Badge>
                                                ) : r.sessions_count === 0 ? (
                                                    <Badge color="gray" size="sm">Unassigned</Badge>
                                                ) : (
                                                    <Badge color="teal" size="sm">OK</Badge>
                                                )}
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
