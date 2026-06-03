/**
 * Cross-department Room Requests
 *
 * Two tabs:
 *   • Incoming — requests from other departments asking to use my rooms.
 *     I can accept (optionally creating the session immediately) or reject,
 *     with an optional "help offered" message (e.g. "we can offer Lab 203
 *     at 14:00 instead").
 *   • Outgoing — my own pending/accepted/rejected requests.
 *
 * A "New request" button opens a modal to pick a room from another
 * department + the slot + an optional course.
 */
import { useEffect, useState } from 'react';
import {
    Alert, Badge, Box, Button, Container, Group, Modal, NumberInput, Paper,
    ScrollArea, Select, Stack, Table, Tabs, Text, Textarea, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import {
    IconAlertCircle, IconArrowDownRight, IconArrowUpRight, IconCheck,
    IconHelp, IconHome, IconPlus, IconRefresh, IconSend, IconX,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { roomRequestsApi, type RoomRequest } from '../api/roomRequests';
import { useAuth } from '../context/AuthContext';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';

interface Department { id: string; code: string; name: string; }
interface Building   { id: string; name: string; code: string; department_id?: string | null; }
interface Room       { id: string; room_number: string; building_id: string; capacity: number; type: string; }
interface Semester   { id: string; name: string; is_active: boolean; }
interface Course     { id: string; code: string; title: string; department_id: string; }
interface Section    { id: string; course_id: string; semester_id: string; section_number: string; }

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const STATUS_COLOR: Record<string, string> = {
    PENDING:   'yellow',
    ACCEPTED:  'teal',
    REJECTED:  'red',
    CANCELLED: 'gray',
};

export function RoomRequests() {
    const { me } = useAuth();
    const [incoming, setIncoming] = useState<RoomRequest[]>([]);
    const [outgoing, setOutgoing] = useState<RoomRequest[]>([]);
    const [loading, setLoading]   = useState(true);

    // For "new request" modal
    const [showNew, setShowNew] = useState(false);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [buildings, setBuildings]     = useState<Building[]>([]);
    const [rooms, setRooms]             = useState<Room[]>([]);
    const [semesters, setSemesters]     = useState<Semester[]>([]);
    const [courses, setCourses]         = useState<Course[]>([]);
    const [sections, setSections]       = useState<Section[]>([]);
    const [form, setForm] = useState({
        requester_department_id: '',
        room_id: '',
        day_of_week: 0,
        start_slot: '09:00',
        duration_minutes: 60,
        course_id: '',
        section_id: '',
        semester_id: '',
        message: '',
    });
    const [submitting, setSubmitting] = useState(false);

    // Respond modal
    const [responding, setResponding] = useState<RoomRequest | null>(null);
    const [response, setResponse] = useState({ response_message: '', help_offered: '' });

    const fetchAll = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [inc, out] = await Promise.all([
                roomRequestsApi.incoming().catch(() => []),
                roomRequestsApi.outgoing().catch(() => []),
            ]);
            setIncoming(inc);
            setOutgoing(out);
        } finally { if (!silent) setLoading(false); }
    };

    const fetchLookups = async () => {
        try {
            const [d, b, r, s, c] = await Promise.all([
                apiClient.get<Department[]>('/catalog/departments'),
                apiClient.get<Building[]>('/catalog/buildings'),
                apiClient.get<Room[]>('/catalog/rooms'),
                apiClient.get<Semester[]>('/scheduling/semesters'),
                apiClient.get<Course[]>('/catalog/courses'),
            ]);
            setDepartments(d.data);
            setBuildings(b.data);
            setRooms(r.data);
            setSemesters(s.data);
            setCourses(c.data);
            // pre-fill the form with the user's own department + active semester
            const active = s.data.find((x) => x.is_active) || s.data[0];
            setForm((f) => ({
                ...f,
                requester_department_id: me?.department_id || d.data[0]?.id || '',
                semester_id: active?.id || '',
            }));
        } catch (e) { /* lookups are best-effort */ }
    };

    useEffect(() => {
        void fetchAll();
        void fetchLookups();
        const id = setInterval(() => fetchAll(true), 30_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Load sections of the chosen course in the chosen semester
        (async () => {
            if (!form.course_id || !form.semester_id) { setSections([]); return; }
            try {
                const r = await apiClient.get<Section[]>(`/scheduling/sections?semester_id=${form.semester_id}`);
                setSections(r.data.filter((s) => s.course_id === form.course_id));
            } catch { setSections([]); }
        })();
    }, [form.course_id, form.semester_id]);

    /** Only show rooms that belong to a *different* department than the requester. */
    const otherDeptRooms = rooms.filter((r) => {
        const b = buildings.find((x) => x.id === r.building_id);
        const ownerDept = b?.department_id || null;
        if (!ownerDept) return false;                                // unowned rooms — no request needed
        return ownerDept !== form.requester_department_id;
    });

    const submit = async () => {
        if (!form.requester_department_id || !form.room_id) {
            toast.error('Pick your department and a target room.'); return;
        }
        setSubmitting(true);
        try {
            await roomRequestsApi.create({
                requester_department_id: form.requester_department_id,
                room_id: form.room_id,
                day_of_week: Number(form.day_of_week),
                start_slot: form.start_slot,
                duration_minutes: Number(form.duration_minutes),
                course_id: form.course_id || null,
                section_id: form.section_id || null,
                semester_id: form.semester_id || null,
                message: form.message || null,
            });
            toast.success('Request sent.');
            setShowNew(false);
            await fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not send request.'));
        } finally { setSubmitting(false); }
    };

    const doRespond = async (action: 'accept' | 'reject') => {
        if (!responding) return;
        try {
            await roomRequestsApi.respond(responding.id, {
                action,
                response_message: response.response_message || null,
                help_offered: response.help_offered || null,
                auto_create_session: true,
            });
            toast.success(action === 'accept' ? 'Request accepted.' : 'Request rejected.');
            setResponding(null);
            setResponse({ response_message: '', help_offered: '' });
            await fetchAll();
        } catch (e) { toast.error(errMsg(e, 'Could not respond to request.')); }
    };

    const doCancel = async (id: string) => {
        const ok = await confirm({
            title: 'Cancel this request?',
            confirmLabel: 'Yes, cancel',
            danger: true,
            body: 'The other department will no longer see it as pending.',
        });
        if (!ok) return;
        try {
            await roomRequestsApi.cancel(id);
            toast.success('Request cancelled.');
            await fetchAll();
        } catch (e) { toast.error(errMsg(e, 'Could not cancel.')); }
    };

    const renderTable = (rows: RoomRequest[], showIncomingActions: boolean) => (
        rows.length === 0 ? (
            <Text c="dimmed" ta="center" py="lg">No requests here.</Text>
        ) : (
            <Table striped highlightOnHover>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>{showIncomingActions ? 'From' : 'To'}</Table.Th>
                        <Table.Th>Room</Table.Th>
                        <Table.Th>When</Table.Th>
                        <Table.Th>Course</Table.Th>
                        <Table.Th>Message</Table.Th>
                        <Table.Th style={{ width: 160 }}>Actions</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {rows.map((r) => (
                        <Table.Tr key={r.id}>
                            <Table.Td>
                                <Badge color={STATUS_COLOR[r.status]} variant="light">{r.status}</Badge>
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" fw={600}>
                                    {showIncomingActions ? r.requester_department_code : r.owner_department_code}
                                </Text>
                                <Text size="xs" c="dimmed">
                                    {showIncomingActions ? r.requester_department_name : r.owner_department_name}
                                </Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" fw={600}>{r.building_name}</Text>
                                <Text size="xs" c="dimmed">Room {r.room_number}</Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm">{DAYS[r.day_of_week] || r.day_of_week}</Text>
                                <Text size="xs" c="dimmed">{r.start_slot.slice(0,5)} · {r.duration_minutes}min</Text>
                            </Table.Td>
                            <Table.Td>{r.course_code ?? '—'}</Table.Td>
                            <Table.Td style={{ maxWidth: 240 }}>
                                {r.message && <Text size="xs">{r.message}</Text>}
                                {r.response_message && (
                                    <Text size="xs" c="dimmed" mt={2}><strong>Reply:</strong> {r.response_message}</Text>
                                )}
                                {r.help_offered && (
                                    <Text size="xs" c="teal" mt={2}><IconHelp size={11} /> <strong>Help:</strong> {r.help_offered}</Text>
                                )}
                            </Table.Td>
                            <Table.Td>
                                {showIncomingActions && r.status === 'PENDING' && (
                                    <Group gap={4}>
                                        <Button size="compact-xs" color="teal" leftSection={<IconCheck size={12} />}
                                            onClick={() => { setResponding(r); }}>
                                            Respond
                                        </Button>
                                    </Group>
                                )}
                                {!showIncomingActions && r.status === 'PENDING' && (
                                    <Button size="compact-xs" variant="subtle" color="gray"
                                        leftSection={<IconX size={12} />}
                                        onClick={() => doCancel(r.id)}>
                                        Cancel
                                    </Button>
                                )}
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        )
    );

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group justify="space-between" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconHome size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Cross-department</Text>
                                    <Title order={2}>Room Requests</Title>
                                    <Text size="sm" c="dimmed">
                                        Ask another faculty to use one of their rooms. The room owner
                                        accepts, rejects, or offers help.
                                    </Text>
                                </Box>
                            </Group>
                            <Group gap="xs">
                                <Button variant="subtle" color="gray" radius="lg"
                                    leftSection={<IconRefresh size={15} />}
                                    onClick={() => fetchAll()}
                                    loading={loading}>
                                    Refresh
                                </Button>
                                <Button radius="lg" leftSection={<IconPlus size={16} />}
                                    onClick={() => setShowNew(true)}>
                                    New request
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    <Tabs defaultValue="incoming" radius="lg">
                        <Tabs.List>
                            <Tabs.Tab value="incoming" leftSection={<IconArrowDownRight size={14} />}
                                rightSection={incoming.filter((r) => r.status === 'PENDING').length > 0
                                    ? <Badge color="red" variant="filled" size="xs" circle>
                                        {incoming.filter((r) => r.status === 'PENDING').length}
                                      </Badge>
                                    : null}>
                                Incoming ({incoming.length})
                            </Tabs.Tab>
                            <Tabs.Tab value="outgoing" leftSection={<IconArrowUpRight size={14} />}>
                                Outgoing ({outgoing.length})
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="incoming" pt="md">
                            <Paper p="md" radius="xl" withBorder shadow="sm">
                                <ScrollArea>{renderTable(incoming, true)}</ScrollArea>
                            </Paper>
                        </Tabs.Panel>
                        <Tabs.Panel value="outgoing" pt="md">
                            <Paper p="md" radius="xl" withBorder shadow="sm">
                                <ScrollArea>{renderTable(outgoing, false)}</ScrollArea>
                            </Paper>
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            </Container>

            {/* New request modal */}
            <Modal opened={showNew} onClose={() => setShowNew(false)}
                title="Request a room from another faculty" radius="xl" centered size="lg">
                <Stack gap="md">
                    <Select label="Your department" radius="lg"
                        data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                        value={form.requester_department_id}
                        onChange={(v) => setForm({ ...form, requester_department_id: v || '' })}
                        searchable required />
                    <Select label="Room (owned by another department)" radius="lg"
                        data={otherDeptRooms.map((r) => {
                            const b = buildings.find((x) => x.id === r.building_id);
                            const dep = departments.find((d) => d.id === b?.department_id);
                            return {
                                value: r.id,
                                label: `${b?.name ?? '?'} · ${r.room_number} · ${r.type} (${dep?.code ?? '?'})`,
                            };
                        })}
                        value={form.room_id}
                        onChange={(v) => setForm({ ...form, room_id: v || '' })}
                        searchable required
                        nothingFoundMessage="No rooms owned by other departments. Make sure each building has a department_id set." />
                    <Group grow>
                        <Select label="Day" radius="lg"
                            data={DAYS.map((d, i) => ({ value: String(i), label: d }))}
                            value={String(form.day_of_week)}
                            onChange={(v) => setForm({ ...form, day_of_week: Number(v) || 0 })} />
                        <TextInput label="Start time" placeholder="HH:MM" radius="lg"
                            value={form.start_slot}
                            onChange={(e) => setForm({ ...form, start_slot: e.currentTarget.value })} />
                        <NumberInput label="Duration (min)" radius="lg"
                            value={form.duration_minutes} min={30} step={30}
                            onChange={(v) => setForm({ ...form, duration_minutes: Number(v) || 60 })} />
                    </Group>
                    <Group grow>
                        <Select label="Semester (optional)" radius="lg"
                            data={semesters.map((s) => ({ value: s.id, label: s.name }))}
                            value={form.semester_id}
                            onChange={(v) => setForm({ ...form, semester_id: v || '' })}
                            clearable />
                        <Select label="Course (optional)" radius="lg" searchable
                            data={courses
                                .filter((c) => !form.requester_department_id || c.department_id === form.requester_department_id)
                                .map((c) => ({ value: c.id, label: `${c.code} — ${c.title}` }))}
                            value={form.course_id}
                            onChange={(v) => setForm({ ...form, course_id: v || '' })}
                            clearable />
                    </Group>
                    {form.course_id && sections.length > 0 && (
                        <Select label="Section (optional — needed if you want the session auto-created)" radius="lg"
                            data={sections.map((s) => ({ value: s.id, label: `Section ${s.section_number}` }))}
                            value={form.section_id}
                            onChange={(v) => setForm({ ...form, section_id: v || '' })}
                            clearable />
                    )}
                    <Textarea label="Message to the owning department" radius="lg" minRows={2}
                        placeholder="Why we need the room, alternatives, etc."
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.currentTarget.value })} />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={() => setShowNew(false)} radius="lg">Cancel</Button>
                        <Button onClick={submit} loading={submitting} radius="lg"
                            leftSection={<IconSend size={14} />}
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            Send request
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            {/* Respond modal */}
            <Modal opened={!!responding} onClose={() => setResponding(null)}
                title="Respond to room request" radius="xl" centered size="md">
                {responding && (
                    <Stack gap="md">
                        <Alert icon={<IconAlertCircle size={16} />} color="blue" radius="md">
                            <Text size="sm">
                                <strong>{responding.requester_department_code}</strong> is asking to use{' '}
                                <strong>{responding.building_name} · Room {responding.room_number}</strong>{' '}
                                on {DAYS[responding.day_of_week]} at {responding.start_slot.slice(0, 5)}
                                {' '}for {responding.duration_minutes} min{responding.course_code ? `, for ${responding.course_code}` : ''}.
                            </Text>
                            {responding.message && (
                                <Text size="xs" c="dimmed" mt={6}>"{responding.message}"</Text>
                            )}
                        </Alert>
                        <Textarea label="Reply (optional)" radius="lg" minRows={2}
                            placeholder="e.g. Approved — please bring your own projector."
                            value={response.response_message}
                            onChange={(e) => setResponse({ ...response, response_message: e.currentTarget.value })} />
                        <Textarea label="Help we can offer (optional)" radius="lg" minRows={2}
                            placeholder="e.g. We can also offer Lab 203 from 14:00 if 09:00 doesn't work."
                            value={response.help_offered}
                            onChange={(e) => setResponse({ ...response, help_offered: e.currentTarget.value })} />
                        <Group justify="flex-end">
                            <Button variant="subtle" color="gray" radius="lg" onClick={() => setResponding(null)}>Close</Button>
                            <Button color="red" radius="lg" leftSection={<IconX size={14} />}
                                onClick={() => doRespond('reject')}>Reject</Button>
                            <Button color="teal" radius="lg" leftSection={<IconCheck size={14} />}
                                onClick={() => doRespond('accept')}>Accept</Button>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </PageTransition>
    );
}
