/**
 * Lecturer Portal
 *
 * The landing page for a FACULTY-role user. It shows:
 *   • Their own personal weekly schedule (only their sessions)
 *   • Their department's full schedule (read-only)
 *   • A subscribe-to-iCal button so they can pull the schedule into
 *     Outlook / Google Calendar / Apple Calendar
 *
 * Admins keep the full Dashboard at "/" — this page is mounted at "/my".
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Anchor, Badge, Box, Button, Container, Group, Paper, ScrollArea,
    Stack, Tabs, Text, ThemeIcon, Title,
} from '@mantine/core';
import {
    IconAlertCircle, IconCalendar, IconCalendarTime, IconClock, IconDownload,
    IconShieldCheck, IconUser, IconBolt,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { WeekView } from '../components/Calendar/WeekView';
import { useAuth } from '../context/AuthContext';
import { errMsg, toast } from '../lib/feedback';

/** "HH:MM:SS" → minutes since midnight */
function toMin(s: string): number {
    const [h, m] = (s || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

interface Semester { id: string; name: string; is_active: boolean; }

export function LecturerPortal() {
    const { me } = useAuth();
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [semesterId, setSemesterId] = useState<string | null>(null);
    const [mine, setMine] = useState<any[]>([]);
    const [dept, setDept] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [now, setNow] = useState<Date>(new Date());

    // Tick the clock every 30 seconds so the "next class in" countdown stays live.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    const facultyName = (me?.faculty_first_name && me?.faculty_last_name)
        ? `${me.faculty_first_name} ${me.faculty_last_name}`
        : (me?.full_name || me?.email || 'Lecturer');

    // 1. pick the active semester
    useEffect(() => {
        (async () => {
            try {
                const r = await apiClient.get<Semester[]>('/scheduling/semesters');
                setSemesters(r.data);
                const active = r.data.find((s) => s.is_active) || r.data[0];
                if (active) setSemesterId(active.id);
            } catch (e) { toast.error(errMsg(e, 'Could not load semesters.')); }
        })();
    }, []);

    // Pull both schedules; called on mount, on semester change, and every 60s.
    const fetchSchedules = async (silent = false) => {
        if (!semesterId) return;
        if (!silent) setLoading(true);
        try {
            if (me?.faculty_id) {
                const r = await apiClient.get(`/scheduling/faculty-schedule/${me.faculty_id}/${semesterId}`);
                setMine((r.data || []).map((s: any) => ({
                    id: s.id, day: s.day, startSlot: s.startSlot, duration: s.duration,
                    courseCode: s.courseCode, type: s.type,
                    room: s.room, faculty: facultyName, roomType: '',
                })));
            } else { setMine([]); }

            if (me?.department_id) {
                const y = await apiClient.get(`/scheduling/yearly-schedule/${me.department_id}`);
                const thisSem = (y.data?.semesters || []).find((s: any) => s.semester_id === semesterId);
                const flat: any[] = [];
                if (thisSem) {
                    Object.values(thisSem.by_year || {}).forEach((arr: any) => arr.forEach((s: any) => flat.push({
                        id: s.id, day: s.day, startSlot: s.startSlot, duration: s.duration,
                        courseCode: s.courseCode, type: s.type, room: s.room, faculty: s.faculty, roomType: '',
                    })));
                }
                setDept(flat);
            } else { setDept([]); }
            setLastUpdated(new Date());
        } catch (e) {
            if (!silent) toast.error(errMsg(e, 'Could not load schedules.'));
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // 2. fetch on semester change + poll every 60s for live updates
    useEffect(() => {
        if (!semesterId) return;
        void fetchSchedules();
        const id = setInterval(() => void fetchSchedules(true), 60_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [semesterId, me?.faculty_id, me?.department_id]);

    const activeSem = useMemo(() => semesters.find((s) => s.id === semesterId), [semesters, semesterId]);
    const apiBase = (apiClient.defaults.baseURL || '').replace(/\/$/, '');
    const icalUrl = me?.faculty_id ? `${apiBase}/scheduling/faculty/${me.faculty_id}.ics${semesterId ? `?semester_id=${semesterId}` : ''}` : '';

    // Today's classes (Mon=0 … Sun=6 → match JS Date.getDay() where Sun=0)
    const todayIdx = (now.getDay() + 6) % 7; // 0=Mon
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todaysMine = useMemo(() => {
        return mine
            .filter((s) => s.day === todayIdx)
            .sort((a, b) => toMin(a.startSlot) - toMin(b.startSlot));
    }, [mine, todayIdx]);
    const nextClass = todaysMine.find((s) => toMin(s.startSlot) + s.duration > nowMin);
    const minutesUntilNext = nextClass ? toMin(nextClass.startSlot) - nowMin : null;
    const inProgress = nextClass && minutesUntilNext !== null && minutesUntilNext <= 0;

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    {/* Header */}
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconUser size={24} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Lecturer Portal</Text>
                                    <Title order={2}>Welcome, {facultyName}</Title>
                                    <Group gap={6} mt={4}>
                                        {me?.department_code && (
                                            <Badge color="indigo" variant="light">
                                                {me.department_code} — {me.department_name}
                                            </Badge>
                                        )}
                                        <Badge color="teal" variant="light">{me?.role}</Badge>
                                        {activeSem && <Badge color="brand" variant="light">{activeSem.name}</Badge>}
                                    </Group>
                                </Box>
                            </Group>
                            <Group gap="xs">
                                <Badge color="teal" variant="dot" leftSection={<IconBolt size={10} />}>
                                    Live{lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString().slice(0, 5)}` : ''}
                                </Badge>
                                {icalUrl && (
                                    <Button
                                        variant="light"
                                        radius="lg"
                                        leftSection={<IconDownload size={16} />}
                                        component="a"
                                        href={icalUrl}
                                    >
                                        Subscribe to iCal
                                    </Button>
                                )}
                            </Group>
                        </Group>
                    </Paper>

                    {/* Today's Classes — live focus card */}
                    {me?.faculty_id && (
                        <Paper p="lg" radius="xl" withBorder shadow="sm"
                            style={{ borderColor: nextClass && inProgress ? 'rgba(16,185,129,0.4)' : 'rgba(148,163,184,0.2)',
                                     background: nextClass && inProgress ? 'rgba(16,185,129,0.06)' : 'white' }}>
                            <Group justify="space-between" align="center" wrap="wrap">
                                <Group gap="md">
                                    <ThemeIcon size={42} radius="xl"
                                        color={nextClass ? (inProgress ? 'teal' : 'brand') : 'gray'}
                                        variant="light">
                                        <IconClock size={20} />
                                    </ThemeIcon>
                                    <Box>
                                        <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                                            {DAY_NAMES[todayIdx]} · {now.toLocaleTimeString().slice(0, 5)}
                                        </Text>
                                        {todaysMine.length === 0 ? (
                                            <Text fw={600}>No classes today. Enjoy the day off.</Text>
                                        ) : !nextClass ? (
                                            <Text fw={600}>All {todaysMine.length} class(es) finished for today.</Text>
                                        ) : inProgress ? (
                                            <Group gap={6} align="baseline">
                                                <Badge color="teal" variant="filled">In progress</Badge>
                                                <Text fw={700} size="lg">{nextClass.courseCode}</Text>
                                                <Text size="sm" c="dimmed">· {nextClass.room} · ends at {(toMin(nextClass.startSlot) + nextClass.duration) > 0
                                                    ? `${String(Math.floor((toMin(nextClass.startSlot) + nextClass.duration) / 60)).padStart(2,'0')}:${String((toMin(nextClass.startSlot) + nextClass.duration) % 60).padStart(2,'0')}`
                                                    : ''}</Text>
                                            </Group>
                                        ) : (
                                            <Group gap={6} align="baseline">
                                                <Text fw={700} size="lg">Next: {nextClass.courseCode}</Text>
                                                <Text size="sm" c="dimmed">
                                                    in {(minutesUntilNext ?? 0) >= 60
                                                        ? `${Math.floor((minutesUntilNext ?? 0)/60)}h ${(minutesUntilNext ?? 0)%60}m`
                                                        : `${minutesUntilNext} min`}
                                                    {' '}· {nextClass.room} · {nextClass.startSlot.slice(0,5)}
                                                </Text>
                                            </Group>
                                        )}
                                    </Box>
                                </Group>
                                {todaysMine.length > 0 && (
                                    <Group gap={4}>
                                        {todaysMine.map((s, i) => (
                                            <Badge key={i} size="sm"
                                                color={toMin(s.startSlot) + s.duration <= nowMin ? 'gray'
                                                     : (toMin(s.startSlot) <= nowMin ? 'teal' : 'brand')}
                                                variant={toMin(s.startSlot) + s.duration <= nowMin ? 'outline' : 'light'}>
                                                {s.startSlot.slice(0,5)} · {s.courseCode}
                                            </Badge>
                                        ))}
                                    </Group>
                                )}
                            </Group>
                        </Paper>
                    )}

                    {/* No-faculty-link warning */}
                    {!me?.faculty_id && (
                        <Alert icon={<IconAlertCircle size={16} />} color="yellow" radius="md" title="No lecturer record linked">
                            Your account isn't linked to a faculty roster row, so no personal schedule is available.
                            Ask the chair to add you to the Lecturers page with this email address: <strong>{me?.email}</strong>.
                        </Alert>
                    )}

                    <Tabs defaultValue="mine" radius="lg" keepMounted={false}>
                        <Tabs.List>
                            <Tabs.Tab value="mine" leftSection={<IconCalendar size={14} />}>
                                My schedule ({mine.length})
                            </Tabs.Tab>
                            <Tabs.Tab value="dept" leftSection={<IconCalendarTime size={14} />}>
                                Department schedule ({dept.length})
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="mine" pt="md">
                            <Paper p="lg" radius="xl" withBorder shadow="sm">
                                <Group justify="space-between" mb="sm">
                                    <Box>
                                        <Title order={4}>Your weekly classes</Title>
                                        <Text c="dimmed" size="sm">
                                            Drag-and-drop is disabled here — only chairs can move sessions.
                                        </Text>
                                    </Box>
                                    {mine.length > 0 && (
                                        <Group gap={6}>
                                            <IconShieldCheck size={16} color="#16a34a" />
                                            <Text size="sm" c="teal" fw={600}>{mine.length} session(s)</Text>
                                        </Group>
                                    )}
                                </Group>
                                <ScrollArea>
                                    <WeekView
                                        events={mine}
                                        // intentionally NOT passing onEventDrop — read-only for lecturers
                                    />
                                </ScrollArea>
                                {!loading && mine.length === 0 && (
                                    <Text size="sm" c="dimmed" mt="sm">
                                        No sessions assigned to you in {activeSem?.name ?? 'this semester'} yet.
                                    </Text>
                                )}
                                {icalUrl && (
                                    <Text size="xs" c="dimmed" mt="md">
                                        Tip: subscribe in your calendar app:{' '}
                                        <Anchor href={icalUrl} target="_blank" rel="noreferrer">{icalUrl}</Anchor>
                                    </Text>
                                )}
                            </Paper>
                        </Tabs.Panel>

                        <Tabs.Panel value="dept" pt="md">
                            <Paper p="lg" radius="xl" withBorder shadow="sm">
                                <Title order={4} mb={4}>
                                    {me?.department_code ?? 'Your'} department — full timetable
                                </Title>
                                <Text c="dimmed" size="sm" mb="md">
                                    Read-only view of every session in your department this semester.
                                    Useful for coordinating with colleagues.
                                </Text>
                                <ScrollArea>
                                    <WeekView events={dept} />
                                </ScrollArea>
                                {!loading && dept.length === 0 && (
                                    <Text size="sm" c="dimmed" mt="sm">
                                        No sessions in your department for {activeSem?.name ?? 'this semester'}.
                                    </Text>
                                )}
                            </Paper>
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            </Container>
        </PageTransition>
    );
}
