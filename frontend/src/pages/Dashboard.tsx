import { useState, useEffect } from 'react';
import { Box, Container, Title, Button, Text, Paper, Group, Stack, Code, SimpleGrid, ThemeIcon, Skeleton, Modal, Badge } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { IconCheck, IconX, IconBook, IconUsers, IconDoor, IconBuildingSkyscraper, IconCalendarTime, IconTrash, IconWand, IconAlertTriangle, IconShieldCheck, IconRefresh } from '@tabler/icons-react';
import { WeekView } from '../components/Calendar/WeekView';
import { PageTransition } from '../components/Layout/PageTransition';
import { FacultyLoadCard } from '../components/Dashboard/FacultyLoadCard';
import { CurriculumCoverageCard } from '../components/Dashboard/CurriculumCoverageCard';
import { UnplacedPanel, type UnplacedItem } from '../components/Scheduling/UnplacedPanel';
import { DeleteAllButton } from '../lib/DeleteAllButton';
import { confirm, errMsg, toast } from '../lib/feedback';
import { motion } from 'framer-motion';

interface Stats { departments: number; courses: number; faculty: number; rooms: number; semesters: number; }

function StatCard({ title, value, icon, color, loading }: { title: string; value: number; icon: React.ReactNode; color: string; loading: boolean }) {
    return (
        <motion.div whileHover={{ y: -4, transition: { duration: 0.2 } }}>
            <Paper p="md" radius="xl" withBorder shadow="sm" style={{ height: '100%' }}>
                <Group justify="space-between" align="flex-start">
                    <Box>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{title}</Text>
                        {loading ? <Skeleton height={28} width={50} mt={4} radius="md"/> : <Text size="xl" fw={700} mt={4}>{value}</Text>}
                    </Box>
                    <ThemeIcon color={color} variant="light" size={48} radius="xl">{icon}</ThemeIcon>
                </Group>
            </Paper>
        </motion.div>
    );
}

