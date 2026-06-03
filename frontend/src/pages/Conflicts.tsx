/**
 * FR-12, FR-14: Conflict Detection & Validation
 * Scans a semester schedule for faculty double-bookings and room conflicts.
 */
import { useState, useEffect } from 'react';
import {
    Container, Title, Text, Paper, Group, Stack, Select, Badge,
    Table, ThemeIcon, Box, Skeleton, Alert, Button
} from '@mantine/core';
import { IconAlertTriangle, IconShieldCheck, IconSearch, IconRefresh, IconHelpCircle } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { errMsg, toast, confirm } from '../lib/feedback';

interface Semester { id: string; name: string; is_active: boolean; }
interface Conflict {
    type: string; description: string; session_a: string; session_b: string;
    course_a: string; course_b: string; day: number; start_slot: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function Conflicts() {
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<Conflict[]>([]);
    const [conflictCount, setConflictCount] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [isFixing, setIsFixing] = useState(false);

    useEffect(() => {
        apiClient.get('/scheduling/semesters').then(r => {
            setSemesters(r.data);
            const active = r.data.find((s: Semester) => s.is_active) || r.data[0];
            if (active) setSelectedSemester(active.id);
        }).catch((e) => toast.error(errMsg(e, 'Could not load semesters.')));
    }, []);

    const handleScan = async () => {
        if (!selectedSemester) return;
        setIsLoading(true);
        setHasSearched(false);
        try {
            const res = await apiClient.get(`/scheduling/conflicts/${selectedSemester}`);
            setConflicts(res.data.conflicts);
            setConflictCount(res.data.conflict_count);
            setHasSearched(true);
            if (res.data.conflict_count === 0) {
                toast.success('No conflicts detected.');
            } else {
                toast.warn(`${res.data.conflict_count} conflict(s) detected.`);
            }
        } catch (e) {
            toast.error(errMsg(e, 'Could not scan for conflicts.'));
            setConflicts([]);
            setConflictCount(0);
        } finally { setIsLoading(false); }
    };

    const explainConflict = (c: Conflict) => {
        const FR_MAP: Record<string, string> = {
            FACULTY_DOUBLE_BOOK: 'FR-10 / FR-23',
            ROOM_DOUBLE_BOOK:    'FR-19',
            PREREQUISITE:        'FR-18',
            FACULTY_LOAD:        'FR-7',
            DAY_OFF:             'FR-22',
        };
        const fr = FR_MAP[c.type] || 'FR-12';
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
        const dayName = days[c.day] || String(c.day);
        const timeStr = (c.start_slot || '').slice(0, 5);
        void confirm({
            title: `Why is this a conflict? (${fr})`,
            confirmLabel: 'Got it',
            cancelLabel: 'Close',
            body: (
                <div style={{ fontSize: 14, lineHeight: 1.55 }}>
                    <p><strong>Rule violated:</strong> {fr}</p>
                    <p style={{ marginTop: 8 }}><strong>What the rule says:</strong></p>
                    <p style={{ margin: '4px 0 0 0', color: '#475569' }}>
                        {c.type === 'FACULTY_DOUBLE_BOOK' && 'A faculty member cannot be assigned to two or more courses in the same time slot.'}
                        {c.type === 'ROOM_DOUBLE_BOOK'    && 'A classroom cannot be allocated to two course sessions at the same time.'}
                        {c.type === 'PREREQUISITE'       && 'Courses with prerequisites may share a time slot across the two semesters, but cannot be taught by the same lecturer.'}
                        {!['FACULTY_DOUBLE_BOOK','ROOM_DOUBLE_BOOK','PREREQUISITE'].includes(c.type) &&
                            'The scheduler detected a scheduling overlap that violates a department-level rule.'}
                    </p>
                    <p style={{ marginTop: 8 }}><strong>What is colliding:</strong></p>
                    <p style={{ margin: '4px 0 0 0', color: '#475569' }}>{c.description}</p>
                    <p style={{ marginTop: 8 }}><strong>When:</strong> {dayName} at {timeStr}</p>
                    <p style={{ marginTop: 8 }}><strong>How to fix:</strong></p>
                    <ul style={{ margin: '4px 0 0 18px', color: '#475569' }}>
                        <li>Drag <code>{c.course_a}</code> or <code>{c.course_b}</code> to a different slot in the weekly timetable.</li>
                        <li>Or click <strong>Auto-fix conflicts</strong> above to regenerate the schedule from scratch.</li>
                    </ul>
                </div>
            ),
        });
    };

    /** Auto-fix: clear all sessions for the semester then run CP-SAT,
        then re-scan for any remaining conflicts. */
    const handleAutoFix = async () => {
        if (!selectedSemester) return;
        setIsFixing(true);
        try {
            // 1. clear existing sessions
            await apiClient.delete(`/scheduling/clear/${selectedSemester}`);
            toast.info ? toast.info('Existing sessions cleared.') : toast.success('Existing sessions cleared.');
            // 2. run CP-SAT solver
            const res = await apiClient.post(`/scheduling/generate/${selectedSemester}`);
            const data: any = res.data;
            if (data?.error) {
                toast.error(data.error);
            } else {
                toast.success(`Re-generated ${data?.success ?? 0} session(s)${data?.failed ? `, ${data.failed} could not be placed` : ''}.`);
            }
            // 3. re-scan
            await handleScan();
        } catch (e) {
            toast.error(errMsg(e, 'Could not auto-fix conflicts.'));
        } finally { setIsFixing(false); }
    };

    // Automatic conflict detection — re-scan whenever the semester changes.
    useEffect(() => {
        if (selectedSemester) void handleScan();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSemester]);

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(255,240,240,0.98) 100%)' }}>
                        <Group gap="md" align="center">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'red', to: 'orange' }}>
                                <IconAlertTriangle size={22} />
                            </ThemeIcon>
                            <Box>
                                <Title order={2}>Conflict Detection</Title>
                                <Text c="dimmed" size="sm">Automatically scans the chosen semester for faculty double-bookings and room conflicts.</Text>
                            </Box>
                        </Group>
                    </Paper>

                    <Group gap="md">
                        <Select
                            label="Semester"
                            placeholder="Select semester..."
                            data={semesters.map(s => ({ value: s.id, label: s.name + (s.is_active ? ' (Active)' : '') }))}
                            value={selectedSemester}
                            onChange={setSelectedSemester}
                            style={{ minWidth: 280 }}
                        />
                        <Button
                            mt="xl"
                            leftSection={<IconSearch size={16} />}
                            onClick={handleScan}
                            loading={isLoading}
                            disabled={!selectedSemester}
                            variant="gradient"
                            gradient={{ from: 'red', to: 'orange' }}
                        >
                            Re-scan
                        </Button>
                        <Button
                            mt="xl"
                            leftSection={<IconRefresh size={16} />}
                            onClick={handleAutoFix}
                            loading={isFixing}
                            disabled={!selectedSemester}
                            variant="gradient"
                            gradient={{ from: 'teal', to: 'lime' }}
                        >
                            Auto-fix conflicts
                        </Button>
                    </Group>

                    {hasSearched && (
                        conflictCount === 0 ? (
                            <Alert icon={<IconShieldCheck size={16} />} color="teal" radius="md" title="No conflicts found">
                                The schedule is conflict-free for the selected semester.
                            </Alert>
                        ) : (
                            <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md" title={`${conflictCount} conflict(s) found`}>
                                Please resolve the conflicts below before publishing the schedule.
                            </Alert>
                        )
                    )}

                    {isLoading ? (
                        <Stack gap="sm">
                            {[1,2,3].map(i => <Skeleton key={i} height={50} radius="md" />)}
                        </Stack>
                    ) : conflicts.length > 0 && (
                        <Paper p="md" radius="xl" withBorder shadow="sm">
                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Type</Table.Th>
                                        <Table.Th>Description</Table.Th>
                                        <Table.Th>Day</Table.Th>
                                        <Table.Th>Time</Table.Th>
                                        <Table.Th>Course A</Table.Th>
                                        <Table.Th>Course B</Table.Th>
                                        <Table.Th style={{ width: 60 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {conflicts.map((c, i) => (
                                        <Table.Tr key={i} style={{ background: 'rgba(239,68,68,0.06)' }}>
                                            <Table.Td>
                                                <Badge color={c.type === 'FACULTY_DOUBLE_BOOK' ? 'red' : 'orange'} size="sm">
                                                    {c.type === 'FACULTY_DOUBLE_BOOK' ? 'Faculty' : 'Room'}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td>{c.description}</Table.Td>
                                            <Table.Td>{DAYS[c.day] || c.day}</Table.Td>
                                            <Table.Td>{c.start_slot.slice(0, 5)}</Table.Td>
                                            <Table.Td fw={600}>{c.course_a}</Table.Td>
                                            <Table.Td fw={600}>{c.course_b}</Table.Td>
                                            <Table.Td>
                                                <Button size="xs" variant="subtle" color="red" leftSection={<IconHelpCircle size={14} />} onClick={() => explainConflict(c)}>Why?</Button>
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
