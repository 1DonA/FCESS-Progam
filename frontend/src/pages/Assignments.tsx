import { useEffect, useMemo, useState } from 'react';
import {
    ActionIcon, Badge, Box, Button, Container, Group, Modal, Paper, Select,
    Skeleton, Stack, Table, Text, TextInput, Textarea, ThemeIcon, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconLink, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { DeleteAllButton } from '../lib/DeleteAllButton';
import { EditRowButton } from '../lib/EditRowButton';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { usePagedFilter } from '../lib/usePagedFilter';
import { PagedFooter } from '../lib/PagedFooter';

interface Assignment {
    id: string;
    faculty_id: string;
    course_id: string;
    department_id: string;
    room_id?: string | null;
    notes?: string | null;
    faculty_name?: string | null;
    course_code?: string | null;
    department_code?: string | null;
    room_label?: string | null;
    room_type?: string | null;
}
interface Faculty { id: string; first_name: string; last_name: string; department_id: string; }
interface Course {
    id: string; code: string; title: string;
    lecture_hours: number; lab_hours: number;
}
interface Building { id: string; name: string; code: string; }
interface Room {
    id: string; room_number: string; type: string; capacity: number;
    building_id: string; building?: Building | null;
}

export function Assignments() {
    const [rows, setRows] = useState<Assignment[]>([]);
    const [faculty, setFaculty] = useState<Faculty[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 200);
    const paged = usePagedFilter<any>(rows, {
        searchFields: ['faculty_name', 'course_code', 'department_code', 'room_label'],
        defaultPageSize: 25,
    });

    const [form, setForm] = useState({
        faculty_id: '', course_id: '', room_id: '' as string, notes: '',
    });

    useEffect(() => {
        void fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const params: Record<string, string> = {};
            if (debouncedSearch) params.q = debouncedSearch;
            const [aRes, fRes, cRes, rRes] = await Promise.all([
                apiClient.get<Assignment[]>('/catalog/assignments', { params }),
                apiClient.get<Faculty[]>('/catalog/faculty'),
                apiClient.get<Course[]>('/catalog/courses'),
                apiClient.get<Room[]>('/catalog/rooms'),
            ]);
            setRows(aRes.data);
            setFaculty(fRes.data);
            setCourses(cRes.data);
            setRooms(rRes.data);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load assignments.'));
        } finally {
            setIsLoading(false);
        }
    };

    const openAdd = () => {
        if (!faculty.length) { toast.error('Create a lecturer first.'); return; }
        if (!courses.length) { toast.error('Create a course first.'); return; }
        setForm({
            faculty_id: faculty[0].id, course_id: courses[0].id,
            room_id: '', notes: '',
        });
        open();
    };

    const selectedCourse = useMemo(
        () => courses.find((c) => c.id === form.course_id),
        [courses, form.course_id],
    );
    const eligibleRooms = useMemo(() => {
        if (!selectedCourse) return rooms;
        const hasLec = selectedCourse.lecture_hours > 0;
        const hasLab = selectedCourse.lab_hours > 0;
        if (hasLab && !hasLec) return rooms.filter((r) => r.type === 'LAB');
        if (hasLec && !hasLab) return rooms.filter((r) => r.type !== 'LAB');
        return rooms;
    }, [rooms, selectedCourse]);

    const handleAdd = async () => {
        if (!form.faculty_id || !form.course_id) {
            toast.error('Pick a lecturer and a course.');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/catalog/assignments', {
                faculty_id: form.faculty_id,
                course_id: form.course_id,
                room_id: form.room_id || null,
                notes: form.notes || null,
            });
            toast.success('Lecturer assigned to course.');
            close();
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not assign lecturer.'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, label: string) => {
        const ok = await confirm({
            title: 'Remove assignment?',
            danger: true,
            confirmLabel: 'Unassign',
            body: <Text size="sm">The lecturer will be unassigned from {label}.</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/catalog/assignments/${id}`);
            toast.success('Assignment removed.');
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not remove assignment.'));
        }
    };

    const roomLabel = (r: Room) =>
        `${r.building?.code ? r.building.code + ' · ' : ''}${r.room_number} (${r.type})`;

    const courseTypeHint = selectedCourse
        ? (selectedCourse.lab_hours > 0 && selectedCourse.lecture_hours === 0
            ? 'Lab course — only LAB rooms shown.'
            : selectedCourse.lecture_hours > 0 && selectedCourse.lab_hours === 0
                ? 'Lecture course — labs hidden.'
                : 'Mixed lecture + lab — any room is allowed.')
        : null;

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconLink size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Catalog</Text>
                                    <Title order={2}>Lecturer to Course Assignments</Title>
                                    <Text size="xs" c="dimmed">Each assignment pins a lecturer, course and (optionally) the classroom they teach in.</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <ImportCsvButton entity="assignments" onImported={fetchAll} />
                                <DeleteAllButton scope="assignments" label="Delete all assignments" onDone={fetchAll} />
                                <Button leftSection={<IconPlus size={16} />} onClick={openAdd} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg">
                                    Assign Lecturer to Course
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md">
                            <TextInput
                                placeholder="Search lecturer, course, department or room..."
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                leftSection={<IconSearch size={14} />}
                                radius="lg"
                                style={{ flex: 1, maxWidth: 460 }}
                            />
                        </Group>

                        {isLoading ? (
                            <Stack gap="sm">{[1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}</Stack>
                        ) : rows.length === 0 ? (
                            <Text c="dimmed" ta="center" py="xl">No assignments yet.</Text>
                        ) : (
                            <Table striped highlightOnHover verticalSpacing="sm">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Lecturer</Table.Th>
                                        <Table.Th>Course</Table.Th>
                                        <Table.Th>Department</Table.Th>
                                        <Table.Th>Room</Table.Th>
                                        <Table.Th>Notes</Table.Th>
                                        <Table.Th style={{ width: 50 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {paged.visible.map((a: Assignment) => (
                                        <Table.Tr key={a.id}>
                                            <Table.Td><Text fw={500}>{a.faculty_name ?? '?'}</Text></Table.Td>
                                            <Table.Td>
                                                <Badge variant="light" color="brand" radius="sm">{a.course_code ?? '?'}</Badge>
                                            </Table.Td>
                                            <Table.Td>{a.department_code ?? '?'}</Table.Td>
                                            <Table.Td>
                                                {a.room_label
                                                    ? (
                                                        <Group gap={4} wrap="nowrap">
                                                            <Text size="sm">{a.room_label}</Text>
                                                            <Badge size="xs" variant="light"
                                                                color={a.room_type === 'LAB' ? 'orange' : 'blue'}>
                                                                {a.room_type}
                                                            </Badge>
                                                        </Group>
                                                    )
                                                    : <Text c="dimmed" size="xs">— unset —</Text>}
                                            </Table.Td>
                                            <Table.Td><Text size="xs" c="dimmed">{a.notes ?? ''}</Text></Table.Td>
                                            <Table.Td>
                                                <Group gap={4}>
                                                    <EditRowButton
                                                        title="Edit assignment"
                                                        endpoint={`/catalog/assignments/${a.id}`}
                                                        fields={[
                                                            { kind: 'select', name: 'room_id', label: 'Room (optional)', value: a.room_id || '',
                                                                options: [{ value: '', label: '— no room —' }].concat(
                                                                    rooms.map(r => ({ value: r.id, label: `${r.building?.code ? r.building.code + ' · ' : ''}${r.room_number} (${r.type})` }))) ,
                                                                searchable: true },
                                                            { name: 'notes', label: 'Notes (optional)', value: a.notes || '' },
                                                        ]}
                                                        onSaved={fetchAll}
                                                    />
                                                    <ActionIcon color="red" variant="subtle" size="sm"
                                                        onClick={() => handleDelete(a.id, a.course_code ?? '?')}>
                                                        <IconTrash size={15} />
                                                    </ActionIcon>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        )}
                        <PagedFooter
                            page={paged.page}
                            totalPages={paged.totalPages}
                            pageSize={paged.pageSize}
                            totalFiltered={paged.totalFiltered}
                            totalRaw={paged.totalRaw}
                            onPageChange={paged.setPage}
                            onPageSizeChange={paged.setPageSize}
                        />
                    </Paper>
                </Stack>
            </Container>

            <Modal opened={opened} onClose={close} title="Assign lecturer to course" radius="xl" centered size="lg">
                <Stack gap="md">
                    <Select label="Lecturer" required radius="lg"
                        value={form.faculty_id}
                        onChange={(v) => setForm({ ...form, faculty_id: v ?? '' })}
                        data={faculty.map((f) => ({ value: f.id, label: `${f.first_name} ${f.last_name}` }))} />
                    <Select label="Course" required radius="lg" searchable
                        value={form.course_id}
                        onChange={(v) => setForm({ ...form, course_id: v ?? '', room_id: '' })}
                        data={courses.map((c) => ({
                            value: c.id,
                            label: `${c.code} — ${c.title} (${c.lecture_hours}L/${c.lab_hours}Lab)`,
                        }))} />
                    <Select
                        label="Room (optional)"
                        clearable searchable radius="lg"
                        value={form.room_id || null}
                        onChange={(v) => setForm({ ...form, room_id: v ?? '' })}
                        data={eligibleRooms.map((r) => ({ value: r.id, label: roomLabel(r) }))}
                        description={courseTypeHint ?? 'Pick the room this lecturer teaches the course in.'}
                    />
                    <Textarea label="Notes (optional)" radius="lg" autosize minRows={1} maxRows={3}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
                    <Text size="xs" c="dimmed">Department is set automatically from the lecturer&apos;s home department.</Text>
                    <Group justify="flex-end">
                        <Button variant="subtle" color="gray" onClick={close} radius="lg">Cancel</Button>
                        <Button onClick={handleAdd} loading={saving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            Assign
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