export function Dashboard() {
    const navigate = useNavigate();
    const [semesterId, setSemesterId] = useState<string>('');
    const [result, setResult] = useState<any>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [sessionModal, setSessionModal] = useState<any | null>(null);
    const [conflictCount, setConflictCount] = useState<number>(0);
    const [loadRefreshKey, setLoadRefreshKey] = useState<number>(0);
    const [isResolving, setIsResolving] = useState(false);
    const [stats, setStats] = useState<Stats>({ departments: 0, courses: 0, faculty: 0, rooms: 0, semesters: 0 });
    const [statsLoading, setStatsLoading] = useState(true);
    const [unplaced, setUnplaced] = useState<UnplacedItem[]>([]);
    const [unplacedLoading, setUnplacedLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        fetchStats();
        fetchActiveSemester();
        // Live updates: re-poll dashboard every 60s so the active conflict count
        // / unplaced bucket stays fresh while the chair is on the page.
        const id = setInterval(() => {
            void fetchStats();
            if (semesterId) {
                void fetchConflicts(semesterId);
                void fetchUnplaced(semesterId);
            }
            setLoadRefreshKey((k) => k + 1);
        }, 60_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [semesterId]);

    const fetchStats = async () => {
        setStatsLoading(true);
        try {
            const [dRes, cRes, fRes, rRes, sRes] = await Promise.all([
                apiClient.get('/catalog/departments'),
                apiClient.get('/catalog/courses'),
                apiClient.get('/catalog/faculty'),
                apiClient.get('/catalog/rooms'),
                apiClient.get('/scheduling/semesters'),
            ]);
            setStats({
                departments: dRes.data.length,
                courses: cRes.data.length,
                faculty: fRes.data.length,
                rooms: rRes.data.length,
                semesters: sRes.data.length,
            });
            // Auto-select active or first semester
            const active = sRes.data.find((s: any) => s.is_active) || sRes.data[0];
            if (active) setSemesterId(active.id);
        } catch (e) { toast.error(errMsg(e, 'Could not load dashboard stats.')); }
        finally { setStatsLoading(false); }
    };

    /** Pull the list of sections the scheduler couldn't place. */
    const fetchUnplaced = async (semId?: string) => {
        const id = semId ?? semesterId;
        if (!id) return;
        setUnplacedLoading(true);
        try {
            const res = await apiClient.get(`/scheduling/unplaced/${id}`);
            setUnplaced(res.data?.items ?? []);
        } catch { setUnplaced([]); }
        finally { setUnplacedLoading(false); }
    };

    /** Drop callback from WeekView when an unplaced card lands on a cell. */
    const handleUnplacedDrop = async (sectionId: string, day: number, time: string) => {
        if (!semesterId) return;
        try {
            await apiClient.post(`/scheduling/place-session/${semesterId}`, {
                section_id: sectionId, day, start_slot: time,
            });
            const item = unplaced.find((u) => u.section_id === sectionId);
            toast.success(`Placed ${item?.course_code ?? 'session'} on ${['Mon','Tue','Wed','Thu','Fri'][day]} ${time.slice(0,5)}.`);
            // refresh both the timetable and the unplaced bucket
            await fetchActiveSemester();
            await fetchUnplaced(semesterId);
            await fetchConflicts(semesterId);
            setLoadRefreshKey((k) => k + 1);
        } catch (e) {
            toast.error(errMsg(e, 'Could not place the session there.'));
        }
    };

    /** One-shot refresh of every panel on the dashboard. */
    const refreshAll = async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                fetchStats(),
                fetchActiveSemester(),
                semesterId ? fetchConflicts(semesterId) : Promise.resolve(),
                semesterId ? fetchUnplaced(semesterId)  : Promise.resolve(),
            ]);
            setLoadRefreshKey((k) => k + 1);
            toast.success('Dashboard refreshed.');
        } finally { setRefreshing(false); }
    };

    /** Pull the conflict list for the active semester and update the banner. */
    const fetchConflicts = async (semId?: string) => {
        const id = semId ?? semesterId;
        if (!id) return;
        try {
            const res = await apiClient.get(`/scheduling/conflicts/${id}`);
            setConflictCount(res.data?.conflict_count ?? 0);
        } catch { /* silent — the toast on Conflicts page is louder */ }
    };

    /** One-click: clear all sessions, regenerate, and re-poll conflicts. */
    const makeConflictFree = async () => {
        if (!semesterId) return;
        const ok = await confirm({
            title: 'Make the schedule conflict-free?',
            confirmLabel: 'Yes, regenerate',
            danger: true,
            body: (
                <Text size="sm">
                    This will wipe the current sessions for this semester and let the auto-scheduler
                    re-place them while honouring every constraint (faculty load, room types,
                    day-off rule, prerequisites). Manual drag-and-drop edits will be lost.
                </Text>
            ),
        });
        if (!ok) return;
        setIsResolving(true);
        try {
            await apiClient.delete(`/scheduling/clear/${semesterId}`);
            const res = await apiClient.post(`/scheduling/generate/${semesterId}`);
            const data: any = res.data;
            if (data?.error) {
                toast.error(data.error);
            } else {
                toast.success(`Re-scheduled ${data?.success ?? 0} session(s)${data?.failed ? `, ${data.failed} still unplaced` : ''}.`);
            }
            await fetchActiveSemester();
            await fetchConflicts(semesterId);
            await fetchUnplaced(semesterId);
            setLoadRefreshKey((k) => k + 1);
        } catch (e) {
            toast.error(errMsg(e, 'Could not regenerate the schedule.'));
        } finally { setIsResolving(false); }
    };

    useEffect(() => {
        if (semesterId) {
            void fetchConflicts(semesterId);
            void fetchUnplaced(semesterId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [semesterId]);

    const fetchActiveSemester = async () => {
        try {
            const sRes = await apiClient.get('/scheduling/semesters');
            const active = sRes.data.find((s: any) => s.is_active) || sRes.data[0];
            if (active) {
                setSemesterId(active.id);
                const sessRes = await apiClient.get(`/scheduling/view/${active.id}`);
                setEvents(sessRes.data);
            }
        } catch { }
    };

    const mutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await apiClient.post(`/scheduling/generate/${id}`);
            return res.data;
        },
        onSuccess: async (data: any, variables) => {
            if (data?.error) { toast.error(data.error); return; }
            toast.success(`Greedy scheduled ${data?.success ?? 0} section(s)${data?.failed ? `, ${data.failed} failed` : ''}.`);
            setLoadRefreshKey((k) => k + 1);
            setResult(data);
            try {
                const sessRes = await apiClient.get(`/scheduling/view/${variables}`);
                setEvents(sessRes.data);
            } catch { }
            await fetchUnplaced(variables);
            await fetchConflicts(variables);
        },
        onError: (e: any) => { toast.error(errMsg(e, 'Greedy scheduler failed.')); setResult({ error: e.message }); }
    });

    const updateSessionMutation = useMutation({
        mutationFn: async ({ id, day, time }: { id: string; day: number; time: string }) => {
            await apiClient.put(`/scheduling/sessions/${id}`, { day, start_slot: time });
        },
        onSuccess: () => {
            if (semesterId) apiClient.get(`/scheduling/view/${semesterId}`).then(r => setEvents(r.data));
        }
    });

    const clearMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await apiClient.delete(`/scheduling/clear/${id}`);
            return res.data;
        },
        onSuccess: () => {
            setEvents([]);
            setResult(null);
        },
        onError: (error: any) => { setResult({ error: error.message }); }
    });

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="flex-start" gap="xl">
                            <Box maw={560}>
                                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8}>Semester planning overview</Text>
                                <Title order={1}>FCESS Scheduling Dashboard</Title>
                                <Text c="dimmed" mt={6}>Track scheduling readiness, export the latest plan, and make quick timetable adjustments.</Text>
                            </Box>
                            <Stack gap="sm">
                                <Group gap="xs" justify="flex-end">
                                    <Button
                                        onClick={refreshAll}
                                        loading={refreshing}
                                        size="sm"
                                        variant="light"
                                        color="gray"
                                        radius="lg"
                                        leftSection={<IconRefresh size={15} />}
                                    >
                                        Refresh
                                    </Button>
                                </Group>
                                <Button
                                    onClick={() => semesterId && mutation.mutate(semesterId)}
                                    loading={mutation.isPending}
                                    size="md"
                                    variant="gradient"
                                    gradient={{ from: 'brand.6', to: 'sky.5' }}
                                    disabled={!semesterId}
                                    leftSection={<IconWand size={16} />}
                                >
                                    Auto-Generate Schedule
                                </Button>
                                <Button
                                    leftSection={<IconTrash size={15} />}
                                    variant="light"
                                    color="red"
                                    size="sm"
                                    radius="lg"
                                    disabled={!semesterId}
                                    loading={clearMutation.isPending}
                                    onClick={async () => {
                                        if (!semesterId) return;
                                        const ok = await confirm({
                                            title: 'Clear schedule?',
                                            danger: true,
                                            confirmLabel: 'Clear schedule',
                                            body: 'All scheduled sessions for this semester will be removed.',
                                        });
                                        if (ok) clearMutation.mutate(semesterId);
                                    }}
                                >
                                    Clear Schedule
                                </Button>
                                <Group gap="sm">
                                    <Button variant="light" color="green" size="sm" disabled={!semesterId} onClick={async () => {
                                        const res = await apiClient.get(`/scheduling/export/${semesterId}/excel`, { responseType: 'blob' });
                                        const url = window.URL.createObjectURL(new Blob([res.data]));
                                        const a = document.createElement('a'); a.href = url; a.setAttribute('download', `schedule.xlsx`); document.body.appendChild(a); a.click(); a.remove();
                                    }}>Export Excel</Button>
                                    <Button variant="light" color="red" size="sm" disabled={!semesterId} onClick={async () => {
                                        const res = await apiClient.get(`/scheduling/export/${semesterId}/pdf`, { responseType: 'blob' });
                                        const url = window.URL.createObjectURL(new Blob([res.data]));
                                        const a = document.createElement('a'); a.href = url; a.setAttribute('download', `schedule.pdf`); document.body.appendChild(a); a.click(); a.remove();
                                    }}>Export PDF</Button>
                                </Group>
                            </Stack>
                        </Group>
                    </Paper>

                    {/* Live Stats */}
                    <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="md">
                        {[
                            { title: 'Departments', value: stats.departments, icon: <IconBuildingSkyscraper size={22}/>, color: 'blue' },
                            { title: 'Courses', value: stats.courses, icon: <IconBook size={22}/>, color: 'indigo' },
                            { title: 'Faculty', value: stats.faculty, icon: <IconUsers size={22}/>, color: 'teal' },
                            { title: 'Rooms', value: stats.rooms, icon: <IconDoor size={22}/>, color: 'orange' },
                            { title: 'Semesters', value: stats.semesters, icon: <IconCalendarTime size={22}/>, color: 'grape' },
                        ].map((s, i) => (
                            <motion.div key={s.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                                <StatCard {...s} loading={statsLoading} />
                            </motion.div>
                        ))}
                    </SimpleGrid>


                    {/* CONFLICT BANNER — auto-alerts when the active semester has overlaps. */}
                    {conflictCount > 0 && (
                        <Paper p="md" radius="xl" withBorder shadow="sm"
                            style={{ borderColor: '#fecaca', background: '#fff1f2' }}>
                            <Group justify="space-between" align="center" wrap="wrap">
                                <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                                    <ThemeIcon size={42} radius="xl" color="red" variant="light">
                                        <IconAlertTriangle size={22} />
                                    </ThemeIcon>
                                    <Box style={{ minWidth: 0 }}>
                                        <Text fw={700} c="red">
                                            {conflictCount} scheduling conflict{conflictCount === 1 ? '' : 's'} detected
                                        </Text>
                                        <Text size="sm" c="dimmed" style={{ maxWidth: 720 }}>
                                            Click <strong>Make conflict-free</strong> to regenerate the whole timetable.
                                            Or drag a session in the grid to a new slot — the system will warn you
                                            if you drop into another conflict.
                                            For long-term fixes: <em>assign more lecturers to overloaded courses</em>
                                            (Assignments tab) or <em>add more rooms</em> (Rooms tab, especially LAB rooms
                                            if you have lab courses).
                                        </Text>
                                    </Box>
                                </Group>
                                <Group gap="sm" wrap="nowrap">
                                    <Button variant="light" color="gray" radius="lg"
                                        onClick={() => navigate('/conflicts')}>
                                        View details
                                    </Button>
                                    <Button color="red" radius="lg"
                                        leftSection={<IconShieldCheck size={16} />}
                                        loading={isResolving}
                                        onClick={makeConflictFree}>
                                        Make conflict-free
                                    </Button>
                                </Group>
                            </Group>
                        </Paper>
                    )}
                    {conflictCount === 0 && events.length > 0 && (
                        <Paper p="sm" radius="xl" withBorder
                            style={{ borderColor: 'rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.06)' }}>
                            <Group gap="sm">
                                <IconShieldCheck size={18} color="#16a34a" />
                                <Text size="sm" c="teal" fw={600}>
                                    No conflicts in this semester. The schedule is clean. ✓
                                </Text>
                            </Group>
                        </Paper>
                    )}

                    {mutation.isSuccess && (
                        <Paper p="md" radius="xl" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                            <Group gap="sm"><IconCheck size={18} color="green"/><Text c="teal" fw={600}>Schedule generated successfully!</Text></Group>
                        </Paper>
                    )}
                    {mutation.isError && (
                        <Paper p="md" radius="xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <Group gap="sm"><IconX size={18} color="red"/><Text c="red" fw={600}>Failed to generate schedule.</Text></Group>
                        </Paper>
                    )}


                    {semesterId && (
                        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                            <FacultyLoadCard semesterId={semesterId} refreshKey={loadRefreshKey} />
                            <CurriculumCoverageCard semesterId={semesterId} refreshKey={loadRefreshKey} />
                        </SimpleGrid>
                    )}

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Title order={3} mb={4}>Weekly Timetable</Title>
                        <Text c="dimmed" size="sm" mb="md">
                            Drag sessions to reschedule, or drag a card from the <strong>Unplaced</strong> panel
                            on the left onto any empty cell to place it.
                        </Text>
                        <WeekView
                            events={events}
                            onEventDrop={(id, day, time) => updateSessionMutation.mutate({ id, day, time })}
                            onEventClick={(ev) => setSessionModal(ev)}
                            onUnplacedDrop={handleUnplacedDrop}
                            sidebar={
                                <UnplacedPanel
                                    items={unplaced}
                                    loading={unplacedLoading}
                                    onRefresh={() => fetchUnplaced(semesterId)}
                                />
                            }
                        />
                    </Paper>

                    {result && (
                        <Paper p="lg" radius="xl" withBorder bg="white">
                            <Text fw={500} mb="xs">Scheduler Output:</Text>
                            <Code block>{JSON.stringify(result, null, 2)}</Code>
                        </Paper>
                    )}

                    {/* Danger zone — full system wipe, moved here from the sidebar */}
                    <Paper p="lg" radius="xl" withBorder shadow="sm"
                        style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(255,241,242,0.6)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Box>
                                <Text fw={700} c="red">Danger zone</Text>
                                <Text size="sm" c="dimmed">
                                    Permanently delete every department, course, lecturer, assignment, room and session.
                                </Text>
                            </Box>
                            <Group gap="sm">
                                <DeleteAllButton scope="rooms"        label="Delete all rooms" cascade onDone={fetchStats} />
                                <DeleteAllButton scope="assignments"  label="Delete all assignments" onDone={fetchStats} />
                                <DeleteAllButton scope="faculty"      label="Delete all lecturers" cascade onDone={fetchStats} />
                                <DeleteAllButton scope="courses"      label="Delete all courses" cascade onDone={fetchStats} />
                                <DeleteAllButton scope="departments"  label="Delete EVERYTHING" cascade onDone={fetchStats} />
                            </Group>
                        </Group>
                    </Paper>


                    {/* Session details modal — opens when a session card is clicked */}
                    <Modal
                        opened={!!sessionModal}
                        onClose={() => setSessionModal(null)}
                        title="Session details"
                        radius="xl"
                        centered
                    >
                        {sessionModal && (
                            <Stack gap="sm">
                                <Group justify="space-between">
                                    <Text fw={700} size="xl">{sessionModal.courseCode}</Text>
                                    <Badge variant="light"
                                        color={sessionModal.type === 'LAB' ? 'teal' : sessionModal.type === 'COMBINED' ? 'yellow' : 'indigo'}>
                                        {sessionModal.type}
                                    </Badge>
                                </Group>
                                <Text size="sm" c="dimmed">
                                    {(['Monday','Tuesday','Wednesday','Thursday','Friday'][sessionModal.day] || sessionModal.day)}
                                    {' '}at {String(sessionModal.startSlot).slice(0,5)} · {sessionModal.duration} min
                                </Text>
                                <Group gap="md">
                                    <Text size="sm"><strong>Room:</strong> {sessionModal.room}</Text>
                                    <Text size="sm"><strong>Lecturer:</strong> {sessionModal.faculty}</Text>
                                </Group>
                                <Group justify="flex-end" mt="sm">
                                    <Button variant="subtle" color="gray" onClick={() => setSessionModal(null)} radius="lg">
                                        Close
                                    </Button>
                                    <Button
                                        color="red"
                                        radius="lg"
                                        leftSection={<IconTrash size={14} />}
                                        onClick={async () => {
                                            const ok = await confirm({
                                                title: 'Unschedule this session?',
                                                danger: true,
                                                confirmLabel: 'Unschedule',
                                                body: <Text size="sm">{sessionModal.courseCode} will be removed from the timetable. The course itself stays.</Text>,
                                            });
                                            if (!ok) return;
                                            try {
                                                await apiClient.delete(`/scheduling/sessions/${sessionModal.id}`);
                                                toast.success(`Removed ${sessionModal.courseCode} from the timetable.`);
                                                setSessionModal(null);
                                                await fetchActiveSemester();
                                            } catch (e) { toast.error(errMsg(e, 'Could not unschedule.')); }
                                        }}
                                    >
                                        Unschedule
                                    </Button>
                                </Group>
                            </Stack>
                        )}
                    </Modal>
                </Stack>
            </Container>
        </PageTransition>
    );
}
